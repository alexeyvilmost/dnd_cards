package migrations

import (
	"encoding/json"
	"net/url"
	"strings"
	"testing"
)

func TestAudio260SeedUsesPublicStorageAndOriginalRecordings(t *testing.T) {
	var rows []struct {
		Key, Channel, URL, License string
		Gain                       float64
		Loop                       bool
	}
	if err := json.Unmarshal(audio260Seed, &rows); err != nil {
		t.Fatal(err)
	}
	if len(rows) != 34 {
		t.Fatalf("want 34 audio cues, got %d", len(rows))
	}
	seen := map[string]bool{}
	music := 0
	for _, row := range rows {
		u, err := url.Parse(row.URL)
		if err != nil || u.Scheme != "https" || u.Host != "storage.yandexcloud.net" || !strings.HasPrefix(u.Path, "/dnd-cards-images/audio/roguelike-v1/") {
			t.Fatalf("invalid public URL for %s", row.Key)
		}
		if seen[row.Key] || row.Key == "" || row.Gain <= 0 || row.Gain > 1 || !strings.Contains(row.License, "Original synthesized audio") {
			t.Fatalf("invalid or duplicate cue: %s", row.Key)
		}
		seen[row.Key] = true
		if row.Channel == "music" {
			music++
			if !row.Loop {
				t.Fatal("music must loop")
			}
		} else if row.Loop {
			t.Fatal("effects must not loop")
		}
	}
	if music != 3 {
		t.Fatal(music)
	}
}
