package main

import (
	"errors"
	"fmt"
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
	if certified != 18 {
		t.Fatalf("certified generator pool has %d entries, want 18", certified)
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

func TestResourceMapWithinMaximumAllowsOnlyEmptyDerivedPools(t *testing.T) {
	maximums := JSONMap{"action": float64(1), "second_wind": float64(2)}
	valid := JSONMap{
		"action": float64(1), "second_wind": float64(2),
		"action_surge_action": float64(0), "quickened_spell_action": float64(0),
	}
	if !resourceMapWithinMaximum(&valid, &maximums) {
		t.Fatal("empty derived action pools were rejected")
	}
	invalidExtra := cloneJSONMapValue(&valid)
	invalidExtra["invented_resource"] = float64(1)
	if resourceMapWithinMaximum(&invalidExtra, &maximums) {
		t.Fatal("positive resource without a maximum was accepted")
	}
	missingMaximum := JSONMap{"action": float64(1)}
	if resourceMapWithinMaximum(&missingMaximum, &maximums) {
		t.Fatal("runtime missing a bounded resource was accepted")
	}
	overMaximum := cloneJSONMapValue(&valid)
	overMaximum["second_wind"] = float64(3)
	if resourceMapWithinMaximum(&overMaximum, &maximums) {
		t.Fatal("resource above its maximum was accepted")
	}
}

func TestRoguelikeRetryRetainsDrawnEncounterAcrossCatalogChanges(t *testing.T) {
	character := &CharacterV3{ID: uuid.New(), UserID: uuid.New(), Level: 2, RuntimeRevision: 7}
	run := &RoguelikeRun{CharacterID: character.ID, UserID: character.UserID, Character: character,
		Status: RoguelikeStatusActive, Phase: RoguelikePhaseCamp, Experience: 300,
		EncountersWon: 6, Gold: 80, Supplies: 2, Attempt: 1,
		Shop: JSONMap{"generation": 6}, Encounter: JSONMap{}}
	var err error
	run.Checkpoint, err = roguelikeCheckpoint(run, character)
	if err != nil {
		t.Fatal(err)
	}
	encounter := JSONMap{"number": 7, "monster_slug": "wolf", "quantity": 2,
		"catalog": map[string]any{"version": 1, "sentinel": "frozen-before-library-edit"}}
	run.Encounter = encounter
	run.Status = RoguelikeStatusDefeat
	run.CombatCatalog = JSONMap{"artifactHash": "old", "entities": JSONMap{"card": []any{"previous-loadout"}}}
	run.Gold = 1
	run.Character.RuntimeRevision = 12
	if err := restoreRoguelikeCheckpoint(run); err != nil {
		t.Fatal(err)
	}
	if run.Gold != 80 || run.Attempt != 2 || run.Character.RuntimeRevision != 13 {
		t.Fatal("checkpoint did not restore economy with a new runtime revision")
	}
	if len(run.CombatCatalog) != 0 {
		t.Fatal("retry retained stale player loadout catalog")
	}
	// A nil database proves reuse does not consult the current library or generator.
	if err := startRoguelikeEncounter(nil, run); err != nil {
		t.Fatal(err)
	}
	if run.Phase != RoguelikePhaseCombat || run.Encounter["monster_slug"] != "wolf" {
		t.Fatal("retry rerolled the encounter")
	}
	catalog := run.Encounter["catalog"].(map[string]any)
	if catalog["sentinel"] != "frozen-before-library-edit" {
		t.Fatal("retry replaced the content")
	}
}

func TestRoguelikeClockRetainsSubhourCastingTime(t *testing.T) {
	run := RoguelikeRun{GameClockHours: 1, GameClockRemainderSeconds: 3594}
	advanceRoguelikeClock(&run, 6)
	if run.GameClockHours != 2 || run.GameClockRemainderSeconds != 0 {
		t.Fatal("lost turn duration")
	}
	advanceRoguelikeClock(&run, 4200)
	if run.GameClockHours != 3 || run.GameClockRemainderSeconds != 600 {
		t.Fatal("lost ritual duration")
	}
}

func TestRoguelikeAdditionalWeightUsesRuleCapacityAndPhysicalOwnership(t *testing.T) {
	fixture := openCharacterV3AccessFixture(t)
	if err := fixture.db.AutoMigrate(&Card{}); err != nil {
		t.Fatal(err)
	}
	weight := 6.0
	owned := Card{ID: uuid.New(), Name: "Owned", Description: "test", CardNumber: "RL-WEIGHT-OWNED", Rarity: RarityCommon, Weight: &weight}
	incoming := Card{ID: uuid.New(), Name: "Incoming", Description: "test", CardNumber: "RL-WEIGHT-INCOMING", Rarity: RarityCommon, Weight: &weight}
	if err := fixture.db.Create(&owned).Error; err != nil {
		t.Fatal(err)
	}
	if err := fixture.db.Create(&incoming).Error; err != nil {
		t.Fatal(err)
	}
	equipment := JSONMap{"main_hand": owned.ID.String(), "off_hand": owned.ID.String()}
	rules := JSONMap{"carryingCapacity": float64(15)}
	character := CharacterV3{ID: uuid.New(), Equipment: &equipment, RuleState: &rules}
	if got, err := roguelikeInventoryWeight(fixture.db, &character); err != nil || got != 6 {
		t.Fatalf("two-handed physical item weight = %v, error=%v", got, err)
	}
	if err := validateRoguelikeAdditionalWeight(fixture.db, &character, &incoming, 1); err != nil {
		t.Fatalf("item within capacity rejected: %v", err)
	}
	err := validateRoguelikeAdditionalWeight(fixture.db, &character, &incoming, 2)
	var conflict *roguelikeHTTPError
	if !errors.As(err, &conflict) || conflict.Code != "carrying_capacity_exceeded" {
		t.Fatalf("overweight addition was not rejected: %#v", err)
	}
	overweightInventory := InventoryItemRows{{CardID: owned.ID.String(), Qty: 3}}
	character.Equipment = nil
	character.InventoryItems = &overweightInventory
	err = validateRoguelikeCurrentWeight(fixture.db, &character)
	if !errors.As(err, &conflict) || conflict.Code != "carrying_capacity_exceeded" {
		t.Fatalf("overweight starting inventory was not rejected: %#v", err)
	}
}

func TestRoguelikeLootSkipsOverweightCandidateForFittingAlternative(t *testing.T) {
	fixture := openCharacterV3AccessFixture(t)
	if err := fixture.db.AutoMigrate(&Card{}); err != nil {
		t.Fatal(err)
	}
	heavyWeight, lightWeight := 6.0, 1.0
	heavy := Card{ID: uuid.New(), Name: "Heavy", Description: "test", CardNumber: "CARD-0319", Rarity: RarityCommon, Weight: &heavyWeight}
	light := Card{ID: uuid.New(), Name: "Light", Description: "test", CardNumber: "CARD-0313", Rarity: RarityCommon, Weight: &lightWeight}
	if err := fixture.db.Create(&heavy).Error; err != nil {
		t.Fatal(err)
	}
	if err := fixture.db.Create(&light).Error; err != nil {
		t.Fatal(err)
	}
	seed := ""
	for candidate := 0; candidate < 1000; candidate++ {
		value := fmt.Sprintf("capacity-loot-%d", candidate)
		ordered := roguelikeWeightedOrder(value, "loot", 1, roguelikeShopManifest)
		heavyIndex, lightIndex := -1, -1
		for index, entry := range ordered {
			if entry.CardNumber == heavy.CardNumber {
				heavyIndex = index
			}
			if entry.CardNumber == light.CardNumber {
				lightIndex = index
			}
		}
		if heavyIndex >= 0 && lightIndex >= 0 && heavyIndex < lightIndex {
			seed = value
			break
		}
	}
	if seed == "" {
		t.Fatal("could not construct deterministic heavy-first loot order")
	}
	rules := JSONMap{"carryingCapacity": float64(5)}
	character := CharacterV3{ID: uuid.New(), RuleState: &rules}
	run := RoguelikeRun{RunSeed: seed}
	card, err := grantRoguelikeLootByKind(fixture.db, &run, &character, 1, "equipment", "loot", 1, map[string]bool{})
	if err != nil {
		t.Fatal(err)
	}
	if card == nil || card.ID != light.ID {
		t.Fatalf("fitting fallback loot = %#v, want %s", card, light.ID)
	}
	if character.InventoryItems == nil || len(*character.InventoryItems) != 1 || (*character.InventoryItems)[0].CardID != light.ID.String() {
		t.Fatalf("unexpected awarded inventory: %#v", character.InventoryItems)
	}
}

// A manifest weight is a relative selection probability, including rare stock.
func TestRoguelikeWeightedStockKeepsRareItemsReachable(t *testing.T) {
	entries := []roguelikeShopManifestEntry{{CardNumber: "common", Weight: 8}, {CardNumber: "rare", Weight: 2}}
	rareFirst := 0
	for cursor := 0; cursor < 10000; cursor++ {
		order := roguelikeWeightedOrder("stock-distribution", "shop", cursor, entries)
		if len(order) != 2 || order[0].CardNumber == order[1].CardNumber {
			t.Fatal("stock must sample without replacement")
		}
		if order[0].CardNumber == "rare" {
			rareFirst++
		}
	}
	if rareFirst < 1750 || rareFirst > 2250 {
		t.Fatalf("weight 2 of total 10 should yield about 20 percent, got %d/10000", rareFirst)
	}
	if entries[0].CardNumber != "common" {
		t.Fatal("selection mutated manifest")
	}
}
