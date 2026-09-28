package main

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const urvinMode = "urvin"

type UrvinAura struct {
	ID          string  `json:"id"`
	Key         string  `json:"key"`
	Name        string  `json:"name"`
	Description string  `json:"description"`
	ImageURL    string  `json:"image_url"`
	CardNumber  string  `json:"card_number"`
	Type        string  `json:"type"`
	Rarity      string  `json:"rarity"`
	Mechanics   JSONMap `json:"mechanics"`
}
type UrvinReward struct {
	Experience    int    `json:"experience"`
	Gold          [2]int `json:"gold"`
	LootMinRarity string `json:"loot_min_rarity,omitempty"`
}
type UrvinRoom struct {
	ID             string      `json:"id"`
	Name           string      `json:"name"`
	Icon           string      `json:"icon"`
	Description    string      `json:"description"`
	Weight         int         `json:"weight"`
	XPMultiplier   int         `json:"xp_multiplier"`
	GoldMultiplier int         `json:"gold_multiplier"`
	LootMinRarity  string      `json:"loot_min_rarity,omitempty"`
	Reward         UrvinReward `json:"reward"`
}
type UrvinCheck struct {
	Skill   string `json:"skill"`
	Ability string `json:"ability"`
	DC      int    `json:"dc"`
}
type UrvinOutcome struct {
	Reward      UrvinReward `json:"reward"`
	Combat      string      `json:"combat,omitempty"`
	EncounterID string      `json:"encounter_id,omitempty"`
	Surprise    bool        `json:"surprise,omitempty"`
	Healing     string      `json:"healing,omitempty"`
	Damage      string      `json:"damage,omitempty"`
}
type UrvinOption struct {
	ID          string       `json:"id"`
	Name        string       `json:"name"`
	Description string       `json:"description"`
	CostGold    int          `json:"cost_gold,omitempty"`
	Checks      []UrvinCheck `json:"checks,omitempty"`
	Success     UrvinOutcome `json:"success"`
	Failure     UrvinOutcome `json:"failure"`
}
type UrvinEvent struct {
	ID          string        `json:"id"`
	Name        string        `json:"name"`
	Description string        `json:"description"`
	Options     []UrvinOption `json:"options"`
}
type UrvinEncounter struct {
	ID       string   `json:"id,omitempty"`
	Kind     string   `json:"kind"`
	MinLevel int      `json:"min_level"`
	MaxLevel int      `json:"max_level"`
	MapIDs   []string `json:"map_ids"`
	Monsters []struct {
		Slug             string  `json:"slug"`
		Quantity         int     `json:"quantity"`
		PerMember        bool    `json:"per_member"`
		PerExtraMember   bool    `json:"per_extra_member"`
		HPPerExtraMember float64 `json:"hp_per_extra_member"`
	} `json:"monsters"`
}
type UrvinDefinition struct {
	Version           int    `json:"version"`
	ID                string `json:"id"`
	Name              string `json:"name"`
	Description       string `json:"description"`
	Rows              int    `json:"rows"`
	Lanes             int    `json:"lanes"`
	EventCombatChance int    `json:"event_combat_chance"`
	EventEliteChance  int    `json:"event_elite_chance"`
	Shop              struct {
		OfferMultiplier   int `json:"offer_multiplier"`
		ExtraMagicSlots   int `json:"extra_magic_slots"`
		MinimumMagicItems int `json:"minimum_magic_items"`
	} `json:"shop"`
	Rooms      []UrvinRoom      `json:"rooms"`
	Auras      []UrvinAura      `json:"auras"`
	Events     []UrvinEvent     `json:"events"`
	Encounters []UrvinEncounter `json:"encounters"`
}
type UrvinNode struct {
	ID           string   `json:"id"`
	Row          int      `json:"row"`
	Lane         int      `json:"lane"`
	Kind         string   `json:"kind"`
	Next         []string `json:"next"`
	Completed    bool     `json:"completed"`
	ResolvedKind string   `json:"resolved_kind,omitempty"`
	Result       JSONMap  `json:"result,omitempty"`
}
type UrvinEventProgress struct {
	Definition UrvinEvent `json:"definition"`
	ChoiceID   string     `json:"choice_id,omitempty"`
	ActorID    string     `json:"actor_id,omitempty"`
	CheckIndex int        `json:"check_index"`
	Rolls      []JSONMap  `json:"rolls"`
	Pending    JSONMap    `json:"pending,omitempty"`
	Finished   bool       `json:"finished"`
}
type UrvinJourney struct {
	Version     int                 `json:"version"`
	Name        string              `json:"name"`
	Nodes       []UrvinNode         `json:"nodes"`
	CurrentNode string              `json:"current_node"`
	Aura        UrvinAura           `json:"aura"`
	AuraActive  bool                `json:"aura_active"`
	Event       *UrvinEventProgress `json:"event,omitempty"`
	Rooms       []UrvinRoom         `json:"rooms"`
	Stash       []JSONMap           `json:"stash,omitempty"`
}

