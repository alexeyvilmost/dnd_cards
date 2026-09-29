package migrations

import (
	"reflect"
	"testing"
)

func TestReferenceLevels279RetainOnlyExplicitLevels(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "ENTITY_REFERENCE_TEST_DATABASE_URL")
	if _, err := db.Exec(entityReferences277SQL); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`CREATE TABLE classes(id text PRIMARY KEY,name text,related_effects jsonb,level_progression jsonb,mechanics jsonb);
	CREATE TABLE races(LIKE classes INCLUDING ALL);
	INSERT INTO classes VALUES('class-a','Class A','["effect-a"]','{"5":{"effects":["effect-a"]}}','{"effects":[{"min_level":3,"effect_id":"effect-b"}]}');
	INSERT INTO races VALUES('race-b','Species B','["effect-b"]','{"3":{"effects":["effect-c"]}}','{}');
	SELECT entity_reference_sync('class',to_jsonb(c)) FROM classes c;
	SELECT entity_reference_sync('race',to_jsonb(r)) FROM races r;`); err != nil {
		t.Fatal(err)
	}
	var before, after string
	const snapshot = `SELECT jsonb_build_object('classes',(SELECT jsonb_agg(c) FROM classes c),'races',(SELECT jsonb_agg(r) FROM races r))::text`
	if err := db.QueryRow(snapshot).Scan(&before); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err := correctEntityReferenceLevels279(db); err != nil {
			t.Fatal(err)
		}
	}
	rows, err := db.Query(`SELECT source_type,target_key,level FROM entity_reference_edges ORDER BY source_type,target_key,level`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	type edge struct {
		source, target string
		level          int
	}
	var got []edge
	for rows.Next() {
		var e edge
		if err := rows.Scan(&e.source, &e.target, &e.level); err != nil {
			t.Fatal(err)
		}
		got = append(got, e)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	want := []edge{{"class", "effect-a", 0}, {"class", "effect-a", 5}, {"class", "effect-b", 3}, {"race", "effect-b", 0}, {"race", "effect-c", 3}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("reference levels: got %#v, want %#v", got, want)
	}
	if err := db.QueryRow(snapshot).Scan(&after); err != nil {
		t.Fatal(err)
	}
	if before != after {
		t.Fatal("reindex changed source entities")
	}
	// The current extractor also handles new/edited entities, not just backfill.
	refs := extractReferences277(t, db, "race", `{"related_actions":["action-a"],"level_progression":{"1":{"effects":["effect-first"]}}}`)
	wantRefs := []extractedReference277{{"action", "action-a", 0, "related_actions[0]"}, {"effect", "effect-first", 1, "level_progression.1.effects[0]"}}
	if !reflect.DeepEqual(refs, wantRefs) {
		t.Fatalf("new references: %#v", refs)
	}
}
