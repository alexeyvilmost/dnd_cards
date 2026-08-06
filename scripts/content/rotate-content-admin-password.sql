\set ON_ERROR_STOP on

-- Required psql variables:
--   importer_uuid, importer_username, new_hash
-- The plaintext password must never be passed to psql. Generate the bcrypt
-- hash from stdin as described in the production migration runbook.
SELECT (
  :'importer_uuid'::uuid IS NOT NULL
  AND length(:'importer_username') BETWEEN 1 AND 50
  AND :'new_hash' ~ '^\$2[aby]\$12\$[./A-Za-z0-9]{53}$'
) AS rotation_inputs_valid
\gset

\if :rotation_inputs_valid
\else
  \echo 'Content-admin rotation aborted: invalid UUID, username, or bcrypt cost/hash'
  -- ON_ERROR_STOP makes this deliberate error return psql exit code 3.
  SELECT 1 / 0 AS rotation_aborted;
\endif

BEGIN;

WITH rotated AS (
  UPDATE users
  SET password_hash = :'new_hash'
  WHERE id = :'importer_uuid'::uuid
    AND username = :'importer_username'
    AND deleted_at IS NULL
  RETURNING 1
)
SELECT count(*)::integer AS rotated_count
FROM rotated
\gset

\if :rotated_count
  COMMIT;
\else
  ROLLBACK;
  \echo 'Content-admin rotation aborted: exact active user was not found'
  -- Do not let automation mistake a guarded no-op for success.
  SELECT 1 / 0 AS rotation_aborted;
\endif