func urvinRules(run *RoguelikeRun) (UrvinDefinition, error) {
	var rules UrvinDefinition
	err := decodeJSONMap(run.ModeRules, &rules)
	if err == nil && (rules.Version != 1 || rules.Rows < 4 || rules.Lanes < 1) {
		err = fmt.Errorf("unsupported journey definition")
	}
	return rules, err
}
func urvinJourney(run *RoguelikeRun) (UrvinJourney, error) {
	var journey UrvinJourney
	err := decodeJSONMap(run.Journey, &journey)
	if err == nil && journey.Version != 1 {
		err = fmt.Errorf("unsupported journey state")
	}
	return journey, err
}
func saveUrvinJourney(run *RoguelikeRun, j UrvinJourney) error {
	value, err := mapFromJSON(j)
	if err == nil {
		run.Journey = value
	}
	return err
}
func (j *UrvinJourney) current() *UrvinNode {
	for i := range j.Nodes {
		if j.Nodes[i].ID == j.CurrentNode {
			return &j.Nodes[i]
		}
	}
	return nil
}
func (d UrvinDefinition) room(kind string) UrvinRoom {
	for _, room := range d.Rooms {
		if room.ID == kind {
			return room
		}
	}
	return UrvinRoom{}
}

func loadUrvinDefinition(tx *gorm.DB) (UrvinDefinition, error) {
	var row struct {
		Definition JSONMap `gorm:"type:jsonb"`
	}
	var def UrvinDefinition
	if err := tx.Table("roguelike_mode_definitions").Where("id = ?", urvinMode).Take(&row).Error; err != nil {
		return def, err
	}
	if err := decodeJSONMap(row.Definition, &def); err != nil {
		return def, err
	}
	if def.Version != 1 || len(def.Auras) == 0 || len(def.Rooms) == 0 {
		return def, fmt.Errorf("incomplete journey definition")
	}
	// Presentation and mechanics use the editable effect entities at creation time.
	for i := range def.Auras {
		var effect Effect
		if err := tx.First(&effect, "id = ?", def.Auras[i].ID).Error; err != nil {
			return def, err
		}
		raw, err := mapFromJSON(effect)
		if err != nil {
			return def, err
		}
		key := def.Auras[i].Key
		if err = decodeJSONMap(raw, &def.Auras[i]); err != nil {
			return def, err
		}
		def.Auras[i].Key = key
	}
	return def, nil
}
func (rc *RoguelikeController) Modes(c *gin.Context) {
	def, err := loadUrvinDefinition(rc.db)
	if err != nil {
		writeRoguelikeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"mode": def})
}

