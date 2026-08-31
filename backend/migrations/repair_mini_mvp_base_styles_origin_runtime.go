package migrations

import (
	"database/sql"
	"fmt"
)

const miniMVPBaseStylesOriginMigrationVersion = "124_repair_mini_mvp_base_styles_origin_runtime"

// repairMiniMVPBaseStylesOriginRuntime replaces the last narrative-only origin-feat
// declarations with contracts consumed by the shared sheet/combat runtime. It also
// adds the two base actions needed to spend Divine/Heroic Inspiration. The guard is
// disabled only inside this transaction and is restored before commit.
func repairMiniMVPBaseStylesOriginRuntime(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err = tx.Exec(`
		DROP TRIGGER IF EXISTS protect_actions_certified_mechanics ON actions;
		DROP TRIGGER IF EXISTS protect_effects_certified_mechanics ON effects;
	`); err != nil {
		return fmt.Errorf("disable certified mechanics guards: %w", err)
	}

	if _, err = tx.Exec(`
		UPDATE actions SET
			name = 'Божественное вдохновение', type = 'basic', resource = 'action',
			description = 'Раз в день выберите союзника в 60 фт. Его следующий бросок к20 считается равным 20 после всех модификаторов. Эффект расходуется первым подходящим броском.',
			mechanics = '{
			  "activation":{"mode":"active","cost":[{"resource":"action","amount":1}]},
			  "uses":{"count":1,"per":"long_rest"},
			  "targeting":{"domain":"actor","actor_targets":true,"shape":"single","min_targets":1,"max_targets":1,"range_ft":60,"requires_line_of_sight":true,"allowed_relations":["ally"]},
			  "effects":[{"resolution":"auto","who":"target","result":[{"kind":"modifier","applies_to":{"roll":"d20"},"op":"minimum_total","value":20,"consume":"next","source":"Божественное вдохновение"}]}]
			}'::jsonb, support = NULL, updated_at = NOW()
		WHERE card_number = 'ACTION-0005' AND deleted_at IS NULL;

		INSERT INTO actions (
			id, name, name_en, description, image_url, rarity, card_number,
			action_type, type, resource, mechanics, author, source
		) VALUES (
			'12400000-0000-4000-8000-000000000004', 'Использовать героическое вдохновение',
			'Use Heroic Inspiration',
			'Сразу после броска потратьте Героическое вдохновение: перебросьте одну кость и обязательно используйте новый результат. Журнал явно напомнит этот порядок.',
			'', 'common', 'action_basic_heroic_inspiration', 'base_action', 'basic', 'heroic_inspiration',
			'{
			  "activation":{"mode":"active","cost":[{"resource":"heroic_inspiration","amount":1}]},
			  "targeting":{"domain":"actor","actor_targets":false,"shape":"self","min_targets":0,"max_targets":1,"range_ft":0,"requires_line_of_sight":false,"allowed_relations":["self"]},
			  "effects":[{"resolution":"auto","result":[{"kind":"reroll","which":"любую кость","keep":"new"}]}]
			}'::jsonb, 'System', 'PHB 2024'
		)
		ON CONFLICT (card_number) DO UPDATE SET
			deleted_at = NULL, name = EXCLUDED.name, name_en = EXCLUDED.name_en,
			description = EXCLUDED.description, action_type = EXCLUDED.action_type,
			type = EXCLUDED.type, resource = EXCLUDED.resource,
			mechanics = EXCLUDED.mechanics, support = NULL, updated_at = NOW();

		UPDATE actions SET mechanics = '{
		  "activation":{"mode":"active","cost":[{"resource":"luck_points","amount":1}]},
		  "targeting":{"domain":"actor","actor_targets":false,"shape":"self","min_targets":0,"max_targets":1,"range_ft":0,"requires_line_of_sight":false,"allowed_relations":["self"]},
		  "effects":[{"resolution":"auto","result":[{"kind":"modifier","applies_to":{"roll":"d20"},"op":"advantage","consume":"next","source":"Везунчик: дополнительный к20"}]}]
		}'::jsonb,
		description = 'Потратьте очко удачи, чтобы следующий ваш бросок к20 использовал дополнительную кость. Движок покажет обе кости и выбранный результат.',
		resource = 'luck_points', support = NULL, updated_at = NOW()
		WHERE card_number = 'ACT-feat-lucky-advantage' AND deleted_at IS NULL;

		UPDATE actions SET mechanics = '{
		  "activation":{"mode":"active","cost":[{"resource":"luck_points","amount":1}]},
		  "targeting":{"domain":"actor","actor_targets":true,"shape":"single","min_targets":1,"max_targets":1,"range_ft":60,"requires_line_of_sight":true,"allowed_relations":["enemy","neutral"]},
		  "effects":[{"resolution":"auto","who":"target","result":[{"kind":"modifier","applies_to":{"roll":"attack"},"op":"disadvantage","consume":"next","source":"Везунчик: помеха атакующему"}]}]
		}'::jsonb,
		description = 'Потратьте очко удачи и выберите видимого атакующего: его следующий бросок атаки использует дополнительный к20 и худший результат. Эффект виден у цели.',
		resource = 'luck_points', support = NULL, updated_at = NOW()
		WHERE card_number = 'ACT-feat-lucky-disadvantage' AND deleted_at IS NULL;

		UPDATE effects SET mechanics = '{
		  "activation":{"mode":"passive"},
		  "effects":[{"resolution":"auto","result":[{"kind":"modifier","applies_to":{"roll":"damage","filter":{"attackKind":"weapon_melee"}},"op":"reroll_damage","keep":"highest","once_per_turn":"origin_feat.savage_attacker","source":"Дикий атакующий"}]}]
		}'::jsonb,
		description = 'Один раз за каждый свой ход при попадании оружием ближнего боя движок бросает все кости урона повторно, показывает оба набора и оставляет лучший общий результат.',
		support = NULL, updated_at = NOW()
		WHERE card_number = 'EFF-savage-attacker' AND deleted_at IS NULL;

		UPDATE effects SET mechanics = '{
		  "activation":{"mode":"passive"},
		  "effects":[{"resolution":"auto","result":[
		    {"kind":"unarmed_damage_profile","dice":"1d4","ability":"str"},
		    {"kind":"modifier","applies_to":{"roll":"damage","filter":{"attackKind":"unarmed"}},"op":"reroll_damage","natural":{"max":1},"keep":"new","source":"Дебошир: переброс единицы"}
		  ]}]
		}'::jsonb,
		description = 'Безоружный удар наносит 1к4 + СИЛ. Натуральная 1 на кости урона перебрасывается один раз; новый результат обязателен и виден в журнале.',
		support = NULL, updated_at = NOW()
		WHERE card_number = 'EFF-feat-brawler-unarmed' AND deleted_at IS NULL;

		UPDATE effects SET mechanics = '{
		  "activation":{"mode":"passive"},
		  "effects":[{"resolution":"auto","result":[{"kind":"grant_proficiency","prof":"weapon","value":"improvised"}]}]
		}'::jsonb,
		description = 'Вы владеете импровизированным оружием. Владение отражается в разделе владений персонажа.',
		support = NULL, updated_at = NOW()
		WHERE card_number = 'EFF-feat-brawler-improvised' AND deleted_at IS NULL;

		UPDATE effects SET mechanics = '{
		  "activation":{"mode":"passive"},
		  "effects":[{"resolution":"auto","result":[{"kind":"narrative","description":"После попадания Безоружным ударом появляется необязательное действие «Дебошир: толкнуть на 5 фт»."}]}]
		}'::jsonb,
		description = 'После попадания Безоружным ударом можно бесплатно толкнуть цель на 5 фт. Предложение появляется только после подходящего попадания.',
		support = NULL, updated_at = NOW()
		WHERE card_number = 'EFF-feat-brawler-push' AND deleted_at IS NULL;

		INSERT INTO actions (
			id, name, name_en, description, image_url, rarity, card_number,
			action_type, type, resource, mechanics, author, source
		) VALUES (
			'12400000-0000-4000-8000-000000000001', 'Дебошир: толкнуть на 5 фт',
			'Brawler: Push', 'После попадания Безоружным ударом бесплатно оттолкните поражённую цель на 5 футов.',
			'', 'common', 'ACT-feat-brawler-push', 'class_feature', 'origin_feat', NULL,
			'{
			  "activation":{"mode":"triggered","optional":true,"trigger":{"event":"hit","source_action_card_number":"action_basic_unarmed"},"cost":[]},
			  "targeting":{"domain":"actor","actor_targets":true,"shape":"single","min_targets":1,"max_targets":1,"range_ft":5,"requires_line_of_sight":true,"allowed_relations":["enemy","neutral"]},
			  "effects":[{"resolution":"auto","who":"target","result":[{"kind":"movement","value":"push","distance":5}]}]
			}'::jsonb, 'System', 'PHB 2024'
		)
		ON CONFLICT (card_number) DO UPDATE SET
			deleted_at = NULL, name = EXCLUDED.name, description = EXCLUDED.description,
			mechanics = EXCLUDED.mechanics, support = NULL, updated_at = NOW();

		UPDATE actions SET mechanics = '{
		  "activation":{"mode":"active","cost":[{"resource":"action","amount":1},{"resource":"item","card_id":"6112aaef-39b3-4b91-a0fa-96f56987ebb2","amount":1}]},
		  "targeting":{"domain":"actor","actor_targets":true,"shape":"single","min_targets":1,"max_targets":1,"range_ft":5,"requires_line_of_sight":true,"allowed_relations":["self","ally"]},
		  "effects":[{"resolution":"auto","who":"target","result":[{"kind":"healing","hit_die":"target","spend_hit_die":true}]}]
		}'::jsonb,
		description = 'Действием потратьте одно использование Комплекта целителя. Цель в 5 фт тратит одну Кость хитов и восстанавливает результат этой кости + ваш бонус владения.',
		resource = 'action,item', support = NULL, updated_at = NOW()
		WHERE card_number = 'ACT-feat-healer-medic' AND deleted_at IS NULL;

		UPDATE effects SET mechanics = '{
		  "activation":{"mode":"passive"},
		  "effects":[{"resolution":"auto","result":[{"kind":"modifier","applies_to":{"roll":"healing"},"op":"reroll_healing_ones","source":"Лекарь: переброс лечения"}]}]
		}'::jsonb,
		description = 'Когда вы бросаете кость лечения заклинанием или Полевым медиком, каждая натуральная 1 перебрасывается один раз; новый результат обязателен и показан в журнале.',
		support = NULL, updated_at = NOW()
		WHERE card_number = 'EFF-feat-healer-reroll' AND deleted_at IS NULL;

		INSERT INTO actions (
			id, name, name_en, description, image_url, rarity, card_number,
			action_type, type, resource, mechanics, author, source
		) VALUES (
			'12400000-0000-4000-8000-000000000002', 'Ободряющая песня',
			'Encouraging Song',
			'После короткого или долгого отдыха выберите до шести слышащих союзников (не больше вашего бонуса владения). Каждый получает одно Героическое вдохновение, если у него его ещё нет.',
			'', 'common', 'ACT-feat-musician-song', 'class_feature', 'origin_feat', NULL,
			'{
			  "activation":{"mode":"active","cost":[]},
			  "uses":{"count":1,"per":"short_rest"},
			  "targeting":{"domain":"actor","actor_targets":true,"shape":"multiple","min_targets":1,"max_targets":6,"range_ft":60,"requires_line_of_sight":false,"allowed_relations":["ally"]},
			  "effects":[{"resolution":"auto","who":"target","result":[{"kind":"resource","op":"grant_capped","id":"heroic_inspiration","amount":1,"max":1}]}]
			}'::jsonb, 'System', 'PHB 2024'
		)
		ON CONFLICT (card_number) DO UPDATE SET
			deleted_at = NULL, name = EXCLUDED.name, description = EXCLUDED.description,
			mechanics = EXCLUDED.mechanics, support = NULL, updated_at = NOW();

		UPDATE effects SET mechanics = '{
		  "activation":{"mode":"passive"},
		  "effects":[{"resolution":"auto","result":[{"kind":"narrative","description":"После отдыха используйте действие «Ободряющая песня»: выбранные слышащие союзники получают по одному Героическому вдохновению."}]}]
		}'::jsonb,
		description = 'После короткого или долгого отдыха сыграйте на известном инструменте и выдайте Героическое вдохновение числу слышащих союзников не больше бонуса владения.',
		support = NULL, updated_at = NOW()
		WHERE card_number = 'EFF-feat-musician-song' AND deleted_at IS NULL;

		UPDATE effects SET mechanics = '{
		  "activation":{"mode":"passive"},
		  "effects":[{"resolution":"auto","result":[{"kind":"modifier","applies_to":{"value":"nonmagical_purchase_price"},"op":"multiply","value":0.8,"source":"Самоделкин: скидка 20%"}]}]
		}'::jsonb,
		description = 'Цена покупки немагического предмета умножается на 0,8. Карточка показывает точную формулу скидки; боевого применения нет.',
		support = NULL, updated_at = NOW()
		WHERE card_number = 'EFF-feat-crafter-discount' AND deleted_at IS NULL;

		UPDATE effects SET mechanics = '{
		  "activation":{"mode":"passive"},
		  "effects":[{"resolution":"auto","result":[{"kind":"narrative","description":"После долгого отдыха используйте действие «Быстрое изготовление». Созданный предмет помечается временным и исчезает при следующем долгом отдыхе."}]}]
		}'::jsonb,
		description = 'После долгого отдыха изготовьте один разрешённый предмет выбранными Ремесленными инструментами. Предмет существует до следующего долгого отдыха.',
		support = NULL, updated_at = NOW()
		WHERE card_number = 'EFF-feat-crafter-fabric' AND deleted_at IS NULL;

		INSERT INTO actions (
			id, name, name_en, description, image_url, rarity, card_number,
			action_type, type, resource, mechanics, author, source
		) VALUES (
			'12400000-0000-4000-8000-000000000003', 'Быстрое изготовление',
			'Fast Crafting',
			'После долгого отдыха выберите предмет из таблицы Быстрого изготовления. Он появится в инвентаре как временный и распадётся после следующего долгого отдыха.',
			'', 'common', 'ACT-feat-crafter-fast-craft', 'class_feature', 'origin_feat', NULL,
			'{
			  "activation":{"mode":"active","cost":[]},
			  "uses":{"count":1,"per":"long_rest"},
			  "targeting":{"domain":"actor","actor_targets":false,"shape":"self","min_targets":0,"max_targets":1,"range_ft":0,"requires_line_of_sight":false,"allowed_relations":["self"]},
			  "effects":[{"resolution":"auto","result":[{"kind":"choice","id":"crafter_fast_item","context":"in_play","prompt":"Что изготовить? Выберите предмет, соответствующий одному из ваших Ремесленных инструментов.","count":1,"options":{"source":"item","items":[
			    {"id":"14db2ea7-22cd-46fe-89e2-39dd9a0f2fcd","name":"Лестница","temporary_until":"long_rest"},
			    {"id":"124781fb-abb9-43bd-8a2a-c07e4c539b6a","name":"Факел","temporary_until":"long_rest"},
			    {"id":"fdd3770f-0eda-446d-bd78-5944f4d95d9d","name":"Кошель","temporary_until":"long_rest"},
			    {"id":"323179a5-49b2-4276-aa2f-4e9ec42086de","name":"Тубус для карты или свитка","temporary_until":"long_rest"},
			    {"id":"5b2aeac7-ae9a-41f4-84dc-0777af70c290","name":"Футляр для арбалетных болтов","temporary_until":"long_rest"},
			    {"id":"d41ec73e-22fc-4fe5-aa0b-ddfbf8111258","name":"Кувшин","temporary_until":"long_rest"},
			    {"id":"328bc399-d788-41c6-aa9f-6b075b872b49","name":"Лампа","temporary_until":"long_rest"},
			    {"id":"8a84417a-3d89-46b4-9744-df4b3eaea38c","name":"Железный горшок","temporary_until":"long_rest"},
			    {"id":"e58dc828-755d-4489-848d-bec20f08bd67","name":"Калтропы","temporary_until":"long_rest"},
			    {"id":"ab53c0db-fc33-47f6-b511-36d22700fc25","name":"Крюк-кошка","temporary_until":"long_rest"},
			    {"id":"ce496a7b-b8f6-4c63-a06c-4e99b11d9fed","name":"Шарики","temporary_until":"long_rest"},
			    {"id":"b853dbbd-a937-48bb-8f49-e673e4664420","name":"Колокольчик","temporary_until":"long_rest"},
			    {"id":"82d9b938-ad51-4d24-94b9-72d96593b9a1","name":"Лопата","temporary_until":"long_rest"},
			    {"id":"a51c997c-506b-4982-aeb0-ee7f5b0725b1","name":"Трутница","temporary_until":"long_rest"},
			    {"id":"92569148-d1f0-4b6e-8746-85641fe0f154","name":"Корзина","temporary_until":"long_rest"},
			    {"id":"7ee22a41-3d43-4238-b032-229bcfae19e5","name":"Палатка","temporary_until":"long_rest"},
			    {"id":"c2912cfa-f4ef-477e-ba9b-215a57a1640f","name":"Сеть","temporary_until":"long_rest"},
			    {"id":"416ce3b6-193e-4186-a481-09375444c090","name":"Боевой посох","temporary_until":"long_rest"},
			    {"id":"2481665f-ce54-46cf-b2b7-d1fce3b8f1e3","name":"Дубинка","temporary_until":"long_rest"},
			    {"id":"e0a1174c-7a7a-4db0-9a57-175e61487691","name":"Палица","temporary_until":"long_rest"}
			  ]}}]}]
			}'::jsonb, 'System', 'PHB 2024'
		)
		ON CONFLICT (card_number) DO UPDATE SET
			deleted_at = NULL, name = EXCLUDED.name, description = EXCLUDED.description,
			mechanics = EXCLUDED.mechanics, support = NULL, updated_at = NOW();

		UPDATE feats SET related_actions = CASE
		  WHEN COALESCE(related_actions, '[]'::jsonb) @> '["12400000-0000-4000-8000-000000000001"]'::jsonb THEN related_actions
		  ELSE COALESCE(related_actions, '[]'::jsonb) || '["12400000-0000-4000-8000-000000000001"]'::jsonb END,
		  updated_at = NOW()
		WHERE card_number = 'FEAT-0003' AND deleted_at IS NULL;

		UPDATE feats SET related_actions = CASE
		  WHEN COALESCE(related_actions, '[]'::jsonb) @> '["12400000-0000-4000-8000-000000000002"]'::jsonb THEN related_actions
		  ELSE COALESCE(related_actions, '[]'::jsonb) || '["12400000-0000-4000-8000-000000000002"]'::jsonb END,
		  updated_at = NOW()
		WHERE card_number = 'FEAT-0007' AND deleted_at IS NULL;

		UPDATE feats SET related_actions = CASE
		  WHEN COALESCE(related_actions, '[]'::jsonb) @> '["12400000-0000-4000-8000-000000000003"]'::jsonb THEN related_actions
		  ELSE COALESCE(related_actions, '[]'::jsonb) || '["12400000-0000-4000-8000-000000000003"]'::jsonb END,
		  updated_at = NOW()
		WHERE card_number = 'FEAT-0010' AND deleted_at IS NULL;
	`); err != nil {
		return fmt.Errorf("rewrite mini-MVP contracts: %w", err)
	}

	var repaired int
	if err = tx.QueryRow(`
		SELECT
		  (SELECT count(*) FROM actions WHERE card_number IN (
		    'ACTION-0005','action_basic_heroic_inspiration',
		    'ACT-feat-lucky-advantage','ACT-feat-lucky-disadvantage',
		    'ACT-feat-brawler-push','ACT-feat-healer-medic',
		    'ACT-feat-musician-song','ACT-feat-crafter-fast-craft'
		  ) AND deleted_at IS NULL)
		  +
		  (SELECT count(*) FROM effects WHERE card_number IN (
		    'EFF-savage-attacker','EFF-feat-brawler-unarmed',
		    'EFF-feat-brawler-improvised','EFF-feat-brawler-push',
		    'EFF-feat-healer-reroll','EFF-feat-musician-song',
		    'EFF-feat-crafter-discount','EFF-feat-crafter-fabric'
		  ) AND deleted_at IS NULL)
	`).Scan(&repaired); err != nil {
		return fmt.Errorf("verify repaired entity cardinality: %w", err)
	}
	if repaired != 16 {
		return fmt.Errorf("mini-MVP repair expected 16 entities, found %d", repaired)
	}

	if _, err = tx.Exec(certifiedContentMechanicsOnlyLockDDL); err != nil {
		return fmt.Errorf("restore certified mechanics guards: %w", err)
	}
	return tx.Commit()
}
