package main

import (
	"encoding/json"
	"fmt"
	"math"
	"strings"
)

const (
	maxCharacterEventBatchBodyBytes = 2 << 20
	maxCharacterEventPayloadBytes   = 128 << 10
	maxCharacterEventStringBytes    = 16 << 10
	maxCharacterEventListItems      = 256
	maxSafeJSONInteger              = 1<<53 - 1
)

// characterEventValidationError identifies client-owned journal protocol
// errors. Keeping this typed lets every writer (the CharacterV3 route, the
// encounter relay, and the GORM model hook) share one fail-closed validator.
type characterEventValidationError struct {
	Path    string
	Problem string
}

func (e *characterEventValidationError) Error() string {
	if e.Path == "" {
		return e.Problem
	}
	return fmt.Sprintf("%s: %s", e.Path, e.Problem)
}

func invalidCharacterEvent(path, problem string) error {
	return &characterEventValidationError{Path: path, Problem: problem}
}

// validateCharacterEvent checks the persisted EngineEvent wire contract. The
// dispatch key is the protocol event kind, never a content/entity identity.
// Unknown kinds and fields are rejected intentionally: adding an EngineEvent
// requires updating both the TypeScript contract and this persistence boundary.
func validateCharacterEvent(eventType string, payload JSONMap) error {
	if eventType == "" {
		return invalidCharacterEvent("type", "must be a supported EngineEvent type")
	}

	encoded, err := json.Marshal(payload)
	if err != nil {
		return invalidCharacterEvent("payload", "must be valid JSON")
	}
	if len(encoded) > maxCharacterEventPayloadBytes {
		return invalidCharacterEvent("payload", "is too large")
	}
	var normalized map[string]any
	if err := json.Unmarshal(encoded, &normalized); err != nil || normalized == nil {
		return invalidCharacterEvent("payload", "must be a JSON object")
	}

	payloadType, err := requiredString(normalized, "type", "payload.type", false)
	if err != nil {
		return err
	}
	if eventType != payloadType {
		return invalidCharacterEvent("type", "must exactly match payload.type")
	}

	switch payloadType {
	case "roll":
		if err := exactKeys(normalized, "payload", []string{"type", "label", "roll"}, nil); err != nil {
			return err
		}
		if _, err := requiredString(normalized, "label", "payload.label", false); err != nil {
			return err
		}
		return requiredRoll(normalized, "roll", "payload.roll")

	case "damage":
		if err := exactKeys(normalized, "payload", []string{"type", "amount", "damageType"}, []string{"roll", "source"}); err != nil {
			return err
		}
		if err := requiredNonNegativeInteger(normalized, "amount", "payload.amount"); err != nil {
			return err
		}
		if _, err := requiredString(normalized, "damageType", "payload.damageType", false); err != nil {
			return err
		}
		return validateOptionalRollAndSource(normalized)

	case "healing", "damage_reduction":
		if err := exactKeys(normalized, "payload", []string{"type", "amount"}, []string{"roll", "source"}); err != nil {
			return err
		}
		if err := requiredNonNegativeInteger(normalized, "amount", "payload.amount"); err != nil {
			return err
		}
		return validateOptionalRollAndSource(normalized)

	case "temp_hp":
		if err := exactKeys(normalized, "payload", []string{"type", "amount"}, []string{"source"}); err != nil {
			return err
		}
		if err := requiredNonNegativeInteger(normalized, "amount", "payload.amount"); err != nil {
			return err
		}
		return optionalString(normalized, "source", "payload.source", false)

	case "resource_spent":
		if err := exactKeys(normalized, "payload", []string{"type", "resource", "amount", "remaining"}, nil); err != nil {
			return err
		}
		if _, err := requiredString(normalized, "resource", "payload.resource", false); err != nil {
			return err
		}
		if err := requiredNonNegativeInteger(normalized, "amount", "payload.amount"); err != nil {
			return err
		}
		return requiredNonNegativeInteger(normalized, "remaining", "payload.remaining")

	case "resource_restored":
		if err := exactKeys(normalized, "payload", []string{"type", "resource", "amount", "current"}, nil); err != nil {
			return err
		}
		if _, err := requiredString(normalized, "resource", "payload.resource", false); err != nil {
			return err
		}
		if err := requiredNonNegativeInteger(normalized, "amount", "payload.amount"); err != nil {
			return err
		}
		return requiredNonNegativeInteger(normalized, "current", "payload.current")

	case "item_consumed":
		if err := exactKeys(normalized, "payload", []string{"type", "cardId", "amount", "remaining"}, []string{"name"}); err != nil {
			return err
		}
		if _, err := requiredString(normalized, "cardId", "payload.cardId", false); err != nil {
			return err
		}
		if err := requiredNonNegativeInteger(normalized, "amount", "payload.amount"); err != nil {
			return err
		}
		if err := requiredNonNegativeInteger(normalized, "remaining", "payload.remaining"); err != nil {
			return err
		}
		return optionalString(normalized, "name", "payload.name", false)

	case "item_added":
		if err := exactKeys(normalized, "payload", []string{"type", "cardId", "qty", "total"}, []string{"name"}); err != nil {
			return err
		}
		if _, err := requiredString(normalized, "cardId", "payload.cardId", false); err != nil {
			return err
		}
		if err := requiredPositiveInteger(normalized, "qty", "payload.qty"); err != nil {
			return err
		}
		if err := requiredNonNegativeInteger(normalized, "total", "payload.total"); err != nil {
			return err
		}
		return optionalString(normalized, "name", "payload.name", false)

	case "effect_applied":
		if err := exactKeys(normalized, "payload", []string{"type", "name"}, []string{"sourceAction", "source"}); err != nil {
			return err
		}
		if _, err := requiredString(normalized, "name", "payload.name", false); err != nil {
			return err
		}
		if err := optionalString(normalized, "sourceAction", "payload.sourceAction", false); err != nil {
			return err
		}
		return optionalString(normalized, "source", "payload.source", false)

	case "effect_expired":
		if err := exactKeys(normalized, "payload", []string{"type", "name"}, nil); err != nil {
			return err
		}
		_, err := requiredString(normalized, "name", "payload.name", false)
		return err

	case "condition_applied":
		if err := exactKeys(normalized, "payload", []string{"type", "condition"}, []string{"source"}); err != nil {
			return err
		}
		if _, err := requiredString(normalized, "condition", "payload.condition", false); err != nil {
			return err
		}
		return optionalString(normalized, "source", "payload.source", false)

	case "condition_immune":
		if err := exactKeys(normalized, "payload", []string{"type", "condition", "sourceEntityIds"}, []string{"source"}); err != nil {
			return err
		}
		if _, err := requiredString(normalized, "condition", "payload.condition", false); err != nil {
			return err
		}
		if err := requiredStringList(normalized, "sourceEntityIds", "payload.sourceEntityIds", false); err != nil {
			return err
		}
		return optionalString(normalized, "source", "payload.source", false)

	case "movement":
		if err := exactKeys(normalized, "payload", []string{"type", "mode", "distanceFt"}, []string{"source"}); err != nil {
			return err
		}
		if _, err := requiredString(normalized, "mode", "payload.mode", false); err != nil {
			return err
		}
		if err := requiredNonNegativeInteger(normalized, "distanceFt", "payload.distanceFt"); err != nil {
			return err
		}
		return optionalString(normalized, "source", "payload.source", false)

	case "turn_started", "turn_ended", "short_rest", "long_rest":
		return exactKeys(normalized, "payload", []string{"type"}, nil)

	case "narrative":
		if err := exactKeys(normalized, "payload", []string{"type", "text"}, []string{"damageAdjustment"}); err != nil {
			return err
		}
		if _, err := requiredString(normalized, "text", "payload.text", true); err != nil {
			return err
		}
		if _, exists := normalized["damageAdjustment"]; !exists {
			return nil
		}
		return validateDamageAdjustment(normalized["damageAdjustment"])

	default:
		return invalidCharacterEvent("payload.type", "is not a supported EngineEvent type")
	}
}