func generateUrvinRoute(seed string, def UrvinDefinition) []UrvinNode {
	nodes := []UrvinNode{}
	total := 0
	for _, room := range def.Rooms {
		total += room.Weight
	}
	for row := 0; row < def.Rows; row++ {
		lanes := def.Lanes
		if row == def.Rows-1 {
			lanes = 1
		}
		for lane := 0; lane < lanes; lane++ {
			roll := roguelikeDeterministicInt(seed, "urvin-room", row*def.Lanes+lane, total)
			kind := "normal"
			for _, room := range def.Rooms {
				roll -= room.Weight
				if roll < 0 {
					kind = room.ID
					break
				}
			}
			switch {
			case row == 0:
				kind = "normal"
			case row == def.Rows-1:
				kind = "boss"
			case row == def.Rows-2:
				kind = "camp"
			case row == def.Rows/2:
				kind = "treasure"
			case row == 3 && lane == 1:
				kind = "shop"
			case row == 4 && lane == 0:
				kind = "elite"
			case row == 5 && lane == 2:
				kind = "pass"
			case row == 2 && lane == 1:
				kind = "event"
			case row == 10 && lane == 1:
				kind = "shop"
			}
			node := UrvinNode{ID: fmt.Sprintf("r%d-l%d", row, lane), Row: row, Lane: lane, Kind: kind, Next: []string{}}
			if row == def.Rows-2 {
				node.Next = append(node.Next, fmt.Sprintf("r%d-l0", row+1))
			} else if row < def.Rows-2 {
				node.Next = append(node.Next, fmt.Sprintf("r%d-l%d", row+1, lane))
				direction := 1
				if row%2 == 1 {
					direction = -1
				}
				if other := lane + direction; other >= 0 && other < def.Lanes {
					node.Next = append(node.Next, fmt.Sprintf("r%d-l%d", row+1, other))
				}
			}
			nodes = append(nodes, node)
		}
	}
	return nodes
}
func auraJourneyData(aura UrvinAura) struct {
	MaxPartySize int       `json:"max_party_size"`
	Operations   []JSONMap `json:"operations"`
} {
	var data struct {
		MaxPartySize int       `json:"max_party_size"`
		Operations   []JSONMap `json:"operations"`
	}
	raw, _ := json.Marshal(aura.Mechanics["journey"])
	_ = json.Unmarshal(raw, &data)
	return data
}
func configureRoguelikeMode(tx *gorm.DB, run *RoguelikeRun, request CreateRoguelikeRunRequest) error {
	if request.Mode == "" || request.Mode == "classic" {
		if request.AuraID != "" {
			return roguelikeError(400, "aura_not_available", "Аура выбирается только для Урвинского забега")
		}
		return nil
	}
	if request.Mode != urvinMode {
		return roguelikeError(400, "unknown_run_mode", "Неизвестный режим забега")
	}
	def, err := loadUrvinDefinition(tx)
	if err != nil {
		return err
	}
	var chosen *UrvinAura
	for i := range def.Auras {
		if def.Auras[i].ID == request.AuraID {
			chosen = &def.Auras[i]
		}
	}
	if chosen == nil {
		return roguelikeError(400, "starting_aura_required", "Выберите стартовую ауру")
	}
	data := auraJourneyData(*chosen)
	if data.MaxPartySize > 0 && roguelikePartySize(run) > data.MaxPartySize {
		return roguelikeError(400, "aura_party_size", "Эта аура доступна только одиночному герою")
	}
	run.Mode = urvinMode
	run.ModeRules, err = mapFromJSON(def)
	if err != nil {
		return err
	}
	run.JourneyPrivate = JSONMap{}
	j := UrvinJourney{Version: 1, Name: def.Name, Nodes: generateUrvinRoute(run.RunSeed, def), Aura: *chosen, AuraActive: true, Rooms: def.Rooms}
	if err = saveUrvinJourney(run, j); err != nil {
		return err
	}
	for _, member := range roguelikeCharacters(run) {
		rows := ActiveEffectRows{}
		if member.ActiveEffects != nil {
			rows = append(rows, (*member.ActiveEffects)...)
		}
		rows = append(rows, ActiveEffectRow{ID: chosen.ID, Name: chosen.Name, Mechanics: chosen.Mechanics, Source: chosen.Name, OwnerID: member.ID.String(), EntityRef: &ActiveEffectEntityRef{Kind: "effect", ID: chosen.ID, CardNumber: chosen.CardNumber}})
		member.ActiveEffects = &rows
	}
	for _, op := range data.Operations {
		if op["kind"] == "starting_gold" {
			amount, _ := numberFromJSON(op["amount"])
			setCurrencyCopper(run.Character, currencyCopper(run.Character)+amount*100)
			run.Gold = characterGold(run.Character)
		}
	}
	run.Shop = JSONMap{}
	run.Checkpoint, err = roguelikeCheckpoint(run, run.Character)
	if err != nil {
		return err
	}
	if err = saveRoguelikeParty(tx, run); err != nil {
		return err
	}
	return saveRoguelikeRun(tx, run)
}

