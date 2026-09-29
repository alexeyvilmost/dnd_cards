package animationpresentation

import (
	"encoding/json"
	"testing"
)

func TestAnimationCatalogReferences(t *testing.T) {
	catalog, err := Defaults()
	if err != nil {
		t.Fatal(err)
	}
	keys := map[string]bool{}
	for _, definition := range catalog.Profiles {
		var profile struct {
			Key, Primitive string
			CasterCircle   bool
			Motion         struct {
				DurationMs int
				Scale      float64
			}
			Palette struct{ Primary, Secondary string }
		}
		if err := json.Unmarshal(definition, &profile); err != nil {
			t.Fatal(err)
		}
		if profile.Key == "" || keys[profile.Key] || profile.Primitive == "" || profile.Motion.DurationMs <= 0 || profile.Motion.DurationMs > 5000 || profile.Motion.Scale <= 0 || profile.Palette.Primary == "" || profile.Palette.Secondary == "" {
			t.Fatalf("invalid animation profile: %s", definition)
		}
		keys[profile.Key] = true
	}
	identities := map[string]bool{}
	for _, binding := range catalog.Bindings {
		identity := binding.EntityType + ":" + binding.EntityID
		if binding.EntityID == "" || identities[identity] || !keys[binding.ProfileKey] {
			t.Fatalf("invalid binding: %+v", binding)
		}
		identities[identity] = true
	}
	if len(catalog.Bindings) < 100 {
		t.Fatal("expected base cantrips, authored variants, bites and common actions")
	}
	var groups map[string]map[string]string
	if err := json.Unmarshal(catalog.Defaults, &groups); err != nil {
		t.Fatal(err)
	}
	for _, group := range groups {
		for _, key := range group {
			if !keys[key] {
				t.Fatalf("unknown fallback profile: %s", key)
			}
		}
	}
}
