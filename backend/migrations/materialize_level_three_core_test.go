package migrations

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestLevelThreeCoreActionsHaveExplicitTargetingAndCosts(t *testing.T) {
	if len(levelThreeCoreActions) != 4 {
		t.Fatalf("expected four core level-3 actions, got %d", len(levelThreeCoreActions))
	}
	for _, action := range levelThreeCoreActions {
		var mechanics struct {
			Activation struct {
				Mode string `json:"mode"`
				Cost []struct {
					Resource string `json:"resource"`
				} `json:"cost"`
			} `json:"activation"`
			Targeting struct {
				Domain       string `json:"domain"`
				ActorTargets *bool  `json:"actor_targets"`
			} `json:"targeting"`
		}
		if err := json.Unmarshal([]byte(action.mechanics), &mechanics); err != nil {
			t.Fatalf("%s mechanics is not JSON: %v", action.card, err)
		}
		if mechanics.Activation.Mode == "" || mechanics.Activation.Cost == nil {
			t.Errorf("%s has no explicit activation contract", action.card)
		}
		if mechanics.Targeting.Domain == "" || mechanics.Targeting.ActorTargets == nil {
			t.Errorf("%s has no explicit targeting contract", action.card)
		}
	}
}

func TestLevelThreeCoreUsesOnlyLibraryBackedDurableEffects(t *testing.T) {
	for _, action := range levelThreeCoreActions {
		if strings.Contains(action.mechanics, `"kind":"condition"`) {
			t.Fatalf("%s applies an inline condition instead of a library effect", action.card)
		}
	}
	if !strings.Contains(levelThreeCoreActions[2].mechanics, `"value":"EFFECT-paladin-divine-sense"`) {
		t.Fatal("Divine Sense must grant its effects-library row")
	}
	if !strings.Contains(levelThreeCoreActions[3].mechanics, `"value":"EFFECT-rogue-steady-aim-advantage"`) ||
		!strings.Contains(levelThreeCoreActions[3].mechanics, `"value":"EFFECT-rogue-steady-aim-speed"`) {
		t.Fatal("Steady Aim must grant both effects-library rows")
	}
}
