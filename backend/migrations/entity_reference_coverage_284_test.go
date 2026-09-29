package migrations

import (
	"fmt"
	"reflect"
	"sort"
	"testing"
)

func TestEntityReferenceCoverage284ExtractsDeclaredFormulasAndItemVariants(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "ENTITY_REFERENCE_TEST_DATABASE_URL")
	if _, err := db.Exec(entityReferences277SQL); err != nil {
		t.Fatal(err)
	}
	if err := expandEntityReferenceCoverage284(db); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name, kind, document string
		want                 []extractedReference277
	}{
		{
			"action save and illusion formula", "action",
			`{"mechanics":{"effects":[{"resolution":"save","dc":"8 + custom_save + class_level:custom_class"},{"kind":"illusion","investigation_dc":"custom_investigation"}],"uses":{"limit":"custom_limit"}}}`,
			[]extractedReference277{
				{"class", "custom_class", 0, "mechanics.effects[0].dc"},
				{"$variable", "custom_save", 0, "mechanics.effects[0].dc"},
				{"$variable", "custom_investigation", 0, "mechanics.effects[1].investigation_dc"},
				{"$variable", "custom_limit", 0, "mechanics.uses.limit"},
			},
		},
		{
			"second entity transformation and named formula bindings", "effect",
			`{"mechanics":{"kind":"triggered_effect","formula_bindings":{"resource":"first_bonus","effect_id":"second_bonus"},"event_formula_bindings":{"burst":"later_bonus + class_level:second_class"},"effects":[{"result":[{"kind":"transform","cr_max":"custom_cr"}]}]}}`,
			[]extractedReference277{
				{"$variable", "first_bonus", 0, "mechanics.formula_bindings.resource"},
				{"$variable", "second_bonus", 0, "mechanics.formula_bindings.effect_id"},
				{"$variable", "later_bonus", 0, "mechanics.event_formula_bindings.burst"},
				{"class", "second_class", 0, "mechanics.event_formula_bindings.burst"},
				{"$variable", "custom_cr", 0, "mechanics.effects[0].result[0].cr_max"},
			},
		},
		{
			"legacy armor formula and independent item references", "card",
			`{"bonus_value":"10 + class_level:armor_class","mechanics":{"requires_item_source":"CARD-gate","primitive":{"type":"item_light","policy":{"item_card_id":"CARD-light","requires_fuel_card_id":"CARD-fuel","granted_action_refs":["ACTION-off"]}}}}`,
			[]extractedReference277{
				{"class", "armor_class", 0, "bonus_value"},
				{"card", "CARD-gate", 0, "mechanics.requires_item_source"},
				{"card", "CARD-light", 0, "mechanics.primitive.policy.item_card_id"},
				{"card", "CARD-fuel", 0, "mechanics.primitive.policy.requires_fuel_card_id"},
				{"action", "ACTION-off", 0, "mechanics.primitive.policy.granted_action_refs[0]"},
			},
		},
		{
			"portable space and equipped item prerequisite", "action",
			`{"mechanics":{"requires_runtime_action_grant":["ACTION-open"],"primitive":{"type":"item_tool","policy":{"key_item_card_id":"CARD-key","entry_action_ref":"ACTION-enter","exit_action_ref":"ACTION-exit"}},"effects":[{"result":[{"kind":"condition_immunity","condition":"poisoned","requires_equipped_item_id":"CARD-ward"}]}]}}`,
			[]extractedReference277{
				{"action", "ACTION-open", 0, "mechanics.requires_runtime_action_grant[0]"},
				{"card", "CARD-key", 0, "mechanics.primitive.policy.key_item_card_id"},
				{"action", "ACTION-enter", 0, "mechanics.primitive.policy.entry_action_ref"},
				{"action", "ACTION-exit", 0, "mechanics.primitive.policy.exit_action_ref"},
				{"effect", "poisoned", 0, "mechanics.effects[0].result[0].condition"},
				{"card", "CARD-ward", 0, "mechanics.effects[0].result[0].requires_equipped_item_id"},
			},
		},
		{
			"spell variant parent and children", "spell",
			`{"mechanics":{"variant_of_spell_id":"SPELL-parent","spell_variant_ids":["SPELL-first","SPELL-second"]}}`,
			[]extractedReference277{
				{"spell", "SPELL-parent", 0, "mechanics.variant_of_spell_id"},
				{"spell", "SPELL-first", 0, "mechanics.spell_variant_ids[0]"},
				{"spell", "SPELL-second", 0, "mechanics.spell_variant_ids[1]"},
			},
		},
		{
			"action variant parent and children", "action",
			`{"mechanics":{"variant_of_action_id":"ACTION-parent","action_variant_ids":["ACTION-first","ACTION-second"]}}`,
			[]extractedReference277{
				{"action", "ACTION-parent", 0, "mechanics.variant_of_action_id"},
				{"action", "ACTION-first", 0, "mechanics.action_variant_ids[0]"},
				{"action", "ACTION-second", 0, "mechanics.action_variant_ids[1]"},
			},
		},
		{
			"text and runtime identities are still ignored", "action",
			`{"description":"class_level:not_a_class","bonus_value":"not_a_variable","mechanics":{"notes":{"dc":"not_a_variable"},"description":"not_a_variable","effects":[{"kind":"narrative","dc":"not_a_variable"},{"kind":"damage_rider","bound_weapon_id":"runtime-weapon","attack_maneuver_id":"runtime-maneuver","instance_id":"runtime-instance","stack_id":"runtime-stack"}]}}`,
			[]extractedReference277{},
		},
		{
			"explicit class levels retained without default level", "class",
			`{"related_actions":["ACTION-base"],"level_progression":{"4":{"effects":[{"kind":"triggered_effect","formula_bindings":{"held":"level_bonus"}}]}}}`,
			[]extractedReference277{
				{"action", "ACTION-base", 0, "related_actions[0]"},
				{"$variable", "level_bonus", 4, "level_progression.4.effects[0].formula_bindings.held"},
			},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			got := extractReferences277(t, db, test.kind, test.document)
			sort.Slice(test.want, func(i, j int) bool { return fmt.Sprint(test.want[i]) < fmt.Sprint(test.want[j]) })
			if !reflect.DeepEqual(got, test.want) {
				t.Fatalf("references = %#v, want %#v", got, test.want)
			}
		})
	}
}

