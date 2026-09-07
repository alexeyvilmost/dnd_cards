package main

import (
	"testing"

	"github.com/google/uuid"
)

func TestRoguelikeLevelAndVictoryThresholds(t *testing.T) {
	tests := []struct{ xp, level, next int }{
		{0, 1, 300}, {299, 1, 300}, {300, 2, 900}, {900, 3, 2700},
		{2700, 4, 6500}, {6500, 5, 14000}, {14000, 5, 14000},
	}
	for _, test := range tests {
		if got := roguelikeLevelForXP(test.xp); got != test.level {
			t.Fatalf("xp %d: level=%d, want %d", test.xp, got, test.level)
		}
		if got := roguelikeNextLevelXP(test.level); got != test.next {
			t.Fatalf("level %d: next=%d, want %d", test.level, got, test.next)
		}
	}
}

func TestRoguelikeEncounterBudgetProgressesWithinStage(t *testing.T) {
	for _, test := range []struct {
		xp         int
		want       string
		wantBudget int
	}{
		{900, "low", 150}, {1499, "low", 150},
		{1500, "moderate", 225}, {2249, "moderate", 225},
		{2250, "high", 400}, {2699, "high", 400},
	} {
		got, budget := roguelikeEncounterBudget(3, test.xp)
		if got != test.want || budget != test.wantBudget {
			t.Fatalf("xp %d: got %s/%d, want %s/%d", test.xp, got, budget, test.want, test.wantBudget)
		}
	}
}

func TestRoguelikeRandomStreamsAreStableAndIndependent(t *testing.T) {
	first := roguelikeDeterministicInt("seed", "encounter", 4, 1000)
	if first != roguelikeDeterministicInt("seed", "encounter", 4, 1000) {
		t.Fatal("same stream/cursor is not deterministic")
	}
	if first == roguelikeDeterministicInt("seed", "shop", 4, 1000) {
		t.Fatal("test fixture unexpectedly aliases independent streams")
	}
}

func TestRoguelikeContentManifestsAreUniqueAndComplete(t *testing.T) {
	if len(roguelikeMonsterPool) != 18 {
		t.Fatalf("monster pool has %d entries, want 18", len(roguelikeMonsterPool))
	}
	monsters := map[string]bool{}
	certified := 0
	for _, entry := range roguelikeMonsterPool {
		if entry.Slug == "" || entry.XP <= 0 || entry.MinLevel < 1 || entry.MinLevel > 5 || entry.MaxCount < 1 || entry.GeneratorWeight < 0 {
			t.Fatalf("invalid monster manifest entry: %#v", entry)
		}
		if monsters[entry.Slug] {
			t.Fatalf("duplicate monster slug %q", entry.Slug)
		}
		monsters[entry.Slug] = true
		if entry.GeneratorWeight > 0 {
			certified++
		}
	}
	if certified != 9 {
		t.Fatalf("certified generator pool has %d entries, want 9", certified)
	}
	items := map[string]bool{}
	for _, entry := range roguelikeShopManifest {
		if entry.CardNumber == "" || entry.Price < 1 || entry.MinLevel < 1 || entry.MinLevel > 5 || entry.Weight < 1 ||
			(entry.Kind != "equipment" && entry.Kind != "consumable" && entry.Kind != "magic") {
			t.Fatalf("invalid shop manifest entry: %#v", entry)
		}
		if items[entry.CardNumber] {
			t.Fatalf("duplicate shop card %q", entry.CardNumber)
		}
		items[entry.CardNumber] = true
	}
}

func TestRoguelikeEncounterCandidatesExcludeUncertifiedMonsters(t *testing.T) {
	available := map[string]Monster{}
	for _, entry := range roguelikeMonsterPool {
		available[entry.Slug] = Monster{Slug: entry.Slug}
	}
	for _, candidate := range roguelikeEncounterCandidates(5, 700, 20, available) {
		if candidate.Entry.GeneratorWeight <= 0 {
			t.Fatalf("uncertified monster %q entered a generated encounter", candidate.Entry.Slug)
		}
	}
}

func TestRoguelikeEncounterBodyLimits(t *testing.T) {
	available := map[string]Monster{}
	for _, entry := range roguelikeMonsterPool {
		available[entry.Slug] = Monster{Slug: entry.Slug}
	}
	for _, test := range []struct {
		level, budget, won, limit int
	}{
		{1, 100, 0, 1}, {1, 100, 1, 1}, {1, 100, 2, 2},
		{2, 200, 8, 2}, {3, 400, 15, 3}, {5, 1100, 30, 3},
	} {
		candidates := roguelikeEncounterCandidates(test.level, test.budget, test.won, available)
		if len(candidates) == 0 {
			t.Fatalf("level %d budget %d has no reserve candidate", test.level, test.budget)
		}
		for _, candidate := range candidates {
			if candidate.Quantity > test.limit {
				t.Fatalf("level %d generated %d bodies, limit %d", test.level, candidate.Quantity, test.limit)
			}
		}
	}
}

