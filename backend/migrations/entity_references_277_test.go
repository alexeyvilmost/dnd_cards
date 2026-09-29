package migrations

import (
	"database/sql"
	"fmt"
	"reflect"
	"sort"
	"testing"
)

type extractedReference277 struct {
	Kind  string
	Key   string
	Level int
	Path  string
}

func extractReferences277(t *testing.T, db *sql.DB, kind, document string) []extractedReference277 {
	t.Helper()
	rows, err := db.Query(`SELECT target_type,target_key,level,path FROM entity_reference_extract($1,$2::jsonb)`, kind, document)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	result := []extractedReference277{}
	for rows.Next() {
		var reference extractedReference277
		if err := rows.Scan(&reference.Kind, &reference.Key, &reference.Level, &reference.Path); err != nil {
			t.Fatal(err)
		}
		result = append(result, reference)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	sort.Slice(result, func(i, j int) bool { return fmt.Sprint(result[i]) < fmt.Sprint(result[j]) })
	return result
}

func TestEntityReferences277ExtractsMechanicsAcrossDifferentEntities(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "ENTITY_REFERENCE_TEST_DATABASE_URL")
	if _, err := db.Exec(entityReferences277SQL); err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name, kind, document string
		want                 []extractedReference277
	}{
		{
			name: "class preserves every progression level", kind: "class",
			document: `{"name":"Class [[EFFECT-text]]","description":"[[EFFECT-prose]]","related_actions":["ACTION-base"],"level_progression":{"1":{"effects":["EFFECT-repeat"]},"5":{"effects":["EFFECT-repeat"],"actions":["ACTION-five"]}},"equipment_options":{"option_a":{"items":[{"card_id":"CARD-kit","quantity":2}],"gold":5}}}`,
			want: []extractedReference277{
				{"action", "ACTION-base", 1, "related_actions[0]"},
				{"effect", "EFFECT-repeat", 1, "level_progression.1.effects[0]"},
				{"effect", "EFFECT-repeat", 5, "level_progression.5.effects[0]"},
				{"action", "ACTION-five", 5, "level_progression.5.actions[0]"},
				{"card", "CARD-kit", 1, "equipment_options.option_a.items[0].card_id"},
			},
		},
		{
			name: "race is independently data driven", kind: "race",
			document: `{"traits":[{"name":"EFFECT-false","description":"[[other|effect:EFFECT-prose]]"}],"related_effects":["EFFECT-born"],"level_progression":{"3":{"actions":["ACTION-lineage"]},"7":{"effects":["EFFECT-grown"]}}}`,
			want: []extractedReference277{
				{"effect", "EFFECT-born", 1, "related_effects[0]"},
				{"action", "ACTION-lineage", 3, "level_progression.3.actions[0]"},
				{"effect", "EFFECT-grown", 7, "level_progression.7.effects[0]"},
			},
		},
		{
			name: "class resource growth preserves declared levels", kind: "class",
			document: `{"resources":{"custom_charge":{"by_level":{"3":2,"7":4},"per":"long_rest"},"always_charge":{"count":1,"per":"short_rest"}}}`,
			want: []extractedReference277{
				{"resource", "custom_charge", 3, "resources.custom_charge.by_level.3"},
				{"resource", "custom_charge", 7, "resources.custom_charge.by_level.7"},
				{"resource", "always_charge", 1, "resources.always_charge"},
			},
		},
		{
			name: "nested action outcomes and independent grant values", kind: "action",
			document: `{"description":"[[A|effect:EFFECT-false]]","mechanics":{"activation":{"cost":[{"resource":"focus","amount":1}]},"effects":[{"resolution":"save","on_fail":[{"kind":"grant_effect","value":"EFFECT-first","values":["EFFECT-second"]}],"on_success":[{"kind":"grant_spell","value":"SPELL-third"}]}],"notes":{"effect_id":"EFFECT-note"}}}`,
			want: []extractedReference277{
				{"resource", "focus", 0, "mechanics.activation.cost[0].resource"},
				{"effect", "EFFECT-first", 0, "mechanics.effects[0].on_fail[0].value"},
				{"effect", "EFFECT-second", 0, "mechanics.effects[0].on_fail[0].values[0]"},
				{"spell", "SPELL-third", 0, "mechanics.effects[0].on_success[0].value"},
			},
		},
		{
			name: "choice domains distinguish entity identity from choice identity", kind: "effect",
			document: `{"mechanics":{"effects":[{"kind":"choice","id":"not-an-effect","options":{"source":"effect","items":[{"id":"EFFECT-option","name":"ignored name"},{"id":"local-option","value":"EFFECT-override"}]}},{"kind":"choice","id":"not-an-action","options":{"source":"explicit","items":[{"id":"wis","grants":[{"kind":"grant_action","values":["ACTION-wis","ACTION-pull"]}]}]}}]}}`,
			want: []extractedReference277{
				{"effect", "EFFECT-option", 0, "mechanics.effects[0].options.items[0].id"},
				{"effect", "EFFECT-override", 0, "mechanics.effects[0].options.items[1].value"},
				{"action", "ACTION-wis", 0, "mechanics.effects[1].options.items[0].grants[0].values[0]"},
				{"action", "ACTION-pull", 0, "mechanics.effects[1].options.items[0].grants[0].values[1]"},
			},
		},
		{
			name: "condition definition identity is not a self reference", kind: "effect",
			document: `{"effect_type":"condition","mechanics":{"condition":{"id":"unconscious"},"includes":["incapacitated"],"leaves":["prone"],"effects":[{"resolution":"auto","result":[{"kind":"condition_immunity","condition":"poisoned"}]}]}}`,
			want: []extractedReference277{
				{"effect", "incapacitated", 0, "mechanics.includes[0]"},
				{"effect", "prone", 0, "mechanics.leaves[0]"},
				{"effect", "poisoned", 0, "mechanics.effects[0].result[0].condition"},
			},
		},
		{
			name: "interrupt die and removal bind library identity only", kind: "action",
			document: `{"mechanics":{"d20_interrupt":{"die":{"class":"synthetic_class"}},"effects":[{"resolution":"auto","result":[{"kind":"remove_effect","card_number":"EFFECT-removable","stack_id":"runtime-stack-only"}]}]}}`,
			want: []extractedReference277{
				{"class", "synthetic_class", 0, "mechanics.d20_interrupt.die.class"},
				{"effect", "EFFECT-removable", 0, "mechanics.effects[0].result[0].card_number"},
			},
		},
		{
			name: "monster immunities and weapon declarations retain entity identities", kind: "monster",
			document: `{"ai":{"condition_immunities":["poisoned","exhaustion"],"held_weapon_card":{"id":"CARD-held","type":"weapon","name":"Display"},"held_weapon_cards":[{"id":"CARD-carried","type":"weapon"}],"action_weapon_ids":{"ACTION-strike":"CARD-carried"}}}`,
			want: []extractedReference277{
				{"effect", "poisoned", 0, "ai.condition_immunities[0]"},
				{"effect", "exhaustion", 0, "ai.condition_immunities[1]"},
				{"card", "CARD-held", 0, "ai.held_weapon_card.id"},
				{"card", "CARD-carried", 0, "ai.held_weapon_cards[0].id"},
				{"action", "ACTION-strike", 0, "ai.action_weapon_ids.ACTION-strike"},
				{"card", "CARD-carried", 0, "ai.action_weapon_ids.ACTION-strike"},
			},
		},
		{
			name: "structured text does not fabricate links", kind: "effect",
			document: `{"description":"[[effect:EFFECT-text]]","support":{"effect_id":"EFFECT-support"},"mechanics":{"effects":[{"kind":"narrative","description":"[[effect:EFFECT-inline]]"},{"kind":"choice","id":"EFFECT-choice-id","prompt":"Choose EFFECT-prompt","options":{"source":"skill","items":[{"id":"EFFECT-skill-id","name":"EFFECT-name"}]}}],"source":"class:CLASS-metadata:4"}}`,
			want:     []extractedReference277{},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := extractReferences277(t, db, test.kind, test.document)
			sort.Slice(test.want, func(i, j int) bool { return fmt.Sprint(test.want[i]) < fmt.Sprint(test.want[j]) })
			if !reflect.DeepEqual(got, test.want) {
				t.Fatalf("references = %#v\nwant %#v", got, test.want)
			}
		})
	}
}

