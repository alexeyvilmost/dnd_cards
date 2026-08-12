package migrations

import (
	"database/sql"
	"fmt"
)

const microMVPRulesReleaseID = "54abf005-a210-4ce7-8511-6f03eea02ed7"
const microMVPReleaseID = "prod-snapshot@2026-08-06.micro-mvp-l1.overlay.1.10.0"
const microMVPRulesArtifactHash = "sha256:04678a044c4dc809d213e01e392bc0f16562d5103ee96e070089c1edf7e7100b"
const microMVPRulesContentHash = "sha256:4ee64d32fffe6b88e797a10ae89207d5f88c0f2214cc16df043d6b9464e9f056"
const microMVPManifestHash = "sha256:3dda1b242973905d6793412c1407adedd72779ac8ce73461ee19686b88c122a4"
const microMVPManifestCanonical = `{"artifactVersion":"1.0.0","releaseId":"prod-snapshot@2026-08-06.micro-mvp-l1.overlay.1.10.0","source":"checked-in:sheetCombatCertification.generated.json"}`

// registerMicroMVPRulesRelease binds the server worker bundle to an immutable
// database release. The large certification artifact stays checked in beside
// the worker; this row is its identity/compatibility handshake, not a mutable
// copy of catalog content.
func registerMicroMVPRulesRelease(db *sql.DB) error {
	_, err := db.Exec(`
		INSERT INTO ruleset_releases (
			id, system_id, ruleset_version, errata_version,
			manifest_schema_version, protocol_schema_version, artifact_version,
			serializer_version, rules_artifact_hash, content_hash, manifest_hash,
			manifest, manifest_canonical_bytes, status, released_at
		) VALUES (
			$1, 'dnd5e-2024', '2024', 'phb-2024-errata-v1',
			1, 1, $7, 'rules-core-canonical-json-v1', $2, $3, $4,
			$5::jsonb, $6, 'active', CURRENT_TIMESTAMP
		)
		ON CONFLICT (manifest_hash) DO NOTHING
	`, microMVPRulesReleaseID, microMVPRulesArtifactHash, microMVPRulesContentHash,
		microMVPManifestHash, microMVPManifestCanonical, []byte(microMVPManifestCanonical),
		microMVPReleaseID)
	return err
}

// repairMicroMVPRulesReleaseIdentity fixes the pre-release 096 row where the
// package version (1.0.0) was stored in artifact_version instead of the
// immutable WorldState ruleset.releaseId. No canonical session could reference
// that row because the release-binding trigger rejected every such genesis.
func repairMicroMVPRulesReleaseIdentity(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var artifactVersion string
	var references int
	err = tx.QueryRow(`
		SELECT artifact_version,
			(SELECT count(*) FROM game_sessions WHERE ruleset_release_id = ruleset_releases.id)
		FROM ruleset_releases
		WHERE id = $1 AND rules_artifact_hash = $2 AND content_hash = $3
			AND manifest_hash = $4
		FOR UPDATE
	`, microMVPRulesReleaseID, microMVPRulesArtifactHash, microMVPRulesContentHash,
		microMVPManifestHash).Scan(&artifactVersion, &references)
	if err != nil {
		return err
	}
	if artifactVersion == microMVPReleaseID {
		return tx.Commit()
	}
	if artifactVersion != "1.0.0" || references != 0 {
		return fmt.Errorf("micro-MVP release identity repair refused: artifact_version=%q references=%d", artifactVersion, references)
	}
	if _, err = tx.Exec(`ALTER TABLE ruleset_releases DISABLE TRIGGER ruleset_releases_append_only`); err != nil {
		return err
	}
	result, err := tx.Exec(`
		UPDATE ruleset_releases SET artifact_version = $1
		WHERE id = $2 AND artifact_version = '1.0.0'
	`, microMVPReleaseID, microMVPRulesReleaseID)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected != 1 {
		return fmt.Errorf("micro-MVP release identity repair updated %d rows, want 1", affected)
	}
	if _, err = tx.Exec(`ALTER TABLE ruleset_releases ENABLE TRIGGER ruleset_releases_append_only`); err != nil {
		return err
	}
	return tx.Commit()
}
