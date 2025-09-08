-- Шаблоны доспехов и щитов D&D 5e

-- Лёгкий доспех
INSERT INTO weapon_templates (name, name_en, category, damage_type, damage, weight, price, properties, image_path, defense_type, armor_class, stealth_disadvantage) VALUES
('Стёганый доспех', 'Padded Armor', 'light_armor', 'defense', '11+ЛОВ', 8.0, 5, '', '/padded_armor.png', 'cloth', '11+ЛОВ', true),
('Кожаный доспех', 'Leather Armor', 'light_armor', 'defense', '11+ЛОВ', 10.0, 10, '', '/leather_armor.png', 'light', '11+ЛОВ', false),
('Проклёпанный кожаный доспех', 'Studded Leather Armor', 'light_armor', 'defense', '12+ЛОВ', 13.0, 45, '', '/studded_leather_armor.png', 'light', '12+ЛОВ', false);

-- Средний доспех
INSERT INTO weapon_templates (name, name_en, category, damage_type, damage, weight, price, properties, image_path, defense_type, armor_class, stealth_disadvantage) VALUES
('Шкурный доспех', 'Hide Armor', 'medium_armor', 'defense', '12+ЛОВ(макс.2)', 12.0, 10, '', '/hide_armor.png', 'medium', '12+ЛОВ(макс.2)', false),
('Кольчужная рубаха', 'Chain Shirt', 'medium_armor', 'defense', '13+ЛОВ(макс.2)', 20.0, 50, '', '/chain_shirt.png', 'medium', '13+ЛОВ(макс.2)', false),
('Чешуйчатый доспех', 'Scale Mail', 'medium_armor', 'defense', '14+ЛОВ(макс.2)', 45.0, 50, '', '/scale_mail.png', 'medium', '14+ЛОВ(макс.2)', true),
('Кираса', 'Breastplate', 'medium_armor', 'defense', '14+ЛОВ(макс.2)', 20.0, 400, '', '/breastplate.png', 'medium', '14+ЛОВ(макс.2)', false),
('Полулаты', 'Half Plate', 'medium_armor', 'defense', '15+ЛОВ(макс.2)', 40.0, 750, '', '/half_plate.png', 'medium', '15+ЛОВ(макс.2)', true);

-- Тяжёлый доспех
INSERT INTO weapon_templates (name, name_en, category, damage_type, damage, weight, price, properties, image_path, defense_type, armor_class, strength_requirement, stealth_disadvantage) VALUES
('Колечный доспех', 'Ring Mail', 'heavy_armor', 'defense', '14', 40.0, 30, '', '/ring_mail.png', 'heavy', '14', null, true),
('Кольчуга', 'Chain Mail', 'heavy_armor', 'defense', '16', 55.0, 75, '', '/chain_mail.png', 'heavy', '16', 13, true),
('Наборный доспех', 'Splint Armor', 'heavy_armor', 'defense', '17', 60.0, 200, '', '/splint_armor.png', 'heavy', '17', 15, true),
('Латы', 'Plate Armor', 'heavy_armor', 'defense', '18', 65.0, 1500, '', '/plate_armor.png', 'heavy', '18', 15, true);

-- Щиты
INSERT INTO weapon_templates (name, name_en, category, damage_type, damage, weight, price, properties, image_path, defense_type, armor_class, stealth_disadvantage) VALUES
('Щит', 'Shield', 'shield', 'defense', '+2', 6.0, 10, '', '/shield.png', 'light', '+2', false);
