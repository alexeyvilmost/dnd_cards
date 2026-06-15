-- Дополнительный стихийный урон для оружия
ALTER TABLE cards ADD COLUMN IF NOT EXISTS elemental_damage_value VARCHAR(20);
ALTER TABLE cards ADD COLUMN IF NOT EXISTS elemental_damage_type VARCHAR(20);
