package migrations

import (
	"encoding/json"
	"testing"
)

func TestLevelTwoActorActionsDeclareActorTargets(t *testing.T) {
	for _, action := range levelTwoActions {
		var mechanics struct {
			Targeting struct {
				Domain       string `json:"domain"`
				ActorTargets *bool  `json:"actor_targets"`
			} `json:"targeting"`
		}
		if err := json.Unmarshal([]byte(action.mechanics), &mechanics); err != nil {
			t.Fatalf("%s mechanics is not JSON: %v", action.card, err)
		}
		if mechanics.Targeting.Domain == "actor" && mechanics.Targeting.ActorTargets == nil {
			t.Errorf("%s actor targeting must declare actor_targets", action.card)
		}
	}
}
