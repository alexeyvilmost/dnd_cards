-- Explicit catalog metadata migration; run separately from service startup.
-- The live SPELL-0178 is Summon Beast. Retired duplicate imports are untouched.
-- Duration also appears in the retained source description of those imports.
-- This does not change concentration, mechanics, saved characters or combat history.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $migration$
DECLARE
    current_duration text;
    original_support jsonb;
    expected_duration constant text := 'Концентрация, вплоть до 1 часа';
BEGIN
    SELECT duration, support INTO current_duration, original_support
    FROM spells
    WHERE id = '5b887f4a-f13e-4d54-9e54-911779ffc998'
      AND card_number = 'SPELL-0178'
      AND name_en = 'Summon Beast'
      AND concentration = true
      AND deleted_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Summon Beast duration migration: reviewed live spell is missing or changed';
    END IF;
    IF current_duration = expected_duration THEN
        RETURN;
    END IF;
    IF coalesce(btrim(current_duration), '') <> '' THEN
        RAISE EXCEPTION 'Summon Beast duration migration: existing duration must be reviewed';
    END IF;

    UPDATE spells SET duration = expected_duration, updated_at = now()
    WHERE id = '5b887f4a-f13e-4d54-9e54-911779ffc998';

    -- Duration is presentation metadata here. The legacy review trigger includes
    -- this column in its projection; retain the existing review in the same tx.
    UPDATE spells SET support = original_support
    WHERE id = '5b887f4a-f13e-4d54-9e54-911779ffc998'
      AND support IS DISTINCT FROM original_support;
END;
$migration$;
COMMIT;
