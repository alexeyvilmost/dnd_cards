package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type catalogEntityCreateCheck struct {
	name    string
	payload map[string]any
	handler gin.HandlerFunc
}

func catalogEntityCreateChecks(db *gorm.DB, suffix string) []catalogEntityCreateCheck {
	return []catalogEntityCreateCheck{
		{
			name: "card",
			payload: map[string]any{
				"name": "Скипетр Владычества", "name_en": nil,
				"description":          "Использовав способность скипетра, вы становитесь его полноправным владельцем. Вы можете свободным действием призвать скипетр в свою руку.\n\nПока скипетр в вашей руке, вы получаете доступ к действиям:\n- Подчинение существа\n- Впитывание силы\n- Поднятие нежити\nКогда вы отпускаете скипетр, вы должны получить по 1 степени истощения за каждую использованную способность.\nПока скипетр у вас в руках, вы не можете умереть.",
				"detailed_description": nil, "rarity": "artifact", "custom_rarity_color": nil, "properties": nil,
				"price": 1000000, "price_currency": "gold", "price_abbreviated": false, "weight": 4,
				"bonus_type": "damage", "bonus_value": "1d6 (1d8)", "damage_type": "bludgeoning",
				"elemental_damage_value": nil, "elemental_damage_type": nil, "enchant_bonus": nil, "defense_type": nil,
				"description_font_size": nil, "text_alignment": "left", "text_font_size": 11,
				"show_detailed_description": false, "detailed_description_alignment": nil, "detailed_description_font_size": nil,
				"is_extended": true, "author": "Admin", "source": nil, "type": "weapon", "weapon_type": nil,
				"related_cards": nil, "related_actions": nil, "related_effects": nil, "attunement": nil,
				"requires_attunement": false, "range": nil, "slot": "versatile", "is_template": "false",
				"image_prompt_extra": nil, "battle_profile": nil, "container_mode": nil, "contents": nil,
				"effects": nil, "mechanics": nil,
			},
			handler: NewCardController(db).CreateCard,
		},
		{
			name: "action",
			payload: map[string]any{
				"name": "Проверка действия", "description": "Транзакционная проверка.", "rarity": "common",
				"card_number": "SMK_ACT_" + suffix, "resources": []string{"action"}, "action_type": "base_action",
			},
			handler: NewActionController(db).CreateAction,
		},
		{
			name: "effect",
			payload: map[string]any{
				"name": "Проверка эффекта", "description": "Транзакционная проверка.", "rarity": "common",
				"card_number": "SMK_EFF_" + suffix, "effect_type": "passive",
			},
			handler: NewEffectController(db).CreateEffect,
		},
		{
			name: "spell",
			payload: map[string]any{
				"name": "Проверка заклинания", "description": "Транзакционная проверка.",
				"card_number": "SMK_SPL_" + suffix, "level": 0,
			},
			handler: NewSpellController(db).CreateSpell,
		},
		{
			name: "feat",
			payload: map[string]any{
				"name": "Проверка черты", "description": "Транзакционная проверка.",
				"card_number": "SMK_FEA_" + suffix, "category": "general",
			},
			handler: NewFeatController(db).CreateFeat,
		},
		{
			name: "background",
			payload: map[string]any{
				"name": "Проверка предыстории", "description": "Транзакционная проверка.",
				"card_number": "SMK_BG_" + suffix,
			},
			handler: NewBackgroundController(db).CreateBackground,
		},
		{
			name: "race",
			payload: map[string]any{
				"name": "Проверка вида", "description": "Транзакционная проверка.",
				"card_number": "SMK_RAC_" + suffix,
			},
			handler: NewRaceController(db).CreateRace,
		},
		{
			name: "class",
			payload: map[string]any{
				"name": "Проверка класса", "description": "Транзакционная проверка.",
				"card_number": "SMK_CLS_" + suffix,
			},
			handler: NewClassController(db).CreateClass,
		},
		{
			name: "resource",
			payload: map[string]any{
				"resource_id": "smoke_resource_" + suffix, "name": "Проверка ресурса",
			},
			handler: NewResourceController(db).CreateResource,
		},
		{
			name: "variable",
			payload: map[string]any{
				"variable_id": "smoke_variable_" + suffix, "name": "Проверка переменной", "default_value": "0",
			},
			handler: NewVariableController(db).CreateVariable,
		},
		{
			name: "concept",
			payload: map[string]any{
				"concept_id": "smoke_concept_" + suffix, "name": "Проверка понятия",
			},
			handler: NewConceptController(db).CreateConcept,
		},
		{
			name: "monster",
			payload: map[string]any{
				"slug": "smoke-monster-" + suffix, "name": "Проверка монстра",
			},
			handler: NewMonsterController(db).Create,
		},
	}
}

// verifyCatalogEntityCreates is a deployment gate against the actual migrated
// database. Every public catalog constructor writes through its real handler;
// the enclosing transaction is always rolled back, so no smoke entities remain.
func verifyCatalogEntityCreates(db *gorm.DB) error {
	tx := db.Begin()
	if tx.Error != nil {
		return fmt.Errorf("begin entity creation smoke transaction: %w", tx.Error)
	}
	finished := false
	defer func() {
		if !finished {
			_ = tx.Rollback().Error
		}
	}()

	if err := tx.Exec(`SELECT pg_advisory_xact_lock(hashtext('dnd_cards_entity_create_smoke'))`).Error; err != nil {
		return fmt.Errorf("lock entity creation smoke transaction: %w", err)
	}
	if err := tx.Exec(`SET LOCAL lock_timeout = '5s'`).Error; err != nil {
		return fmt.Errorf("set entity creation smoke lock timeout: %w", err)
	}
	// Card IDs are generated from the current maximum. Briefly serialize card
	// writes so a request served by the old instance cannot choose the same ID
	// while the new instance is running its pre-traffic deployment check.
	if err := tx.Exec(`LOCK TABLE cards IN SHARE ROW EXCLUSIVE MODE`).Error; err != nil {
		return fmt.Errorf("lock cards for entity creation smoke: %w", err)
	}

	suffix := strings.ReplaceAll(uuid.NewString(), "-", "")[:8]
	for _, check := range catalogEntityCreateChecks(tx, suffix) {
		payload, err := json.Marshal(check.payload)
		if err != nil {
			return fmt.Errorf("marshal %s create payload: %w", check.name, err)
		}
		recorder := httptest.NewRecorder()
		context, _ := gin.CreateTestContext(recorder)
		context.Set(requestIDContextKey, "deployment-smoke-"+suffix)
		context.Request = httptest.NewRequest(http.MethodPost, "/deployment-smoke/"+check.name, bytes.NewReader(payload))
		context.Request.Header.Set("Content-Type", "application/json")
		check.handler(context)
		if recorder.Code != http.StatusCreated {
			response := strings.TrimSpace(recorder.Body.String())
			if len(response) > 800 {
				response = response[:800]
			}
			return fmt.Errorf("%s create smoke returned HTTP %d: %s", check.name, recorder.Code, response)
		}
	}

	rollbackError := tx.Rollback().Error
	finished = true
	if rollbackError != nil {
		return fmt.Errorf("rollback entity creation smoke transaction: %w", rollbackError)
	}
	return nil
}