func TestEntityReferences277BackfillsEveryCatalogWithoutChangingHistory(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "ENTITY_REFERENCE_TEST_DATABASE_URL")
	for _, table := range manualContentReviewTables {
		idColumn, idValue := "id", "sample-"+table
		if table == "passive_presentations" {
			idColumn, idValue = "key", "reaction.sample"
		}
		// Keep a single parameterized command per statement for pgx extended mode.
		if _, err := db.Exec(fmt.Sprintf(`CREATE TABLE %s (%s text PRIMARY KEY,name text,description text,mechanics jsonb,deleted_at timestamptz)`, table, idColumn)); err != nil {
			t.Fatal(err)
		}
		query := fmt.Sprintf(`INSERT INTO %s(%s,name,description,mechanics) VALUES($1,'Original','[[text|effect:EFFECT-prose]]','{}')`, table, idColumn)
		if _, err := db.Exec(query, idValue); err != nil {
			t.Fatal(err)
		}
	}
	const historicalSnapshot = `{"effect":{"id":"old-effect","mechanics":{"kind":"grant_effect","value":"EFFECT-old"}},"roll":19}`
	if _, err := db.Exec(`CREATE TABLE reference_test_history(snapshot jsonb)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO reference_test_history VALUES($1::jsonb)`, historicalSnapshot); err != nil {
		t.Fatal(err)
	}
	for attempt := 0; attempt < 2; attempt++ {
		if err := enableEntityReferences277(db); err != nil {
			t.Fatalf("migration attempt %d: %v", attempt+1, err)
		}
	}
	var nodes, edges int
	if err := db.QueryRow(`SELECT count(*) FROM entity_reference_nodes`).Scan(&nodes); err != nil || nodes != len(manualContentReviewTables) {
		t.Fatalf("indexed catalogs: %d want %d: %v", nodes, len(manualContentReviewTables), err)
	}
	if err := db.QueryRow(`SELECT count(*) FROM entity_reference_edges`).Scan(&edges); err != nil || edges != 0 {
		t.Fatalf("prose produced edges: %d: %v", edges, err)
	}
	var historyUnchanged bool
	if err := db.QueryRow(`SELECT snapshot=$1::jsonb FROM reference_test_history`, historicalSnapshot).Scan(&historyUnchanged); err != nil || !historyUnchanged {
		t.Fatalf("historical snapshot changed: %v: %v", historyUnchanged, err)
	}
}

