package migrations

import (
	"database/sql"
	"fmt"
)

// attackRuntimeV4DDL keeps the canonical JSON snapshot as the single source
// of truth while making schema-v4 Attack/grapple ledgers enforceable and
// queryable. NOT VALID preserves additive rollout over historical rows but is
// still enforced for every new/updated snapshot.
const attackRuntimeV4DDL = `
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'ck_game_sessions_attack_runtime_v4'
			AND conrelid = 'game_sessions'::REGCLASS
	) THEN
		ALTER TABLE game_sessions
			ADD CONSTRAINT ck_game_sessions_attack_runtime_v4 CHECK (
				snapshot_schema_version < 4 OR (
					COALESCE(jsonb_typeof(current_snapshot->'attackActions') = 'object', FALSE)
					AND COALESCE(jsonb_typeof(current_snapshot->'grapples') = 'object', FALSE)
				)
			) NOT VALID;
	END IF;
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'ck_session_snapshots_attack_runtime_v4'
			AND conrelid = 'session_snapshots'::REGCLASS
	) THEN
		ALTER TABLE session_snapshots
			ADD CONSTRAINT ck_session_snapshots_attack_runtime_v4 CHECK (
				snapshot_schema_version < 4 OR (
					COALESCE(jsonb_typeof(snapshot->'attackActions') = 'object', FALSE)
					AND COALESCE(jsonb_typeof(snapshot->'grapples') = 'object', FALSE)
				)
			) NOT VALID;
	END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_game_sessions_attack_actions_v4
	ON game_sessions USING GIN ((current_snapshot->'attackActions'))
	WHERE snapshot_schema_version >= 4;
CREATE INDEX IF NOT EXISTS idx_game_sessions_grapples_v4
	ON game_sessions USING GIN ((current_snapshot->'grapples'))
	WHERE snapshot_schema_version >= 4;
CREATE INDEX IF NOT EXISTS idx_session_snapshots_attack_actions_v4
	ON session_snapshots USING GIN ((snapshot->'attackActions'))
	WHERE snapshot_schema_version >= 4;
CREATE INDEX IF NOT EXISTS idx_session_snapshots_grapples_v4
	ON session_snapshots USING GIN ((snapshot->'grapples'))
	WHERE snapshot_schema_version >= 4;
`

func addAttackRuntimeV4(db *sql.DB) error {
	if _, err := db.Exec(attackRuntimeV4DDL); err != nil {
		return fmt.Errorf("add attack runtime v4: %w", err)
	}
	return nil
}
