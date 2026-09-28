package migrations

import (
	"database/sql"
	"fmt"
)

const partialNarrativeReviewMigrationVersion = "277_partial_narrative_review"

// Only replace the shared trigger function. Existing manual assessments and
// historical snapshots must remain byte-for-byte equivalent as JSONB values.
func extendManualContentReview277(db *sql.DB) error {
	metadata, err := certifiedMutableMetadataFields()
	if err != nil {
		return err
	}
	excluded := quotedTextArray(append([]string{"support", "updated_at", "version"}, metadata...))
	_, err = db.Exec(fmt.Sprintf(`CREATE OR REPLACE FUNCTION invalidate_content_support()
		RETURNS TRIGGER AS $$
		BEGIN
			IF TG_OP = 'INSERT' THEN
				NEW.support = jsonb_build_object('status', 'not_tested');
			ELSIF (to_jsonb(NEW) - ARRAY[%s]::text[])
				IS DISTINCT FROM (to_jsonb(OLD) - ARRAY[%s]::text[]) THEN
				NEW.support = jsonb_build_object('status', 'not_verified');
			ELSIF NEW.support IS DISTINCT FROM OLD.support
				AND COALESCE(NEW.support->>'status', '') NOT IN (
					'verified', 'verified_partial', 'not_verified', 'not_tested',
					'narrative', 'partial_narrative_verified', 'partial_narrative_not_verified',
					'partial_narrative_verified_partial'
				) THEN
				RAISE EXCEPTION 'Unknown manual content review status' USING ERRCODE = '23514';
			END IF;
			RETURN NEW;
		END;
		$$ LANGUAGE plpgsql;`, excluded, excluded))
	return err
}
