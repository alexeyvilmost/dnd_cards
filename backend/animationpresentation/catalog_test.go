package animationpresentation

import (
	"encoding/json"
	"reflect"
	"strings"
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

func TestReviewedMonsterSpellAndBreathCoverage(t *testing.T) {
	var manifest struct {
		Profiles []struct {
			Key, Primitive string
			CasterCircle   bool
		}
		Bindings         []Binding
		LevelOneCoverage []struct {
			ID         string `json:"id"`
			ProfileKey string `json:"profile_key"`
			Source     string `json:"source"`
		}
		MonsterCoverage []struct {
			Slug    string
			Actions []struct {
				ID         string
				ProfileKey string `json:"profile_key"`
			}
		}
		BreathCoverage []struct {
			ID         string
			ProfileKey string `json:"profile_key"`
		}
	}
	if err := json.Unmarshal(data, &manifest); err != nil {
		t.Fatal(err)
	}
	profiles := map[string]string{}
	spellCircles := map[string]bool{}
	for _, p := range manifest.Profiles {
		profiles[p.Key] = p.Primitive
		spellCircles[p.Key] = p.CasterCircle
	}
	bindings := map[string]string{}
	for _, b := range manifest.Bindings {
		bindings[b.EntityType+":"+b.EntityID] = b.ProfileKey
	}
	local, variants := 0, 0
	for _, s := range manifest.LevelOneCoverage {
		if s.Source == "local" {
			local++
		} else if s.Source == "authored-variant" {
			variants++
		} else {
			t.Fatalf("unknown coverage source: %s", s.Source)
		}
		if bindings["spell:"+s.ID] != s.ProfileKey || !spellCircles[s.ProfileKey] {
			t.Fatalf("missing spell presentation: %+v", s)
		}
	}
	if local != 64 || variants != 23 {
		t.Fatalf("first-level audit changed: %d local, %d variants", local, variants)
	}
	if len(manifest.MonsterCoverage) != 24 {
		t.Fatalf("expected 24 authored monsters, got %d", len(manifest.MonsterCoverage))
	}
	actions := map[string]bool{}
	for _, monster := range manifest.MonsterCoverage {
		if strings.HasPrefix(monster.Slug, "qa-") || strings.HasPrefix(monster.Slug, "audit-") {
			t.Fatalf("private QA fixture in library: %s", monster.Slug)
		}
		if len(monster.Actions) == 0 {
			t.Fatalf("monster has no reviewed actions: %s", monster.Slug)
		}
		for _, a := range monster.Actions {
			if bindings["action:"+a.ID] != a.ProfileKey {
				t.Fatalf("missing monster presentation: %+v", a)
			}
			actions[a.ID] = true
		}
	}
	if len(actions) != 40 {
		t.Fatalf("expected 40 distinct monster actions, got %d", len(actions))
	}
	if len(manifest.BreathCoverage) != 6 {
		t.Fatal("all six breath entities require assignments")
	}
	for _, b := range manifest.BreathCoverage {
		if bindings["action:"+b.ID] != b.ProfileKey || profiles[b.ProfileKey] != "area_cone" || spellCircles[b.ProfileKey] {
			t.Fatalf("invalid breath presentation: %+v", b)
		}
	}
	// Same operations with different entities/palettes must remain independent.
	for _, key := range []string{"spell.frost-ray", "spell.eldritch-blast", "spell.ray-of-sickness", "spell.witch-bolt"} {
		if profiles[key] != "charged_beam" {
			t.Fatalf("missing focused beam for %s", key)
		}
	}
	for key, primitive := range map[string]string{"spell.burning-hands": "area_cone", "spell.thunderwave": "area_wave", "spell.acid-splash": "area_burst", "natural.fire-bite": "bite", "natural.poison-bite": "bite", "weapon.throw-hammer": "weapon_throw", "weapon.throw-spear": "weapon_throw"} {
		if profiles[key] != primitive {
			t.Fatalf("%s: got %s, want %s", key, profiles[key], primitive)
		}
	}
	if bindings["action:b2730000-0000-4000-8000-000000000003"] != "natural.fire-bite" {
		t.Fatal("ash hound needs its authored fire bite")
	}
}

func TestForceAnimationPaletteIsRedAcrossAllPrimitives(t *testing.T) {
	var catalog struct {
		Profiles []struct {
			Key, Primitive, Motif string
			Palette               struct{ Primary, Secondary string }
		}
	}
	if err := json.Unmarshal(data, &catalog); err != nil {
		t.Fatal(err)
	}
	primitives := map[string]bool{}
	for _, profile := range catalog.Profiles {
		if profile.Motif != "force" {
			continue
		}
		if profile.Palette.Primary != "#ef4444" || profile.Palette.Secondary != "#fecaca" {
			t.Fatalf("force animation %s has a non-red palette: %+v", profile.Key, profile.Palette)
		}
		primitives[profile.Primitive] = true
	}
	for _, primitive := range []string{"charged_beam", "projectile", "burst", "ward", "aura"} {
		if !primitives[primitive] {
			t.Fatalf("force coverage missing %s", primitive)
		}
	}
}

func TestCriticalWeaponVariantsRetainEntityPresentation(t *testing.T) {
	var catalog struct {
		Profiles []struct {
			Key, Primitive, Motif, WeaponShape, StrikeStyle, BaseProfileKey, CriticalEffect string
			CasterCircle                                                                    bool
			Palette                                                                         struct{ Primary, Secondary string }
			Motion                                                                          struct {
				DurationMs                       int
				Scale, LaunchRatio, ContactRatio float64
			}
		}
		Defaults struct{ CriticalProfile map[string]string }
	}
	if err := json.Unmarshal(data, &catalog); err != nil {
		t.Fatal(err)
	}
	if len(catalog.Defaults.CriticalProfile) != 45 {
		t.Fatalf("expected 45 reviewed critical variants, got %d", len(catalog.Defaults.CriticalProfile))
	}
	primitives := map[string]bool{}
	magicPrimitives := map[string]bool{}
	weapons, spells := 0, 0
	for baseKey, criticalKey := range catalog.Defaults.CriticalProfile {
		baseIndex, criticalIndex := -1, -1
		for index, profile := range catalog.Profiles {
			if profile.Key == baseKey {
				baseIndex = index
			}
			if profile.Key == criticalKey {
				criticalIndex = index
			}
		}
		if baseIndex < 0 || criticalIndex < 0 {
			t.Fatalf("missing critical relation %s -> %s", baseKey, criticalKey)
		}
		base, critical := catalog.Profiles[baseIndex], catalog.Profiles[criticalIndex]
		if critical.StrikeStyle != "critical" || critical.BaseProfileKey != base.Key || base.StrikeStyle != "" {
			t.Fatalf("invalid critical provenance %s -> %s", baseKey, criticalKey)
		}
		if critical.Primitive != base.Primitive || critical.WeaponShape != base.WeaponShape || critical.Motif != base.Motif || critical.CasterCircle != base.CasterCircle || !reflect.DeepEqual(critical.Palette, base.Palette) {
			t.Fatalf("critical variant changed entity presentation: %s", criticalKey)
		}
		if critical.Motion.DurationMs <= base.Motion.DurationMs || critical.Motion.Scale <= base.Motion.Scale || critical.Motion.LaunchRatio <= 0 || critical.Motion.ContactRatio <= critical.Motion.LaunchRatio || critical.Motion.ContactRatio >= 1 {
			t.Fatalf("invalid critical motion: %s", criticalKey)
		}
		if critical.CriticalEffect == "magic" {
			spells++
			magicPrimitives[critical.Primitive] = true
		} else if critical.CriticalEffect == "" {
			weapons++
			primitives[critical.Primitive] = true
		} else {
			t.Fatalf("unknown critical effect: %s", critical.CriticalEffect)
		}
	}
	if weapons != 16 || spells != 29 {
		t.Fatalf("expected 16 weapon and 29 magic variants, got %d and %d", weapons, spells)
	}
	for _, primitive := range []string{"melee_slash", "melee_pierce", "melee_bash", "ranged_arrow", "weapon_throw", "firearm"} {
		if !primitives[primitive] {
			t.Fatalf("missing weapon critical primitive: %s", primitive)
		}
	}
	for _, primitive := range []string{"charged_beam", "beam", "projectile", "weapon_throw"} {
		if !magicPrimitives[primitive] {
			t.Fatalf("missing spell critical primitive: %s", primitive)
		}
	}
	for _, key := range []string{"spell.burning-hands", "spell.thunderwave", "spell.acid-splash", "natural.bite", "natural.fire-bite"} {
		if catalog.Defaults.CriticalProfile[key] != "" {
			t.Fatalf("area or natural attack %s acquired an unrelated strike variant", key)
		}
	}
}