func urvinCommandAllowed(run *RoguelikeRun, kind string) error {
	if run.Mode != urvinMode {
		return nil
	}
	if run.Status == RoguelikeStatusVictory && kind != "claim_stash" {
		return roguelikeError(409, "run_inactive", "Забег завершён; можно только забрать оставшуюся добычу")
	}
	j, err := urvinJourney(run)
	if err != nil {
		return err
	}
	node := j.current()
	if j.Event != nil && j.Event.Pending != nil && kind != "event_resolve" && kind != "event_continue" {
		return roguelikeError(409, "event_decision_pending", "Сначала завершите бросок события")
	}
	switch kind {
	case "start_encounter", "victory":
		return roguelikeError(409, "route_required", "Выберите следующую комнату на карте Урвинского забега")
	case "buy", "buy_cart", "pin", "refresh_shop":
		if node == nil || node.Kind != "shop" || node.Completed {
			return roguelikeError(409, "shop_room_required", "Магазин доступен только в комнате торговца")
		}
	case "short_rest", "long_rest", "bind_weapon":
		want := "pass"
		if kind == "long_rest" {
			want = "camp"
		}
		if node == nil || node.Kind != want || node.Completed {
			return roguelikeError(409, "rest_room_required", "Отдых доступен один раз в соответствующей комнате маршрута")
		}
	}
	return nil
}
func finishUrvinRoom(run *RoguelikeRun) error {
	if run.Mode != urvinMode {
		return nil
	}
	j, err := urvinJourney(run)
	if err != nil {
		return err
	}
	node := j.current()
	if node == nil {
		return fmt.Errorf("journey room missing")
	}
	node.Completed = true
	node.Result = run.LastReward
	return saveUrvinJourney(run, j)
}
func finishUrvinRest(run *RoguelikeRun, kind string) error {
	if run.Mode != urvinMode || (kind != "short_rest" && kind != "long_rest" && kind != "bind_weapon") {
		return nil
	}
	return finishUrvinRoom(run)
}
func urvinXPMultiplier(run *RoguelikeRun) int {
	if run.Mode != urvinMode {
		return 1
	}
	j, err := urvinJourney(run)
	if err != nil || !j.AuraActive {
		return 1
	}
	for _, op := range auraJourneyData(j.Aura).Operations {
		if op["kind"] == "experience_multiplier" {
			value, _ := numberFromJSON(op["value"])
			if value > 0 {
				return value
			}
		}
	}
	return 1
}
func syncUrvinAura(run *RoguelikeRun) {
	if run.Mode != urvinMode {
		return
	}
	j, err := urvinJourney(run)
	if err != nil {
		return
	}
	active := false
	for _, member := range roguelikeCharacters(run) {
		if member.ActiveEffects != nil {
			for _, e := range *member.ActiveEffects {
				if e.ID == j.Aura.ID {
					active = true
				}
			}
		}
	}
	j.AuraActive = active
	_ = saveUrvinJourney(run, j)
}

// In a route, a merchant is a limited opportunity rather than a permanent
// service. Its minimum special stock is an explicit mode policy, separate from
// the unchanged per-slot probabilities of the classic merchant.
func urvinFeaturedStock(run *RoguelikeRun, generation, level int, entries []roguelikeShopManifestEntry, rarities map[string]string, selected []roguelikeShopManifestEntry, pinned string) ([]roguelikeShopManifestEntry, error) {
	def, err := urvinRules(run)
	if err != nil {
		return nil, err
	}
	used, count := map[string]bool{}, 0
	if pinned != "" {
		used[pinned] = true
		if merchantRarity(rarities[pinned]) != "common" {
			count++
		}
	}
	for _, entry := range selected {
		used[entry.CardNumber] = true
		if merchantRarity(rarities[entry.CardNumber]) != "common" {
			count++
		}
	}
	pool := []roguelikeShopManifestEntry{}
	for _, entry := range entries {
		if entry.MinLevel <= level && !used[entry.CardNumber] && merchantRarity(rarities[entry.CardNumber]) != "common" {
			pool = append(pool, entry)
		}
	}
	for _, entry := range roguelikeWeightedOrder(run.RunSeed, "urvin-featured-shop", generation, pool) {
		if count >= def.Shop.MinimumMagicItems {
			break
		}
		selected = append(selected, entry)
		count++
	}
	return selected, nil
}