func TestRoguelikeLootCategoriesByStage(t *testing.T) {
	for _, test := range []struct {
		level, roll int
		want        string
	}{
		{1, 0, "consumable"}, {2, 79, "consumable"}, {2, 80, "equipment"},
		{3, 69, "consumable"}, {4, 70, "equipment"}, {4, 90, "magic"},
		{5, 59, "consumable"}, {5, 60, "equipment"}, {5, 75, "magic"},
	} {
		if got := roguelikeLootKind(test.level, test.roll); got != test.want {
			t.Fatalf("level %d roll %d: got %s, want %s", test.level, test.roll, got, test.want)
		}
	}
}

func TestConsumeRoguelikeInventoryItem(t *testing.T) {
	cardID := uuid.New().String()
	rows := InventoryItemRows{{CardID: cardID, Qty: 2}, {CardID: uuid.New().String(), Qty: 1}}
	character := CharacterV3{InventoryItems: &rows}
	if !consumeRoguelikeInventoryItem(&character, cardID) || (*character.InventoryItems)[0].Qty != 1 {
		t.Fatalf("first consumption failed: %#v", character.InventoryItems)
	}
	if !consumeRoguelikeInventoryItem(&character, cardID) || len(*character.InventoryItems) != 1 {
		t.Fatalf("last copy was not removed: %#v", character.InventoryItems)
	}
	if consumeRoguelikeInventoryItem(&character, cardID) {
		t.Fatal("consumed an unavailable item")
	}
}

func TestRoguelikeCommandHashCoversPayloadAndRevision(t *testing.T) {
	commandID := uuid.New()
	base := RoguelikeCommandRequest{CommandID: commandID, ExpectedRevision: 2, Type: "buy", Payload: JSONMap{"offer_id": "one"}}
	differentPayload := base
	differentPayload.Payload = JSONMap{"offer_id": "two"}
	differentRevision := base
	differentRevision.ExpectedRevision = 3
	baseHash, err := roguelikeCommandRequestHash(base)
	if err != nil {
		t.Fatal(err)
	}
	payloadHash, _ := roguelikeCommandRequestHash(differentPayload)
	revisionHash, _ := roguelikeCommandRequestHash(differentRevision)
	if baseHash == payloadHash {
		t.Fatal("command payload is absent from receipt identity")
	}
	if baseHash == revisionHash {
		t.Fatal("expected revision is absent from receipt identity")
	}
}

func TestResetRoguelikeCloneRuntimeStartsRestedAndOutOfCombat(t *testing.T) {
	maximums := JSONMap{"action": float64(1), "second_wind": float64(1)}
	resources := JSONMap{"action": float64(0), "second_wind": float64(0)}
	effects := ActiveEffectRows{{ID: "poisoned", Name: "Отравленный"}}
	turnState := JSONMap{
		SOLO_COMBAT_KEY: map[string]any{"outcome": "defeat"},
		"temp_hp":       float64(5),
	}
	encounterID := uuid.New()
	character := CharacterV3{
		MaxHP: 13, CurrentHP: 4, Resources: &resources, MaxResources: &maximums,
		ActiveEffects: &effects, TurnState: &turnState, CurrentEncounterID: &encounterID,
		RuntimeRevision: 9,
	}

	if err := resetRoguelikeCloneRuntime(&character); err != nil {
		t.Fatal(err)
	}
	if character.CurrentHP != character.MaxHP {
		t.Fatalf("current HP=%d, want full %d", character.CurrentHP, character.MaxHP)
	}
	if character.Resources == nil || !roguelikeJSONEqual(character.Resources, character.MaxResources) {
		t.Fatalf("resources=%#v, want maximums %#v", character.Resources, character.MaxResources)
	}
	if character.Resources == character.MaxResources {
		t.Fatal("current and maximum resources share the same map pointer")
	}
	if character.ActiveEffects == nil || len(*character.ActiveEffects) != 0 {
		t.Fatalf("active effects were retained: %#v", character.ActiveEffects)
	}
	if character.TurnState == nil || len(*character.TurnState) != 0 {
		t.Fatalf("turn state was retained: %#v", character.TurnState)
	}
	if character.CurrentEncounterID != nil || character.RuntimeRevision != 0 {
		t.Fatalf("encounter runtime was retained: encounter=%v revision=%d", character.CurrentEncounterID, character.RuntimeRevision)
	}
}
