package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
	openai "github.com/sashabaranov/go-openai"
)

// AIMechanicsController — генерация унифицированной механики по описанию
// (кнопка «AI» в редакторах механики). Ключ: OPENAI_API_KEY.
type AIMechanicsController struct {
	service *OpenAIService
}

func NewAIMechanicsController() *AIMechanicsController {
	return &AIMechanicsController{service: NewOpenAIService()}
}

type GenerateMechanicsRequest struct {
	// Вид сущности: item | spell | action | passive_effect | trait
	Kind        string `json:"kind" binding:"required"`
	Name        string `json:"name" binding:"required"`
	Description string `json:"description" binding:"required"`
	// Дополнительный контекст (уровень заклинания, тип предмета и т.п.)
	Extra string `json:"extra"`
}

// Системный промпт: словарь payload-ов и контракт движка (см.
// docs/unified-mechanics-schema.md §6.5 и frontend/src/engine/execute.ts).
const mechanicsSystemPrompt = `Ты — генератор JSON-механик для движка D&D-приложения. По русскому описанию способности/предмета/заклинания верни ТОЛЬКО валидный JSON-объект механики без пояснений.

## Формат механики
{"activation": {...}, "targeting": {...}?, "effects": [interaction...], "uses": {...}?}

activation: {"mode":"active"|"passive"|"triggered", "cost":[{"resource":"action"|"bonus_action"|"reaction"}, {"resource":"spell_slot","level":N,"amount":1}]?, "trigger":{"event":"long_rest","timing":"after"}?}
- Пассивные свойства предметов/черт: {"mode":"passive"} без cost.
- Заговоры (уровень 0): без стоимости слота. Заклинания уровня N: слот уровня N.

uses (ограниченные активации): {"count": N | "prof_bonus", "per": "long_rest"|"short_rest"}

interaction — ровно одна резолюция:
1. {"resolution":"attack_roll","attack_kind":"spell_ranged"|"spell_melee"|"weapon_melee","ability":"spellcasting"|"str"|"auto","vs":"ac","on_hit":[payload...],"on_crit":[payload...]?}
2. {"resolution":"save","who":"target","ability":"str"|"dex"|"con"|"int"|"wis"|"cha","dc":"8 + prof + spellcasting" | число,"on_fail":[payload...],"on_success":[payload...]}
3. {"resolution":"auto","result":[payload...]}

payload-ы (kind СТРОГО из этого списка):
- {"kind":"damage","dice":"2d6","type":"fire|cold|lightning|thunder|acid|poison|necrotic|radiant|psychic|force|bludgeoning|piercing|slashing","scaling":{"per":"character_level"|"spell_slot_above","dice":"1d6"}?,"on_success":"half"|"none"|"full"?}
- {"kind":"healing","amount":"1d8 + spellcasting"}
- {"kind":"temp_hp","amount":"2d4 + 4"}
- {"kind":"condition","value":"prone|charmed|frightened|restrained|poisoned|stunned|grappled|incapacitated|invisible|blinded|deafened","op":"apply"|"remove","duration":{"type":"rounds","amount":N}?} — duration ТОЛЬКО объект, не строка.
- {"kind":"resistance","damage_type":"fire|...","value":"resistance"|"immunity"|"vulnerability"} — устойчивость/иммунитет/уязвимость к урону.
- {"kind":"resource","op":"grant"|"restore"|"spend","id":"...","amount":N}
- {"kind":"modifier","applies_to":{"roll":"attack"|"damage"|"ability_check"|"saving_throw"|"ac"|"speed"|"spell_dc"|"initiative"|"carry"|"max_hp","filter":{"ability":"dex"}?|{"skill":"stealth"}?},"op":"add"|"set"|"advantage"|"disadvantage"|"multiply","value":"+2"} — roll СТРОГО из списка (НЕ attack_roll, НЕ skill); ТОЛЬКО числовые значения; ТОЛЬКО на самого владельца.
- {"kind":"set_value","target":"ac_base","formula":"13 + dex"} — базовый КЗ (Доспехи мага и т.п.)
- {"kind":"movement","value":"push|pull|teleport|extra_speed|double|knock_prone","distance":N}
- {"kind":"grant_speed","mode":"walk"|"fly"|"swim"|"climb","value":N} / {"kind":"grant_sense","sense":"darkvision","range":N}
- {"kind":"grant_proficiency","prof":"skill|tool|saving_throw|weapon|armor|language","value":"..."} / {"kind":"grant_spell","value":"slug"} / {"kind":"grant_feat","value":"slug"} / {"kind":"grant_language","value":"..."} / {"kind":"grant_expertise","value":"skill"}
- grant_spell.freeuse — «раз в день/отдых бесплатно, без ячейки»: {"kind":"grant_spell","value":"slug","freeuse":{"count":1,"recharge":"long_rest"}} (или freeuse:true = 1×/long_rest; count — число; level — фикс. круг бесплатного каста). Работает и внутри choice.grant.
- {"kind":"narrative","description":"..."} — всё, что движок не исполняет.

## Правила
- Формулы: числа, кости NdM, str..cha, prof, spellcasting, self_level, min(), max(), + - * /.
- uses.per СТРОГО: "turn"|"round"|"short_rest"|"long_rest"|"day".
- cost.resource — id ресурса, не закрытый список (частые: action, bonus_action, reaction, movement, spell_slot, rage, focus, superiority_die); допустим любой ресурс из справочника.
- trigger.event СТРОГО: attack_roll_made|hit|miss|crit|damage_dealt|damage_taken|saving_throw_made|ability_check_made|reduced_to_0_hp|turn_start|turn_end|spell_cast|short_rest|long_rest.
- resolution СТРОГО: attack_roll|save|ability_check|auto. Каждый элемент effects — объект interaction, не строка.
- Кости в модификаторах (например «+1к4 к атакам») НЕ поддерживаются → narrative.
- Эффекты на ДРУГИХ существ (бафф союзника, помеха врагу вне спасброска) → narrative.
- Пассивный бонус предмета (+1 КЗ, +2 к атакам) → mode:"passive", effects:[{"resolution":"auto","result":[{"kind":"modifier",...}]}].
- Сложные/ситуативные правила упрощай до исполнимого ядра, детали — narrative-payload'ом рядом.
- Отвечай ТОЛЬКО JSON-объектом механики, компактно, без markdown.`