func enterUrvinRoom(tx *gorm.DB, run *RoguelikeRun, nodeID string) error {
	if run.Mode != urvinMode || run.Status != RoguelikeStatusActive || run.Phase != RoguelikePhaseCamp {
		return roguelikeError(409, "route_unavailable", "Карта сейчас недоступна")
	}
	if run.PendingLevel != 0 {
		return roguelikeError(409, "level_up_pending", "Сначала завершите повышение уровня")
	}
	level := roguelikeLevelForXP(run.Experience)
	for _, member := range roguelikeCharacters(run) {
		if member.Level != level {
			return roguelikeError(409, "party_level_required", "Сначала повысьте уровень всех участников")
		}
	}
	def, err := urvinRules(run)
	if err != nil {
		return err
	}
	j, err := urvinJourney(run)
	if err != nil {
		return err
	}
	previous := j.current()
	allowed := previous == nil
	if previous != nil {
		if !previous.Completed {
			return roguelikeError(409, "room_unfinished", "Сначала завершите текущую комнату")
		}
		allowed = false
		for _, next := range previous.Next {
			if next == nodeID {
				allowed = true
			}
		}
	}
	var node *UrvinNode
	for i := range j.Nodes {
		if j.Nodes[i].ID == nodeID {
			node = &j.Nodes[i]
		}
	}
	if node == nil || node.Completed || !allowed || (previous == nil && node.Row != 0) {
		return roguelikeError(409, "room_not_reachable", "В эту комнату нет пути из текущей точки")
	}
	// A retry restores exactly the entrance to this room, including the selected route.
	j.CurrentNode = node.ID
	j.Event = nil
	run.LastReward = JSONMap{}
	run.JourneyPrivate = JSONMap{}
	run.Encounter = JSONMap{}
	node.ResolvedKind = node.Kind
	if node.Kind == "event" {
		roll := roguelikeDeterministicInt(run.RunSeed, "urvin-event-kind", node.Row*def.Lanes+node.Lane, 100)
		if roll < def.EventEliteChance {
			node.ResolvedKind = "elite"
		} else if roll < def.EventEliteChance+def.EventCombatChance {
			node.ResolvedKind = "normal"
		}
	}
	if err = saveUrvinJourney(run, j); err != nil {
		return err
	}
	run.Checkpoint, err = roguelikeCheckpoint(run, run.Character)
	if err != nil {
		return err
	}
	switch node.ResolvedKind {
	case "normal", "elite", "boss":
		return startUrvinEncounter(tx, run, node.ResolvedKind, false, "")
	case "shop":
		run.Shop, err = generateRoguelikeShop(tx, run, level, nil)
		return err
	case "treasure":
		if err = grantUrvinReward(tx, run, def.room("treasure").Reward, "treasure"); err != nil {
			return err
		}
		return finishUrvinRoom(run)
	case "camp":
		run.Supplies += roguelikePartySize(run)
		run.Checkpoint, err = roguelikeCheckpoint(run, run.Character)
		return err
	case "pass":
		return nil
	case "event":
		if len(def.Events) == 0 {
			return fmt.Errorf("empty event catalog")
		}
		event := def.Events[roguelikeDeterministicInt(run.RunSeed, "urvin-event", node.Row*def.Lanes+node.Lane, len(def.Events))]
		j.Event = &UrvinEventProgress{Definition: event, Rolls: []JSONMap{}}
		if err = saveUrvinJourney(run, j); err != nil {
			return err
		}
		run.Checkpoint, err = roguelikeCheckpoint(run, run.Character)
		return err
	default:
		return fmt.Errorf("unknown room kind %s", node.ResolvedKind)
	}
}

