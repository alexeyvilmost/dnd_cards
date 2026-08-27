package migrations

import (
	"database/sql"
	_ "embed"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
)

const certifiedMetadataProjectionMigrationVersion = "117_align_certified_metadata_projection"

//go:embed certified_mutable_metadata_fields.v1.json
var certifiedMutableMetadataPolicyJSON []byte

type certifiedMutableMetadataPolicy struct {
	SchemaVersion             int      `json:"schema_version"`
	MutableMetadataRootFields []string `json:"mutable_metadata_root_fields"`
}

var certifiedMetadataFieldName = regexp.MustCompile(`^[a-z][a-z0-9_]*$`)

func certifiedMutableMetadataFields() ([]string, error) {
	var policy certifiedMutableMetadataPolicy
	if err := json.Unmarshal(certifiedMutableMetadataPolicyJSON, &policy); err != nil {
		return nil, fmt.Errorf("decode certified metadata projection policy: %w", err)
	}
	if policy.SchemaVersion != 1 || len(policy.MutableMetadataRootFields) == 0 {
		return nil, fmt.Errorf("unsupported certified metadata projection policy")
	}

	forbidden := map[string]bool{
		"id": true, "card_number": true, "mechanics": true, "support": true,
		"created_at": true, "updated_at": true, "deleted_at": true,
	}
	seen := make(map[string]bool, len(policy.MutableMetadataRootFields))
	fields := append([]string(nil), policy.MutableMetadataRootFields...)
	for _, field := range fields {
		if !certifiedMetadataFieldName.MatchString(field) || forbidden[field] || seen[field] {
			return nil, fmt.Errorf("invalid certified mutable metadata field %q", field)
		}
		seen[field] = true
	}
	sort.Strings(fields)
	return fields, nil
}

func quotedTextArray(fields []string) string {
	quoted := make([]string, len(fields))
	for index, field := range fields {
		quoted[index] = "'" + strings.ReplaceAll(field, "'", "''") + "'"
	}
	return strings.Join(quoted, ", ")
}

// alignCertifiedMetadataProjection replaces the broad migration-081 support
// invalidator with the same executable-root projection used by release
// certification. Presentation metadata can evolve while identity, mechanics,
// and every undeclared structural field still invalidate stale evidence.
func alignCertifiedMetadataProjection(db *sql.DB) error {
	metadataFields, err := certifiedMutableMetadataFields()
	if err != nil {
		return err
	}
	excludedFields := append([]string{"support", "updated_at"}, metadataFields...)
	structuralFields := append(append([]string(nil), excludedFields...), "mechanics")
	_, err = db.Exec(fmt.Sprintf(`
		CREATE OR REPLACE FUNCTION invalidate_content_support()
		RETURNS TRIGGER AS $$
		BEGIN
			IF (to_jsonb(NEW) - ARRAY[%s]::text[])
				IS DISTINCT FROM
			   (to_jsonb(OLD) - ARRAY[%s]::text[]) THEN
				NEW.support = NULL;
			END IF;
			RETURN NEW;
		END;
		$$ LANGUAGE plpgsql;

		CREATE OR REPLACE FUNCTION protect_certified_content_mechanics()
		RETURNS TRIGGER AS $$
		BEGIN
			IF COALESCE(OLD.support->>'mechanics_locked', 'false') <> 'true' THEN
				IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
				RETURN NEW;
			END IF;

			IF TG_OP = 'DELETE' THEN
				RAISE EXCEPTION 'certified content mechanics are locked'
					USING ERRCODE = 'check_violation';
			END IF;
			IF NEW.mechanics IS DISTINCT FROM OLD.mechanics THEN
				RAISE EXCEPTION 'certified content mechanics cannot be changed'
					USING ERRCODE = 'check_violation';
			END IF;

			-- A non-mechanics structural edit is allowed only after the support
			-- invalidator has revoked the now-stale certificate. A standalone
			-- unlock remains forbidden.
			IF COALESCE(NEW.support->>'mechanics_locked', 'false') <> 'true'
				AND (to_jsonb(NEW) - ARRAY[%s]::text[])
					IS NOT DISTINCT FROM
				   (to_jsonb(OLD) - ARRAY[%s]::text[]) THEN
				RAISE EXCEPTION 'certified content mechanics lock cannot be removed'
					USING ERRCODE = 'check_violation';
			END IF;
			RETURN NEW;
		END;
		$$ LANGUAGE plpgsql;
	`,
		quotedTextArray(excludedFields),
		quotedTextArray(excludedFields),
		quotedTextArray(structuralFields),
		quotedTextArray(structuralFields),
	))
	if err != nil {
		return fmt.Errorf("align certified metadata support projection: %w", err)
	}
	return nil
}