func TestEntityReferences277TracksUpdateDeleteRestoreAndLateAliasTargets(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "ENTITY_REFERENCE_TEST_DATABASE_URL")
	if _, err := db.Exec(`CREATE TABLE effects(id text PRIMARY KEY,name text,card_number text,mechanics jsonb,deleted_at timestamptz);
		CREATE TABLE classes(id text PRIMARY KEY,name text,level_progression jsonb,deleted_at timestamptz);
		INSERT INTO classes VALUES('class-one','First class','{"2":{"effects":["EFFECT-future"]},"6":{"effects":["EFFECT-future"]}}',NULL)`); err != nil {
		t.Fatal(err)
	}
	if err := enableEntityReferences277(db); err != nil {
		t.Fatal(err)
	}
	assertResolved := func(want int) {
		t.Helper()
		var count int
		if err := db.QueryRow(`SELECT count(*) FROM entity_reference_edges edge
			JOIN entity_reference_nodes target ON target.entity_type=edge.target_type AND edge.target_key=ANY(target.aliases)
			WHERE edge.source_type='class' AND edge.source_id='class-one'`).Scan(&count); err != nil || count != want {
			t.Fatalf("resolved incoming references = %d, want %d: %v", count, want, err)
		}
	}
	assertResolved(0)
	if _, err := db.Exec(`INSERT INTO effects VALUES('future-id','Future effect','EFFECT-future','{}',NULL)`); err != nil {
		t.Fatal(err)
	}
	assertResolved(2)
	if _, err := db.Exec(`UPDATE classes SET level_progression='{"4":{"effects":["future-id"]}}' WHERE id='class-one'`); err != nil {
		t.Fatal(err)
	}
	assertResolved(1)
	var level int
	if err := db.QueryRow(`SELECT level FROM entity_reference_edges WHERE source_type='class' AND source_id='class-one'`).Scan(&level); err != nil || level != 4 {
		t.Fatalf("updated progression level = %d, want 4: %v", level, err)
	}
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(`UPDATE classes SET level_progression='{}' WHERE id='class-one'`); err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	assertResolved(1)
	if _, err := db.Exec(`UPDATE effects SET deleted_at=now() WHERE id='future-id'`); err != nil {
		t.Fatal(err)
	}
	assertResolved(0)
	if _, err := db.Exec(`UPDATE effects SET deleted_at=NULL, name='Renamed' WHERE id='future-id'`); err != nil {
		t.Fatal(err)
	}
	assertResolved(1)
	if _, err := db.Exec(`DELETE FROM classes WHERE id='class-one'`); err != nil {
		t.Fatal(err)
	}
	var remaining int
	if err := db.QueryRow(`SELECT count(*) FROM entity_reference_edges`).Scan(&remaining); err != nil || remaining != 0 {
		t.Fatalf("deleted source retained edges: %d: %v", remaining, err)
	}
}

