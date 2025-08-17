-- Шаблоны оружия D&D 5e

-- Простое рукопашное оружие
INSERT INTO weapon_templates (name, name_en, category, damage_type, damage, weight, price, properties, image_path) VALUES
('Дубина', 'Club', 'simple_melee', 'bludgeoning', '1d4', 2.0, 1, 'light', '/club.png'),
('Кинжал', 'Dagger', 'simple_melee', 'piercing', '1d4', 1.0, 2, 'finesse,light,thrown', '/dagger.png'),
('Большой дубинка', 'Greatclub', 'simple_melee', 'bludgeoning', '1d8', 10.0, 2, 'two-handed', '/greatclub.png'),
('Ручной топор', 'Handaxe', 'simple_melee', 'slashing', '1d6', 2.0, 5, 'light,thrown', '/handaxe.png'),
('Дротик', 'Javelin', 'simple_melee', 'piercing', '1d6', 2.0, 5, 'thrown', '/javelin.png'),
('Легкий молот', 'Light hammer', 'simple_melee', 'bludgeoning', '1d4', 2.0, 2, 'light,thrown', '/light_hammer.png'),
('Копье', 'Spear', 'simple_melee', 'piercing', '1d6', 3.0, 1, 'thrown,versatile', '/spear.png'),
('Булава', 'Mace', 'simple_melee', 'bludgeoning', '1d6', 4.0, 5, '', '/mace.png'),
('Боевой посох', 'Quarterstaff', 'simple_melee', 'bludgeoning', '1d6', 4.0, 2, 'versatile', '/quarterstaff.png'),
('Серп', 'Sickle', 'simple_melee', 'slashing', '1d4', 2.0, 1, 'light', '/sickle.png'),
('Короткий лук', 'Shortbow', 'simple_ranged', 'piercing', '1d6', 2.0, 25, 'ammunition,two-handed', '/shortbow.png'),
('Праща', 'Sling', 'simple_ranged', 'bludgeoning', '1d4', 0.1, 1, 'ammunition', '/sling.png'),
('Короткий меч', 'Shortsword', 'simple_melee', 'piercing', '1d6', 2.0, 10, 'finesse,light', '/shortsword.png'),
('Копье', 'Spear', 'simple_melee', 'piercing', '1d6', 3.0, 1, 'thrown,versatile', '/spear.png'),
('Боевой молот', 'Warhammer', 'simple_melee', 'bludgeoning', '1d8', 2.0, 15, 'versatile', '/warhammer.png');

-- Воинское рукопашное оружие
INSERT INTO weapon_templates (name, name_en, category, damage_type, damage, weight, price, properties, image_path) VALUES
('Боевой топор', 'Battleaxe', 'martial_melee', 'slashing', '1d8', 4.0, 10, 'versatile', '/battleaxe.png'),
('Фламберг', 'Flail', 'martial_melee', 'bludgeoning', '1d8', 2.0, 10, '', '/flail.png'),
('Глефа', 'Glaive', 'martial_melee', 'slashing', '1d10', 6.0, 20, 'heavy,reach,two-handed', '/glaive.png'),
('Алебарда', 'Greataxe', 'martial_melee', 'slashing', '1d12', 7.0, 30, 'heavy,two-handed', '/greataxe.png'),
('Двуручный меч', 'Greatsword', 'martial_melee', 'slashing', '2d6', 6.0, 50, 'heavy,two-handed', '/greatsword.png'),
('Алебарда', 'Halberd', 'martial_melee', 'slashing', '1d10', 6.0, 20, 'heavy,reach,two-handed', '/halberd.png'),
('Копье', 'Lance', 'martial_melee', 'piercing', '1d12', 6.0, 10, 'reach,special', '/lance.png'),
('Длинный меч', 'Longsword', 'martial_melee', 'slashing', '1d8', 3.0, 15, 'versatile', '/longsword.png'),
('Молот', 'Maul', 'martial_melee', 'bludgeoning', '2d6', 10.0, 10, 'heavy,two-handed', '/maul.png'),
('Морнингстар', 'Morningstar', 'martial_melee', 'piercing', '1d8', 4.0, 15, '', '/morningstar.png'),
('Пика', 'Pike', 'martial_melee', 'piercing', '1d10', 18.0, 5, 'heavy,reach,two-handed', '/pike.png'),
('Рапира', 'Rapier', 'martial_melee', 'piercing', '1d8', 2.0, 25, 'finesse', '/rapier.png'),
('Скимитар', 'Scimitar', 'martial_melee', 'slashing', '1d6', 3.0, 25, 'finesse,light', '/scimitar.png'),
('Щит', 'Shield', 'martial_melee', 'bludgeoning', '1d4', 6.0, 10, '', '/shield.png'),
('Трезубец', 'Trident', 'martial_melee', 'piercing', '1d6', 4.0, 5, 'thrown,versatile', '/trident.png'),
('Боевой меч', 'War pick', 'martial_melee', 'piercing', '1d8', 2.0, 5, '', '/warpick.png'),
('Боевой молот', 'Warhammer', 'martial_melee', 'bludgeoning', '1d8', 2.0, 15, 'versatile', '/warhammer.png'),
('Кнут', 'Whip', 'martial_melee', 'slashing', '1d4', 3.0, 2, 'finesse,reach', '/whip.png');

-- Простое дальнобойное оружие
INSERT INTO weapon_templates (name, name_en, category, damage_type, damage, weight, price, properties, image_path) VALUES
('Легкий арбалет', 'Light crossbow', 'simple_ranged', 'piercing', '1d8', 5.0, 25, 'ammunition,loading,two-handed', '/light_crossbow.png'),
('Дротик', 'Dart', 'simple_ranged', 'piercing', '1d4', 0.25, 5, 'finesse,thrown', '/dart.png'),
('Праща', 'Sling', 'simple_ranged', 'bludgeoning', '1d4', 0.1, 1, 'ammunition', '/sling.png');

-- Воинское дальнобойное оружие
INSERT INTO weapon_templates (name, name_en, category, damage_type, damage, weight, price, properties, image_path) VALUES
('Тяжелый арбалет', 'Heavy crossbow', 'martial_ranged', 'piercing', '1d10', 18.0, 50, 'ammunition,heavy,loading,two-handed', '/heavy_crossbow.png'),
('Длинный лук', 'Longbow', 'martial_ranged', 'piercing', '1d8', 2.0, 50, 'ammunition,heavy,two-handed', '/longbow.png'),
('Сетка', 'Net', 'martial_ranged', 'bludgeoning', '0', 3.0, 1, 'thrown,special', '/net.png');
