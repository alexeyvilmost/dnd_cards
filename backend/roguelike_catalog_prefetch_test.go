package main

import (
	"errors"
	"reflect"
	"testing"

	"github.com/google/uuid"
)

func TestCatalogPrefetchAdvisoryClosurePreservesExactNeeds(t *testing.T) {
	f := openCharacterV3AccessFixture(t)
	if err := f.db.AutoMigrate(&Action{}, &Spell{}); err != nil {
		t.Fatal(err)
	}
	if err := f.db.Exec(`CREATE TABLE entity_reference_resolved_edges(source_type text,source_id text,target_type text,target_id text,missing boolean)`).Error; err != nil {
		t.Fatal(err)
	}
	t.Setenv("RULES_CATALOG_BATCH_ENABLED", "1")
	t.Setenv("RULES_CATALOG_PREFETCH_ENABLED", "1")
	name := "Duplicate Alias"
	actions := []Action{{ID: uuid.New(), Name: "Source", CardNumber: "PREFETCH-SOURCE"}, {ID: uuid.New(), Name: "Next", CardNumber: "PREFETCH-NEXT"}, {ID: uuid.New(), Name: "Unused", CardNumber: "PREFETCH-UNUSED"}}
	spells := []Spell{{ID: uuid.New(), Name: "A", NameEn: &name, CardNumber: "PREFETCH-A"}, {ID: uuid.New(), Name: "B", NameEn: &name, CardNumber: "PREFETCH-B"}}
	for i := range actions {
		if err := f.db.Create(&actions[i]).Error; err != nil {
			t.Fatal(err)
		}
	}
	for i := range spells {
		if err := f.db.Create(&spells[i]).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, target := range []struct{ kind, id string }{{"action", actions[1].ID.String()}, {"spell", spells[0].ID.String()}, {"spell", uuid.NewString()}, {"unknown", uuid.NewString()}} {
		if err := f.db.Exec(`INSERT INTO entity_reference_resolved_edges VALUES ('action',?,?,?,false)`, actions[0].ID.String(), target.kind, target.id).Error; err != nil {
			t.Fatal(err)
		}
	}
	// A transitive edge and a cycle must terminate without inserting either
	// advisory row into the canonical catalog until it is explicitly requested.
	for _, edge := range [][2]uuid.UUID{{actions[1].ID, actions[2].ID}, {actions[2].ID, actions[1].ID}} {
		if err := f.db.Exec(`INSERT INTO entity_reference_resolved_edges VALUES ('action',?,'action',?,false)`, edge[0].String(), edge[1].String()).Error; err != nil {
			t.Fatal(err)
		}
	}
	catalog, baseline := emptyRoguelikeFrozenCatalog(), emptyRoguelikeFrozenCatalog()
	prefetch := newCatalogPrefetch(f.owner.ID)
	for _, id := range []uuid.UUID{actions[0].ID, actions[1].ID} {
		needs := []roguelikeWorkerNeed{{Kind: "entity", EntityType: "action", Reference: id.String()}}
		if err := prefetch.fulfill(f.db, &catalog, needs); err != nil {
			t.Fatal(err)
		}
		if err := baseline.fulfillWave(f.db, needs); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(catalog, baseline) {
			t.Fatal("advisory rows escaped canonical needs")
		}
	}
	if len(prefetch.rows) != 3 {
		t.Fatalf("expected bounded existing known targets only, got %d", len(prefetch.rows))
	}
	// An alias is still resolved against complete live membership. The cached
	// UUID cannot make one of two same-name spells look unambiguous.
	err := prefetch.fulfill(f.db, &catalog, []roguelikeWorkerNeed{{Kind: "entity", EntityType: "spell", Reference: "duplicate_alias"}})
	var rejection *roguelikeWorkerRejection
	if !errors.As(err, &rejection) || rejection.Code != "combat_catalog_ambiguous_ref" {
		t.Fatalf("alias membership bypassed: %v", err)
	}
	if err := f.db.Model(&actions[1]).Update("name", "Fresh declaration").Error; err != nil {
		t.Fatal(err)
	}
	fresh := newCatalogPrefetch(f.owner.ID)
	freshCatalog := emptyRoguelikeFrozenCatalog()
	if err := fresh.fulfill(f.db, &freshCatalog, []roguelikeWorkerNeed{{Kind: "entity", EntityType: "action", Reference: actions[0].ID.String()}}); err != nil {
		t.Fatal(err)
	}
	if fresh.rows["action/"+actions[1].ID.String()]["name"] != "Fresh declaration" {
		t.Fatal("prefetch reused cross-request content")
	}
	if prefetch.rows["action/"+actions[1].ID.String()]["name"] != "Next" {
		t.Fatal("request-local snapshot was mutated")
	}
}

func TestCatalogPrefetchNeverWidensCardRights(t *testing.T) {
	f := openCharacterV3AccessFixture(t)
	if err := f.db.AutoMigrate(&Action{}, &Card{}, &EntityTag{}, &EntityTagAssignment{}); err != nil {
		t.Fatal(err)
	}
	installOwnedItemAccess(t, f.db)
	if err := f.db.Exec(`CREATE TABLE entity_reference_resolved_edges(source_type text,source_id text,target_type text,target_id text,missing boolean)`).Error; err != nil {
		t.Fatal(err)
	}
	t.Setenv("RULES_CATALOG_PREFETCH_ENABLED", "1")
	action := Action{ID: uuid.New(), Name: "Source", CardNumber: "PREFETCH-CARDS"}
	if err := f.db.Create(&action).Error; err != nil {
		t.Fatal(err)
	}
	hidden := ownedTestCard(t, f.db, false)
	if err := f.db.Exec(`INSERT INTO entity_reference_resolved_edges VALUES ('action',?,'card',?,false)`, action.ID.String(), hidden.ID.String()).Error; err != nil {
		t.Fatal(err)
	}
	catalog := emptyRoguelikeFrozenCatalog()
	if err := catalog.add("action", action); err != nil {
		t.Fatal(err)
	}
	prefetch := newCatalogPrefetch(f.owner.ID)
	if err := prefetch.load(f.db, &catalog); err != nil {
		t.Fatal(err)
	}
	if len(prefetch.rows) != 0 {
		t.Fatal("unowned hidden item prefetched")
	}
	if err := f.db.Exec(`INSERT INTO owned_item_grants(user_id,character_id,card_id,reason) VALUES (?,?,?,'admin')`, f.owner.ID, f.ownerCharacter.ID, hidden.ID).Error; err != nil {
		t.Fatal(err)
	}
	prefetch = newCatalogPrefetch(f.owner.ID)
	if err := prefetch.load(f.db, &catalog); err != nil {
		t.Fatal(err)
	}
	if len(prefetch.rows) != 1 {
		t.Fatal("owned item not prefetched")
	}
	if err := f.db.Exec(`DELETE FROM owned_item_grants WHERE card_id=?`, hidden.ID).Error; err != nil {
		t.Fatal(err)
	}
	prefetch = newCatalogPrefetch(f.owner.ID)
	if err := prefetch.load(f.db, &catalog); err != nil {
		t.Fatal(err)
	}
	if len(prefetch.rows) != 0 {
		t.Fatal("revoked item reused in new request")
	}
}
