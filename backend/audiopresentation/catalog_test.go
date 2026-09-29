package audiopresentation

import (
	"encoding/json"
	"strings"
	"testing"

	"dnd-cards-backend/animationpresentation"
)

func TestApprovedCatalogHasSeventyEffectsAndValidAnimationProfiles(t *testing.T) {
	catalog, err := Defaults()
	if err != nil {
		t.Fatal(err)
	}
	effects := 0
	for _, cue := range catalog.Cues {
		if cue.Channel == "effects" {
			effects++
			if cue.Loop || !strings.HasPrefix(cue.URL, "/audio/combat-v2/") || !strings.HasSuffix(cue.URL, ".mp3") {
				t.Fatalf("invalid approved effect %s", cue.Key)
			}
		}
		if cue.Channel == "ui" || strings.Contains(cue.URL, "roguelike-v1") {
			t.Fatalf("legacy procedural sound leaked into approved catalog: %s", cue.Key)
		}
	}
	if effects != 70 {
		t.Fatalf("want 70 approved effects, got %d", effects)
	}
	animations, err := animationpresentation.Defaults()
	if err != nil {
		t.Fatal(err)
	}
	knownProfiles := map[string]bool{}
	for _, raw := range animations.Profiles {
		var identity struct{ Key string }
		if err := json.Unmarshal(raw, &identity); err != nil {
			t.Fatal(err)
		}
		knownProfiles[identity.Key] = true
	}
	for key := range catalog.Profiles {
		if !knownProfiles[key] {
			t.Fatalf("sound profile references unknown animation profile %q", key)
		}
	}
	if len(catalog.Profiles) < 2 {
		t.Fatal("expected different authored animation sound profiles")
	}
}

func TestCatalogValidationSupportsDifferentEntitiesAndPhases(t *testing.T) {
	catalog := Catalog{
		Version: 2,
		Cues: []Cue{
			{Key: "one", Name: "First", Channel: "effects", URL: "/one.mp3", License: "Owned", Version: 2, Gain: 0.7},
			{Key: "two", Name: "Different", Channel: "effects", URL: "/two.mp3", License: "Owned", Version: 2, Gain: 0.5},
		},
		Bindings: []Binding{{EntityType: "action", EntityID: "first-entity", Event: "launch", CueKey: "one"}, {EntityType: "spell", EntityID: "second-entity", Event: "charge", CueKey: "two"}},
		Profiles: map[string]map[string]string{"arbitrary-first": {"launch": "one"}, "unrelated-second": {"charge": "two", "miss": "one"}},
		Defaults: DefaultCues{DiceSingle: "one", DiceRoll: "two"},
	}
	if err := catalog.Validate(); err != nil {
		t.Fatal(err)
	}
	catalog.Bindings[1].CueKey = "missing"
	if catalog.Validate() == nil {
		t.Fatal("accepted unknown cue on second entity")
	}
	catalog.Bindings[1].CueKey = "two"
	catalog.Bindings[1].Event = "spend_resource"
	if catalog.Validate() == nil {
		t.Fatal("accepted mechanics as presentation phase")
	}
}

func TestMusicAssignmentsRequireMusicCues(t *testing.T) {
	catalog, err := Defaults()
	if err != nil {
		t.Fatal(err)
	}
	catalog.Music = &MusicCues{Site: catalog.Defaults.DiceRoll}
	if catalog.Validate() == nil {
		t.Fatal("accepted dice effect as site music")
	}
}
