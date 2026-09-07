package migrations

import "database/sql"

const roguelikeRunsMigrationVersion = "198_create_roguelike_runs"

// createRoguelikeRuns adds the server-owned aggregate and immutable command
// receipts. The tables are additive so the previous application release keeps
// working if a deployment has to roll back after this migration has run.
func createRoguelikeRuns(db *sql.DB) error {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS roguelike_runs (
			id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
			user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			source_character_id uuid NOT NULL REFERENCES characters_v3(id) ON DELETE RESTRICT,
			character_id uuid NOT NULL UNIQUE REFERENCES characters_v3(id) ON DELETE RESTRICT,
			status varchar(24) NOT NULL DEFAULT 'active',
			phase varchar(24) NOT NULL DEFAULT 'camp',
			revision bigint NOT NULL DEFAULT 0,
			experience integer NOT NULL DEFAULT 0,
			gold integer NOT NULL DEFAULT 0,
			supplies integer NOT NULL DEFAULT 1,
			encounters_won integer NOT NULL DEFAULT 0,
			attempt integer NOT NULL DEFAULT 1,
			game_clock_hours integer NOT NULL DEFAULT 0,
			last_long_rest_hour integer NOT NULL DEFAULT -24,
			paid_refresh_count integer NOT NULL DEFAULT 0,
			run_seed varchar(64) NOT NULL,
			encounter jsonb NOT NULL DEFAULT '{}'::jsonb,
			shop jsonb NOT NULL DEFAULT '{}'::jsonb,
			checkpoint jsonb NOT NULL DEFAULT '{}'::jsonb,
			last_reward jsonb NOT NULL DEFAULT '{}'::jsonb,
			created_at timestamptz NOT NULL DEFAULT NOW(),
			updated_at timestamptz NOT NULL DEFAULT NOW(),
			CONSTRAINT roguelike_runs_status_check CHECK (status IN ('active','victory','defeat','abandoned')),
			CONSTRAINT roguelike_runs_phase_check CHECK (phase IN ('camp','combat','ended')),
			CONSTRAINT roguelike_runs_nonnegative_check CHECK (
				revision >= 0 AND experience >= 0 AND gold >= 0 AND supplies >= 0
				AND encounters_won >= 0 AND attempt >= 1 AND paid_refresh_count >= 0
			)
		);
		CREATE INDEX IF NOT EXISTS idx_roguelike_runs_user_updated
			ON roguelike_runs(user_id, updated_at DESC);
		CREATE UNIQUE INDEX IF NOT EXISTS idx_roguelike_runs_one_active_character
			ON roguelike_runs(source_character_id)
			WHERE status = 'active';

		CREATE TABLE IF NOT EXISTS roguelike_command_receipts (
			id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
			run_id uuid NOT NULL REFERENCES roguelike_runs(id) ON DELETE CASCADE,
			user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			command_id uuid NOT NULL,
			command_type varchar(40) NOT NULL,
			response jsonb NOT NULL,
			created_at timestamptz NOT NULL DEFAULT NOW(),
			UNIQUE(run_id, command_id)
		);
		CREATE INDEX IF NOT EXISTS idx_roguelike_receipts_run_created
			ON roguelike_command_receipts(run_id, created_at);
	`)
	return err
}