func TestEntityReferences277ResolvesConditionResourceAndFormulaIdentities(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "ENTITY_REFERENCE_TEST_DATABASE_URL")
	if _, err := db.Exec(`CREATE TABLE effects(id text PRIMARY KEY,name text,card_number text,mechanics jsonb);
		CREATE TABLE actions(id text PRIMARY KEY,name text,card_number text,mechanics jsonb);
		CREATE TABLE classes(id text PRIMARY KEY,name text,card_number text);
		CREATE TABLE resources(id text PRIMARY KEY,name text,resource_id text);
		CREATE TABLE variables(id text PRIMARY KEY,name text,variable_id text);
		INSERT INTO effects VALUES('condition-id','Condition display name','COND-synthetic','{"condition":{"id":"synthetic_condition"},"effects":[]}');
		INSERT INTO classes VALUES('class-id','Arbitrary class label','CLASS-Synthetic-Class');
		INSERT INTO resources VALUES('resource-id','Arbitrary charge label','synthetic_charge');
		INSERT INTO variables VALUES('variable-id','Arbitrary variable label','synthetic_bonus');
		INSERT INTO actions VALUES('source-id','Action display name','ACTION-synthetic','{
			"activation":{"cost":[{"resource":"synthetic_charge","amount":1}]},
			"effects":[{"resolution":"save","on_fail":[
				{"kind":"condition","value":"synthetic_condition"},
				{"kind":"damage","amount":"synthetic_bonus + class_level:synthetic_class + dex"}
			]}]
		}')`); err != nil {
		t.Fatal(err)
	}
	if err := enableEntityReferences277(db); err != nil {
		t.Fatal(err)
	}
	readResolved := func() []string {
		t.Helper()
		rows, err := db.Query(`SELECT target_type || ':' || target_id FROM entity_reference_resolved_edges WHERE source_type='action' AND source_id='source-id' ORDER BY 1`)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		result := []string{}
		for rows.Next() {
			var reference string
			if err := rows.Scan(&reference); err != nil {
				t.Fatal(err)
			}
			result = append(result, reference)
		}
		if err := rows.Err(); err != nil {
			t.Fatal(err)
		}
		return result
	}
	want := []string{"class:class-id", "effect:condition-id", "resource:resource-id", "variable:variable-id"}
	if got := readResolved(); !reflect.DeepEqual(got, want) {
		t.Fatalf("resolved mechanic references = %v, want %v", got, want)
	}
	// Display prose and a coincidentally named variable cannot convert a class
	// identity embedded in the formula into a second variable dependency.
	if _, err := db.Exec(`INSERT INTO variables VALUES('collision-variable-id','Unrelated variable','synthetic_class')`); err != nil {
		t.Fatal(err)
	}
	if got := readResolved(); !reflect.DeepEqual(got, want) {
		t.Fatalf("class token produced a variable dependency = %v, want %v", got, want)
	}
	if _, err := db.Exec(`INSERT INTO effects VALUES('prose-id','Narrative example','EFFECT-prose','{"effects":[{"kind":"narrative","value":"synthetic_bonus"},{"kind":"grant_language","value":"synthetic_bonus"},{"kind":"grant_proficiency","prof":"skill","value":"synthetic_bonus"}]}')`); err != nil {
		t.Fatal(err)
	}
	var proseReferences int
	if err := db.QueryRow(`SELECT count(*) FROM entity_reference_resolved_edges WHERE source_type='effect' AND source_id='prose-id'`).Scan(&proseReferences); err != nil || proseReferences != 0 {
		t.Fatalf("non-formula values produced %d references: %v", proseReferences, err)
	}
}

