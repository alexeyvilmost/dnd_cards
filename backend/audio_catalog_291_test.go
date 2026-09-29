package main

import (
	"encoding/json"
	"strings"
	"testing"

	"dnd-cards-backend/audiopresentation"
)

func TestAuthenticatedAudioCatalogReturnsExtendedMusic(t *testing.T) {
	t.Setenv("JWT_SECRET", characterV3AccessTestSecret)
	f := openCharacterV3AccessFixture(t)
	if err := f.db.AutoMigrate(&AudioCue{}, &EntityAudioBinding{}); err != nil {
		t.Fatal(err)
	}
	defaults, err := audiopresentation.Defaults()
	if err != nil {
		t.Fatal(err)
	}
	if defaults.Music == nil {
		t.Fatal("extended music assignments absent from bundled catalog")
	}
	for _, cue := range defaults.Cues {
		if cue.Channel != "music" {
			continue
		}
		cue.Active = true
		if err := f.db.Create(&cue).Error; err != nil {
			t.Fatal(err)
		}
	}
	registerAudioRoutes(f.router.Group("/api"), f.auth, f.db)
	response := performCharacterV3Request(t, f.router, "GET", "/api/audio", f.token(t, f.other), nil)
	if response.Code != 200 {
		t.Fatalf("audio catalog: %d %s", response.Code, response.Body.String())
	}
	var actual struct {
		Version int                          `json:"version"`
		Cues    []audiopresentation.Cue      `json:"cues"`
		Music   *audiopresentation.MusicCues `json:"music"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &actual); err != nil {
		t.Fatal(err)
	}
	if actual.Music == nil {
		t.Fatal("music assignments absent from authenticated response")
	}
	if actual.Version != defaults.Version ||
		actual.Music.Site != defaults.Music.Site || actual.Music.Run != defaults.Music.Run ||
		len(actual.Music.Battles) != 15 || len(actual.Cues) != 17 {
		t.Fatalf("incorrect music catalog: version=%d maps=%d cues=%d", actual.Version, len(actual.Music.Battles), len(actual.Cues))
	}
	returned := make(map[string]audiopresentation.Cue, len(actual.Cues))
	for _, cue := range actual.Cues {
		if cue.Channel != "music" || cue.Version != 3 || !cue.Loop || !strings.HasPrefix(cue.URL, "/audio/music-v3/") {
			t.Fatalf("unexpected extended music cue: %+v", cue)
		}
		returned[cue.Key] = cue
	}
	for _, key := range append([]string{actual.Music.Site, actual.Music.Run}, musicCueKeys(actual.Music.Battles)...) {
		if _, ok := returned[key]; !ok {
			t.Fatalf("assigned music cue absent from response: %s", key)
		}
	}
	if cue := returned["music.battle.tavern-v2"]; cue.URL != "/audio/music-v3/music_battle_tavern-v2.e188bb9cde22.mp3" {
		t.Fatalf("final tavern composition absent: %q", cue.URL)
	}
}

func musicCueKeys(battles map[string]string) []string {
	keys := make([]string, 0, len(battles))
	for _, key := range battles {
		keys = append(keys, key)
	}
	return keys
}