func startUrvinEncounter(tx *gorm.DB, run *RoguelikeRun, kind string, surprise bool, encounterID string) error {
	def, err := urvinRules(run)
	if err != nil {
		return err
	}
	j, err := urvinJourney(run)
	if err != nil {
		return err
	}
	node := j.current()
	if node == nil {
		return fmt.Errorf("missing encounter room")
	}
	if kind == "normal" && encounterID == "" {
		// Preserve the established ordinary encounter generator; only its admission
		// and completion rules differ for the route mode.
		xp := run.Experience
		if xp >= roguelikeVictoryXP {
			run.Experience = roguelikeVictoryXP - 1
		}
		err = startRoguelikeEncounter(tx, run)
		run.Experience = xp
		if err != nil {
			return err
		}
		maps := []string{}
		for _, entry := range def.Encounters {
			if entry.Kind == "elite" {
				maps = entry.MapIDs
				break
			}
		}
		if len(maps) > 0 {
			run.Encounter["map_id"] = maps[roguelikeDeterministicInt(run.RunSeed, "urvin-map-template", node.Row*def.Lanes+node.Lane, len(maps))]
		}
	} else {
		level := roguelikeLevelForXP(run.Experience)
		choices := []UrvinEncounter{}
		for _, e := range def.Encounters {
			if e.Kind == kind && e.MinLevel <= level && e.MaxLevel >= level && e.ID == encounterID {
				choices = append(choices, e)
			}
		}
		if len(choices) == 0 {
			return fmt.Errorf("missing %s encounter at level %d", kind, level)
		}
		selected := choices[roguelikeDeterministicInt(run.RunSeed, "urvin-roster", node.Row*def.Lanes+node.Lane, len(choices))]
		monsters := []Monster{}
		roster := []JSONMap{}
		totalXP, totalCount := 0, 0
		names := []string{}
		for _, entry := range selected.Monsters {
			qty := entry.Quantity
			if entry.PerMember {
				qty *= roguelikePartySize(run)
			}
			if entry.PerExtraMember {
				qty *= roguelikePartySize(run) - 1
			}
			if qty == 0 {
				continue
			}
			var m Monster
			if err = tx.Where("slug = ?", entry.Slug).First(&m).Error; err != nil {
				return err
			}
			m.MaxHP = int(math.Ceil(float64(m.MaxHP) * (1 + entry.HPPerExtraMember*float64(roguelikePartySize(run)-1))))
			xp := 0
			if m.AI != nil {
				xp, _ = numberFromJSON((*m.AI)["experience"])
			}
			if xp == 0 {
				for _, candidate := range roguelikeMonsterPool {
					if candidate.Slug == m.Slug {
						xp = candidate.XP
					}
				}
			}
			if xp <= 0 {
				return fmt.Errorf("monster experience missing")
			}
			totalXP += xp * qty
			totalCount += qty
			monsters = append(monsters, m)
			roster = append(roster, JSONMap{"monster_id": m.ID, "monster_slug": m.Slug, "monster_name": m.Name, "quantity": qty, "xp_each": xp})
			names = append(names, m.Name)
		}
		catalog, e := freezeRoguelikeMonsterCatalog(tx, monsters)
		if e != nil {
			return e
		}
		run.Encounter = JSONMap{"number": run.EncountersWon + 1, "difficulty": "high", "budget_xp": totalXP, "xp_total": totalXP, "quantity": totalCount, "roster": roster, "monster_name": strings.Join(names, ", "), "catalog": catalog, "composition_key": node.ID + ":" + kind, "generator_version": "urvin-v1", "map_seed": roguelikeDeterministicInt(run.RunSeed, "urvin-map", node.Row*def.Lanes+node.Lane, 1<<30)}
		if len(selected.MapIDs) > 0 {
			run.Encounter["map_id"] = selected.MapIDs[roguelikeDeterministicInt(run.RunSeed, "urvin-map-template", node.Row, len(selected.MapIDs))]
		}
		run.Phase = RoguelikePhaseCombat
		run.CombatEnvelope = JSONMap{}
		run.CombatCatalog = JSONMap{}
	}
	run.Encounter["urvin_room"] = kind
	run.Encounter["urvin_node"] = node.ID
	if os.Getenv("RULES_WORKER_URL") != "" {
		run.Encounter["trusted_required"] = true
	}
	if surprise {
		run.Encounter["enemy_effects"] = []JSONMap{{"id": "event-surprise", "name": "Застигнут врасплох", "source": "Засада", "mechanics": JSONMap{"kind": "modifier", "applies_to": JSONMap{"roll": "initiative"}, "op": "disadvantage"}, "expiry": "end_of_turn"}}
	}
	node.ResolvedKind = kind
	return saveUrvinJourney(run, j)
}

