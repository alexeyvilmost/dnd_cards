package migrations

import "database/sql"

// certifiedContentMechanicsLockDDL protects the database rows themselves, not
// only today's HTTP controllers. A completed certification may still refresh
// its support evidence, but neither ordinary SQL nor soft-delete can alter or
// remove the certified entity until an explicit future migration changes this
// policy.
const certifiedContentMechanicsLockDDL = `
CREATE OR REPLACE FUNCTION protect_certified_content_mechanics()
RETURNS TRIGGER AS $$
BEGIN
    IF COALESCE(OLD.support->>'mechanics_locked', 'false') <> 'true' THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'certified content mechanics are locked'
            USING ERRCODE = 'check_violation';
    END IF;

    IF COALESCE(NEW.support->>'mechanics_locked', 'false') <> 'true' THEN
        RAISE EXCEPTION 'certified content mechanics lock cannot be removed'
            USING ERRCODE = 'check_violation';
    END IF;

    IF (to_jsonb(NEW) - ARRAY['support', 'updated_at'])
        IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['support', 'updated_at']) THEN
        RAISE EXCEPTION 'certified content entity cannot be changed'
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS protect_actions_certified_mechanics ON actions;
CREATE TRIGGER protect_actions_certified_mechanics
    BEFORE UPDATE OR DELETE ON actions
    FOR EACH ROW EXECUTE FUNCTION protect_certified_content_mechanics();

DROP TRIGGER IF EXISTS protect_effects_certified_mechanics ON effects;
CREATE TRIGGER protect_effects_certified_mechanics
    BEFORE UPDATE OR DELETE ON effects
    FOR EACH ROW EXECUTE FUNCTION protect_certified_content_mechanics();

DROP TRIGGER IF EXISTS protect_spells_certified_mechanics ON spells;
CREATE TRIGGER protect_spells_certified_mechanics
    BEFORE UPDATE OR DELETE ON spells
    FOR EACH ROW EXECUTE FUNCTION protect_certified_content_mechanics();
`

func lockCertifiedContentMechanics(db *sql.DB) error {
	_, err := db.Exec(certifiedContentMechanicsLockDDL)
	return err
}