// GenerateMechanics — POST /api/ai/mechanics
func (a *AIMechanicsController) GenerateMechanics(c *gin.Context) {
	if a.service == nil || a.service.client == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "OpenAI API не настроен (OPENAI_API_KEY)"})
		return
	}
	var req GenerateMechanicsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверные данные запроса"})
		return
	}

	user := fmt.Sprintf("Вид сущности: %s\nНазвание: %s\nОписание: %s", req.Kind, req.Name, req.Description)
	if strings.TrimSpace(req.Extra) != "" {
		user += "\nКонтекст: " + req.Extra
	}

	model := os.Getenv("OPENAI_MECHANICS_MODEL")
	if model == "" {
		model = "gpt-4o-mini"
	}

	resp, err := a.service.client.CreateChatCompletion(context.Background(), openai.ChatCompletionRequest{
		Model: model,
		ResponseFormat: &openai.ChatCompletionResponseFormat{
			Type: openai.ChatCompletionResponseFormatTypeJSONObject,
		},
		Temperature: 0.2,
		Messages: []openai.ChatCompletionMessage{
			{Role: openai.ChatMessageRoleSystem, Content: mechanicsSystemPrompt},
			{Role: openai.ChatMessageRoleUser, Content: user},
		},
	})
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("Ошибка генерации: %v", err)})
		return
	}
	if len(resp.Choices) == 0 {
		c.JSON(http.StatusBadGateway, gin.H{"error": "Пустой ответ модели"})
		return
	}

	var mechanics map[string]interface{}
	if err := json.Unmarshal([]byte(resp.Choices[0].Message.Content), &mechanics); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "Модель вернула невалидный JSON", "raw": resp.Choices[0].Message.Content})
		return
	}

	c.JSON(http.StatusOK, gin.H{"mechanics": mechanics, "model": model})
}