func grantUrvinReward(tx *gorm.DB, run *RoguelikeRun, reward UrvinReward, stream string) error {
	j, err := urvinJourney(run)
	if err != nil {
		return err
	}
	node := j.current()
	if node == nil {
		return fmt.Errorf("missing reward room")
	}
	cursor := node.Row*10 + node.Lane
	xp := reward.Experience * urvinXPMultiplier(run)
	gold := reward.Gold[0] + roguelikeDeterministicInt(run.RunSeed, "urvin-"+stream, cursor, reward.Gold[1]-reward.Gold[0]+1)
	run.Experience += xp
	setCurrencyCopper(run.Character, currencyCopper(run.Character)+gold*100)
	run.Gold = characterGold(run.Character)
	run.LastReward = JSONMap{"experience": xp, "gold": gold, "total_experience": run.Experience}
	if reward.LootMinRarity != "" {
		item, e := grantUrvinLoot(tx, run, reward.LootMinRarity, stream, cursor)
		if e != nil {
			return e
		}
		run.LastReward["item"] = item
		run.LastReward["items"] = []JSONMap{item}
	}
	return nil
}
func grantUrvinLoot(tx *gorm.DB, run *RoguelikeRun, minRarity, stream string, cursor int) (JSONMap, error) {
	cfg, _, err := loadMerchantConfig(tx)
	if err != nil {
		return nil, err
	}
	entries, cards, err := runPoolEntries(tx, cfg.PoolTag)
	if err != nil {
		return nil, err
	}
	ranks := map[string]int{"common": 0, "uncommon": 1, "rare": 2, "epic": 3, "legendary": 4, "artifact": 5}
	pool := []roguelikeShopManifestEntry{}
	for _, entry := range entries {
		card := cards[entry.CardNumber]
		if entry.MinLevel <= roguelikeLevelForXP(run.Experience) && ranks[merchantRarity(string(card.Rarity))] >= ranks[minRarity] {
			pool = append(pool, entry)
		}
	}
	// Merchant level gates govern offers, not a guaranteed room trophy. If the
	// current level has no eligible reward, retain the rarity promise using the
	// same tagged pool; never silently downgrade an elite or boss reward.
	if len(pool) == 0 {
		for _, entry := range entries {
			if ranks[merchantRarity(string(cards[entry.CardNumber].Rarity))] >= ranks[minRarity] {
				pool = append(pool, entry)
			}
		}
	}
	ordered := roguelikeWeightedOrder(run.RunSeed, "urvin-loot-"+stream, cursor, pool)
	if len(ordered) == 0 {
		return nil, roguelikeError(409, "loot_pool_empty", "В тегированном пуле нет предмета нужной редкости")
	}
	card := cards[ordered[0].CardNumber]
	for _, member := range roguelikeCharacters(run) {
		if validateRoguelikeAdditionalWeight(tx, member, &card, 1) == nil {
			addInventoryItem(member, card.ID.String(), 1)
			return JSONMap{"card_id": card.ID.String(), "card_number": card.CardNumber, "name": card.Name, "character_id": member.ID.String()}, nil
		}
	}
	// Keep the item, rather than downgrading a guaranteed rare reward or blocking
	// victory. A stash entry can be claimed later after freeing inventory space.
	j, err := urvinJourney(run)
	if err != nil {
		return nil, err
	}
	item := JSONMap{"card_id": card.ID.String(), "card_number": card.CardNumber, "name": card.Name}
	j.Stash = append(j.Stash, item)
	return item, saveUrvinJourney(run, j)
}