func validateOptionalRollAndSource(payload map[string]any) error {
	if _, exists := payload["roll"]; exists {
		if err := requiredRoll(payload, "roll", "payload.roll"); err != nil {
			return err
		}
	}
	return optionalString(payload, "source", "payload.source", false)
}

func requiredRoll(parent map[string]any, key, path string) error {
	raw, exists := parent[key]
	if !exists {
		return invalidCharacterEvent(path, "is required")
	}
	roll, ok := raw.(map[string]any)
	if !ok || roll == nil {
		return invalidCharacterEvent(path, "must be an object")
	}
	if err := exactKeys(roll, path,
		[]string{"kind", "dice", "advantage", "modifiers", "total", "text"},
		[]string{"target", "outcome", "triggered"}); err != nil {
		return err
	}
	kind, err := requiredString(roll, "kind", path+".kind", false)
	if err != nil {
		return err
	}
	if !oneOf(kind, "d20", "damage", "healing", "check", "save", "other") {
		return invalidCharacterEvent(path+".kind", "is unsupported")
	}
	advantage, err := requiredString(roll, "advantage", path+".advantage", false)
	if err != nil {
		return err
	}
	if !oneOf(advantage, "none", "advantage", "disadvantage") {
		return invalidCharacterEvent(path+".advantage", "is unsupported")
	}
	if err := validateDice(roll["dice"], path+".dice"); err != nil {
		return err
	}
	if err := validateModifiers(roll["modifiers"], path+".modifiers"); err != nil {
		return err
	}
	if err := requiredFiniteNumber(roll, "total", path+".total"); err != nil {
		return err
	}
	if _, err := requiredString(roll, "text", path+".text", true); err != nil {
		return err
	}
	if rawTarget, exists := roll["target"]; exists {
		target, ok := rawTarget.(map[string]any)
		if !ok || target == nil {
			return invalidCharacterEvent(path+".target", "must be an object")
		}
		if err := exactKeys(target, path+".target", []string{"type", "value"}, nil); err != nil {
			return err
		}
		targetType, err := requiredString(target, "type", path+".target.type", false)
		if err != nil {
			return err
		}
		if !oneOf(targetType, "ac", "dc") {
			return invalidCharacterEvent(path+".target.type", "is unsupported")
		}
		if err := requiredFiniteNumber(target, "value", path+".target.value"); err != nil {
			return err
		}
	}
	if rawOutcome, exists := roll["outcome"]; exists {
		outcome, ok := rawOutcome.(string)
		if !ok || !oneOf(outcome, "hit", "miss", "crit", "crit_miss", "success", "fail") {
			return invalidCharacterEvent(path+".outcome", "is unsupported")
		}
	}
	if rawTriggered, exists := roll["triggered"]; exists {
		triggered, ok := rawTriggered.([]any)
		if !ok || len(triggered) > maxCharacterEventListItems {
			return invalidCharacterEvent(path+".triggered", "must be a bounded array of objects")
		}
		for i, item := range triggered {
			if object, ok := item.(map[string]any); !ok || object == nil {
				return invalidCharacterEvent(fmt.Sprintf("%s.triggered[%d]", path, i), "must be an object")
			}
		}
	}
	return nil
}