func TestEntityReferences277SeparatesRuntimePrimitivesFromLibraryIdentities(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "ENTITY_REFERENCE_TEST_DATABASE_URL")
	if _, err := db.Exec(`CREATE TABLE effects(id text PRIMARY KEY,name text,card_number text,mechanics jsonb);
		CREATE TABLE actions(id text PRIMARY KEY,name text,card_number text,mechanics jsonb);
		CREATE TABLE cards(id text PRIMARY KEY,name text,card_number text);
		CREATE TABLE resources(id text PRIMARY KEY,name text,resource_id text);
		INSERT INTO cards VALUES('potion-id','Potion','CARD-potion');
		INSERT INTO resources VALUES('slot-id','Third spell slot','spell_slot_3');
		INSERT INTO effects VALUES('condition-id','Custom condition','COND-custom','{"condition":{"id":"custom_condition"}}');
		INSERT INTO actions VALUES('source-id','Runtime costs','ACTION-costs','{
			"requirements":[{"type":"equipment","value":"free_hand"},{"type":"equipment","value":"weapon_in_main_hand"},{"type":"state","value":"short_rest_completed"},{"type":"equipment","value":"CARD-potion"},{"type":"state","value":"custom_condition"}],
			"activation":{"cost":[{"resource":"self_item"},{"resource":"self_uses"},{"resource":"equipped_weapon_ammo"},{"resource":"spell_slot"},{"resource":"hit_die"},{"resource":"item","card_id":"CARD-potion"},{"resource":"spell_slot","level":3}]}
		}')`); err != nil {
		t.Fatal(err)
	}
	if err := enableEntityReferences277(db); err != nil {
		t.Fatal(err)
	}
	rows, err := db.Query(`SELECT DISTINCT target_type || ':' || target_id FROM entity_reference_resolved_edges WHERE source_type='action' ORDER BY 1`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	got := []string{}
	for rows.Next() {
		var value string
		if err := rows.Scan(&value); err != nil {
			t.Fatal(err)
		}
		got = append(got, value)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	want := []string{"card:potion-id", "effect:condition-id", "resource:slot-id"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("runtime placeholders became entity references: got %v, want %v", got, want)
	}
}

func TestEntityReferences277UsesDeclaredClassAndSpellAliasesWithoutAmbiguity(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "ENTITY_REFERENCE_TEST_DATABASE_URL")
	if _, err := db.Exec(`CREATE TABLE spells(id text PRIMARY KEY,name text,name_en text,card_number text,classes jsonb,mechanics jsonb);
		CREATE TABLE classes(id text PRIMARY KEY,name text,name_en text,card_number text);
		CREATE TABLE effects(id text PRIMARY KEY,name text,card_number text,mechanics jsonb);
		INSERT INTO classes VALUES('class-id','Новый класс','New Class','CLASS-new-class');
		INSERT INTO spells VALUES('spell-id','Название заклинания','Test''s Bright Spell','SPELL-unique','["новый класс"]','{}');
		INSERT INTO effects VALUES('grant-id','Grant','EFFECT-grant','{"effects":[{"kind":"grant_spell","value":"tests_bright_spell"}]}')`); err != nil {
		t.Fatal(err)
	}
	if err := enableEntityReferences277(db); err != nil {
		t.Fatal(err)
	}
	var classID, spellID string
	if err := db.QueryRow(`SELECT target_id FROM entity_reference_resolved_edges WHERE source_type='spell' AND source_id='spell-id' AND target_type='class'`).Scan(&classID); err != nil || classID != "class-id" {
		t.Fatalf("typed localized class list = %q: %v", classID, err)
	}
	if err := db.QueryRow(`SELECT target_id FROM entity_reference_resolved_edges WHERE source_type='effect' AND source_id='grant-id' AND target_type='spell'`).Scan(&spellID); err != nil || spellID != "spell-id" {
		t.Fatalf("declared English spell slug = %q: %v", spellID, err)
	}
	if _, err := db.Exec(`INSERT INTO spells VALUES('second-id','Another display name','Tests Bright Spell','SPELL-second',NULL,'{}')`); err != nil {
		t.Fatal(err)
	}
	var resolved int
	if err := db.QueryRow(`SELECT count(*) FROM entity_reference_resolved_edges WHERE source_type='effect' AND source_id='grant-id' AND NOT missing`).Scan(&resolved); err != nil || resolved != 0 {
		t.Fatalf("ambiguous name alias resolved %d entities: %v", resolved, err)
	}
	// The frozen combat resolver gives immutable IDs priority over display
	// aliases, even when several names normalize to the same token.
	if _, err := db.Exec(`INSERT INTO spells VALUES('stable-id','Stable reference wins','Unrelated Name','tests_bright_spell',NULL,'{}')`); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT target_id FROM entity_reference_resolved_edges WHERE source_type='effect' AND source_id='grant-id' AND target_type='spell'`).Scan(&spellID); err != nil || spellID != "stable-id" {
		t.Fatalf("stable spell identity did not win alias collision = %q: %v", spellID, err)
	}
}