func rewardUrvinVictory(tx *gorm.DB, run *RoguelikeRun) error {
	def, err := urvinRules(run)
	if err != nil {
		return err
	}
	j, err := urvinJourney(run)
	if err != nil {
		return err
	}
	node := j.current()
	if node == nil || node.Completed {
		return roguelikeError(409, "room_already_completed", "Награда комнаты уже получена")
	}
	kind, _ := run.Encounter["urvin_room"].(string)
	room := def.room(kind)
	if room.ID == "" {
		return fmt.Errorf("unknown encounter reward")
	}
	xp, err := encounterNumber(run, "xp_total")
	if err != nil {
		return err
	}
	quantity, err := encounterNumber(run, "quantity")
	if err != nil {
		return err
	}
	gold := 0
	for die := 0; die < quantity*3; die++ {
		gold += 1 + roguelikeDeterministicInt(run.RunSeed, "urvin-combat-gold", node.Row*1000+node.Lane*100+die, 6)
	}
	reward := UrvinReward{Experience: xp / roguelikePartySize(run) * room.XPMultiplier, Gold: [2]int{gold * room.GoldMultiplier, gold * room.GoldMultiplier}, LootMinRarity: room.LootMinRarity}
	if err = grantUrvinReward(tx, run, reward, "combat"); err != nil {
		return err
	}
	run.EncountersWon++
	run.GameClockHours++
	syncUrvinAura(run)
	for _, member := range roguelikeCharacters(run) {
		clearCharacterSoloCombat(member)
	}
	if err = finishUrvinRoom(run); err != nil {
		return err
	}
	run.Encounter = JSONMap{}
	run.CombatEnvelope = JSONMap{}
	run.CombatCatalog = JSONMap{}
	run.Phase = RoguelikePhaseCamp
	if kind == "boss" {
		run.Status = RoguelikeStatusVictory
		run.Phase = RoguelikePhaseEnded
	}
	run.Checkpoint, err = roguelikeCheckpoint(run, run.Character)
	return err
}

func applyUrvinRoomCommand(tx *gorm.DB, run *RoguelikeRun, request RoguelikeCommandRequest) error {
	activeCamp := run.Status == RoguelikeStatusActive && run.Phase == RoguelikePhaseCamp
	victoryStash := request.Type == "claim_stash" && run.Status == RoguelikeStatusVictory && run.Phase == RoguelikePhaseEnded
	if run.Mode != urvinMode || (!activeCamp && !victoryStash) {
		return roguelikeError(409, "route_unavailable", "Комната сейчас недоступна")
	}
	j, err := urvinJourney(run)
	if err != nil {
		return err
	}
	node := j.current()
	if node == nil {
		return roguelikeError(409, "room_required", "Сначала выберите комнату")
	}
	switch request.Type {
	case "leave_room":
		if node.Completed {
			return nil
		}
		if node.Kind != "shop" {
			return roguelikeError(409, "room_unfinished", "Сначала завершите событие или отдых")
		}
		return finishUrvinRoom(run)
	case "resume_room":
		if node.Completed {
			return roguelikeError(409, "room_completed", "Комната уже завершена")
		}
		if len(run.Encounter) > 0 {
			run.Phase = RoguelikePhaseCombat
			return nil
		}
		if node.ResolvedKind == "normal" || node.ResolvedKind == "elite" || node.ResolvedKind == "boss" {
			return startUrvinEncounter(tx, run, node.ResolvedKind, false, "")
		}
		return roguelikeError(409, "room_not_combat", "В этой комнате нет боя")
	case "claim_stash":
		cardID := roguelikePayloadString(request, "card_id")
		index := -1
		for i, item := range j.Stash {
			if item["card_id"] == cardID {
				index = i
				break
			}
		}
		if index < 0 {
			return roguelikeError(404, "stash_item_missing", "Предмет не найден")
		}
		var card Card
		if err = tx.First(&card, "id = ?", cardID).Error; err != nil {
			return err
		}
		var member *CharacterV3
		for _, c := range roguelikeCharacters(run) {
			if c.ID.String() == roguelikePayloadString(request, "character_id") {
				member = c
			}
		}
		if member == nil {
			return roguelikeError(400, "party_member_required", "Выберите участника группы")
		}
		if err = validateRoguelikeAdditionalWeight(tx, member, &card, 1); err != nil {
			return err
		}
		addInventoryItem(member, cardID, 1)
		j.Stash = append(j.Stash[:index], j.Stash[index+1:]...)
		return saveUrvinJourney(run, j)
	default:
		return applyUrvinEventCommand(tx, run, request)
	}
}