func validateDice(raw any, path string) error {
	dice, ok := raw.([]any)
	if !ok || len(dice) > maxCharacterEventListItems {
		return invalidCharacterEvent(path, "must be a bounded array")
	}
	for i, rawDie := range dice {
		diePath := fmt.Sprintf("%s[%d]", path, i)
		die, ok := rawDie.(map[string]any)
		if !ok || die == nil {
			return invalidCharacterEvent(diePath, "must be an object")
		}
		if err := exactKeys(die, diePath, []string{"sides", "result"}, []string{"discarded", "source", "sign"}); err != nil {
			return err
		}
		sides, ok := jsonInteger(die["sides"])
		if !ok || sides <= 0 {
			return invalidCharacterEvent(diePath+".sides", "must be a positive safe integer")
		}
		result, ok := jsonInteger(die["result"])
		if !ok || result < 1 || result > sides {
			return invalidCharacterEvent(diePath+".result", "must be an integer between 1 and sides")
		}
		if discarded, exists := die["discarded"]; exists {
			if _, ok := discarded.(bool); !ok {
				return invalidCharacterEvent(diePath+".discarded", "must be a boolean")
			}
		}
		if err := optionalString(die, "source", diePath+".source", false); err != nil {
			return err
		}
		if sign, exists := die["sign"]; exists {
			value, ok := jsonInteger(sign)
			if !ok || (value != -1 && value != 1) {
				return invalidCharacterEvent(diePath+".sign", "must be 1 or -1")
			}
		}
	}
	return nil
}

func validateModifiers(raw any, path string) error {
	modifiers, ok := raw.([]any)
	if !ok || len(modifiers) > maxCharacterEventListItems {
		return invalidCharacterEvent(path, "must be a bounded array")
	}
	for i, rawModifier := range modifiers {
		modifierPath := fmt.Sprintf("%s[%d]", path, i)
		modifier, ok := rawModifier.(map[string]any)
		if !ok || modifier == nil {
			return invalidCharacterEvent(modifierPath, "must be an object")
		}
		if err := exactKeys(modifier, modifierPath, []string{"value", "source"}, []string{"reason"}); err != nil {
			return err
		}
		if err := requiredFiniteNumber(modifier, "value", modifierPath+".value"); err != nil {
			return err
		}
		if _, err := requiredString(modifier, "source", modifierPath+".source", false); err != nil {
			return err
		}
		if err := optionalString(modifier, "reason", modifierPath+".reason", true); err != nil {
			return err
		}
	}
	return nil
}