func TestEntityReferenceCoverage284RejectsAmbiguousStableAliases(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "ENTITY_REFERENCE_TEST_DATABASE_URL")
	if _, err := db.Exec(`CREATE TABLE effects(id text PRIMARY KEY,name text,card_number text,mechanics jsonb);
		CREATE TABLE classes(id text PRIMARY KEY,name text,card_number text);
		CREATE TABLE spells(id text PRIMARY KEY,name text,name_en text,card_number text);
		INSERT INTO effects VALUES('condition-one','One','COND-one','{"condition":{"id":"duplicate_condition"}}'),
		('condition-two','Two','COND-two','{"condition":{"id":"duplicate_condition"}}'),
		('source','Source','EFFECT-source','{"effects":[{"kind":"condition","value":"duplicate_condition"},{"kind":"damage","amount":"class_level:duplicate_class"}]}');
		INSERT INTO classes VALUES('class-one','One','CLASS-duplicate-class'),('class-two','Two','CLASS-duplicate_class');
		INSERT INTO spells VALUES('spell-name','Name','Unique Spell','SPELL-alias'),('spell-stable','Stable','Other Name','unique_spell');`); err != nil {
		t.Fatal(err)
	}
	if err := enableEntityReferences277(db); err != nil {
		t.Fatal(err)
	}
	if err := expandEntityReferenceCoverage284(db); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		kind, key string
		want      int
	}{
		{"effect", "duplicate_condition", 0}, {"class", "duplicate_class", 0},
		{"effect", "COND-one", 1}, {"effect", "condition-two", 1},
		{"class", "CLASS-duplicate-class", 1}, {"spell", "unique_spell", 1},
	} {
		var count int
		if err := db.QueryRow(`SELECT count(*) FROM entity_reference_targets($1,$2)`, test.kind, test.key).Scan(&count); err != nil || count != test.want {
			t.Fatalf("resolve %s/%s = %d, want %d: %v", test.kind, test.key, count, test.want, err)
		}
	}
	var stable string
	if err := db.QueryRow(`SELECT entity_id FROM entity_reference_targets('spell','unique_spell')`).Scan(&stable); err != nil || stable != "spell-stable" {
		t.Fatalf("unique stable identity failed to beat display alias: %s: %v", stable, err)
	}
	var valid, missing int
	if err := db.QueryRow(`SELECT count(*) FILTER (WHERE NOT missing),count(*) FILTER (WHERE missing) FROM entity_reference_resolved_edges WHERE source_id='source'`).Scan(&valid, &missing); err != nil || valid != 0 || missing != 2 {
		t.Fatalf("ambiguous references fanned out: valid %d, missing %d: %v", valid, missing, err)
	}
	// Deleting the conflicting target resolves the original edge immediately.
	if _, err := db.Exec(`DELETE FROM effects WHERE id='condition-two'; DELETE FROM classes WHERE id='class-two'`); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT count(*) FROM entity_reference_resolved_edges WHERE source_id='source' AND NOT missing`).Scan(&valid); err != nil || valid != 2 {
		t.Fatalf("references did not recover after removing ambiguity: %d: %v", valid, err)
	}
}

func TestEntityReferenceCoverage284ReindexesWithoutChangingCatalogOrHistory(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "ENTITY_REFERENCE_TEST_DATABASE_URL")
	before := map[string]string{}
	for _, table := range manualContentReviewTables {
		idColumn := "id"
		if table == "passive_presentations" {
			idColumn = "key"
		}
		if _, err := db.Exec(fmt.Sprintf(`CREATE TABLE %s(%s text PRIMARY KEY,name text,description text,mechanics jsonb,support jsonb,deleted_at timestamptz);
			INSERT INTO %s VALUES('source-%s','Original','Display text','{"effects":[{"resolution":"save","dc":"formula_var"}]}','{"status":"verified"}',NULL)`, table, idColumn, table, table)); err != nil {
			t.Fatal(err)
		}
		var snapshot string
		if err := db.QueryRow(fmt.Sprintf(`SELECT jsonb_agg(t)::text FROM %s t`, table)).Scan(&snapshot); err != nil {
			t.Fatal(err)
		}
		before[table] = snapshot
	}
	if _, err := db.Exec(`CREATE TABLE reference_284_history(snapshot jsonb); INSERT INTO reference_284_history VALUES('{"effect":{"mechanics":{"dc":"formula_var"}},"roll":17}')`); err != nil {
		t.Fatal(err)
	}
	if err := enableEntityReferences277(db); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := db.QueryRow(`SELECT count(*) FROM entity_reference_edges WHERE target_key='formula_var'`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("old extractor unexpectedly indexed dc: %d: %v", count, err)
	}
	for repeat := 0; repeat < 2; repeat++ {
		if err := expandEntityReferenceCoverage284(db); err != nil {
			t.Fatal(err)
		}
	}
	if err := db.QueryRow(`SELECT count(*) FROM entity_reference_edges WHERE target_key='formula_var'`).Scan(&count); err != nil || count != len(manualContentReviewTables) {
		t.Fatalf("backfill count %d, want %d: %v", count, len(manualContentReviewTables), err)
	}
	for table, expected := range before {
		var snapshot string
		if err := db.QueryRow(fmt.Sprintf(`SELECT jsonb_agg(t)::text FROM %s t`, table)).Scan(&snapshot); err != nil || snapshot != expected {
			t.Fatalf("catalog %s changed: %v", table, err)
		}
	}
	var unchanged bool
	if err := db.QueryRow(`SELECT snapshot='{"effect":{"mechanics":{"dc":"formula_var"}},"roll":17}'::jsonb FROM reference_284_history`).Scan(&unchanged); err != nil || !unchanged {
		t.Fatalf("history changed: %v", err)
	}
	// The trigger also uses the new extractor for future entities and edits.
	if _, err := db.Exec(`UPDATE actions SET mechanics='{"effects":[{"resolution":"save","dc":"replacement_var"}]}'`); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT count(*) FROM entity_reference_edges WHERE source_type='action' AND target_key='replacement_var'`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("new mechanic was not indexed: %d: %v", count, err)
	}
}