func validateDamageAdjustment(raw any) error {
	path := "payload.damageAdjustment"
	adjustment, ok := raw.(map[string]any)
	if !ok || adjustment == nil {
		return invalidCharacterEvent(path, "must be an object")
	}
	if err := exactKeys(adjustment, path,
		[]string{"damageType", "adjustment", "before", "after", "sourceEntityIds"}, nil); err != nil {
		return err
	}
	if _, err := requiredString(adjustment, "damageType", path+".damageType", false); err != nil {
		return err
	}
	kind, err := requiredString(adjustment, "adjustment", path+".adjustment", false)
	if err != nil {
		return err
	}
	if !oneOf(kind, "resistance", "immunity", "vulnerability") {
		return invalidCharacterEvent(path+".adjustment", "is unsupported")
	}
	if err := requiredNonNegativeInteger(adjustment, "before", path+".before"); err != nil {
		return err
	}
	if err := requiredNonNegativeInteger(adjustment, "after", path+".after"); err != nil {
		return err
	}
	return requiredStringList(adjustment, "sourceEntityIds", path+".sourceEntityIds", false)
}

func exactKeys(value map[string]any, path string, required, optional []string) error {
	allowed := make(map[string]struct{}, len(required)+len(optional))
	for _, key := range required {
		allowed[key] = struct{}{}
		if _, exists := value[key]; !exists {
			return invalidCharacterEvent(path+"."+key, "is required")
		}
	}
	for _, key := range optional {
		allowed[key] = struct{}{}
	}
	for key := range value {
		if _, exists := allowed[key]; !exists {
			return invalidCharacterEvent(path+"."+key, "is not allowed for this EngineEvent type")
		}
	}
	return nil
}

func requiredString(value map[string]any, key, path string, allowEmpty bool) (string, error) {
	raw, exists := value[key]
	if !exists {
		return "", invalidCharacterEvent(path, "is required")
	}
	text, ok := raw.(string)
	if !ok || len(text) > maxCharacterEventStringBytes || (!allowEmpty && strings.TrimSpace(text) == "") {
		return "", invalidCharacterEvent(path, "must be a bounded string")
	}
	return text, nil
}

func optionalString(value map[string]any, key, path string, allowEmpty bool) error {
	if _, exists := value[key]; !exists {
		return nil
	}
	_, err := requiredString(value, key, path, allowEmpty)
	return err
}

func requiredFiniteNumber(value map[string]any, key, path string) error {
	number, ok := value[key].(float64)
	if !ok || math.IsNaN(number) || math.IsInf(number, 0) || math.Abs(number) > maxSafeJSONInteger {
		return invalidCharacterEvent(path, "must be a finite JSON number")
	}
	return nil
}

func requiredNonNegativeInteger(value map[string]any, key, path string) error {
	number, ok := jsonInteger(value[key])
	if !ok || number < 0 {
		return invalidCharacterEvent(path, "must be a non-negative safe integer")
	}
	return nil
}

func requiredPositiveInteger(value map[string]any, key, path string) error {
	number, ok := jsonInteger(value[key])
	if !ok || number <= 0 {
		return invalidCharacterEvent(path, "must be a positive safe integer")
	}
	return nil
}

func requiredStringList(value map[string]any, key, path string, requireItems bool) error {
	raw, exists := value[key]
	if !exists {
		return invalidCharacterEvent(path, "is required")
	}
	items, ok := raw.([]any)
	if !ok || len(items) > maxCharacterEventListItems || (requireItems && len(items) == 0) {
		return invalidCharacterEvent(path, "must be a bounded string array")
	}
	for i, rawItem := range items {
		item, ok := rawItem.(string)
		if !ok || strings.TrimSpace(item) == "" || len(item) > maxCharacterEventStringBytes {
			return invalidCharacterEvent(fmt.Sprintf("%s[%d]", path, i), "must be a bounded non-empty string")
		}
	}
	return nil
}

func jsonInteger(raw any) (int64, bool) {
	number, ok := raw.(float64)
	if !ok || math.IsNaN(number) || math.IsInf(number, 0) || math.Trunc(number) != number || math.Abs(number) > maxSafeJSONInteger {
		return 0, false
	}
	return int64(number), true
}

func oneOf(value string, allowed ...string) bool {
	for _, candidate := range allowed {
		if value == candidate {
			return true
		}
	}
	return false
}
