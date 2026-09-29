// Package audiopresentation owns presentation-only sound cues and assignments.
// The same catalog is imported by the client as its offline fallback.
package audiopresentation

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"math"
)

//go:embed catalog.json
var data []byte

type Cue struct {
	Key     string  `json:"key" gorm:"primaryKey"`
	Name    string  `json:"name"`
	Channel string  `json:"channel"`
	URL     string  `json:"url"`
	Gain    float64 `json:"gain"`
	Loop    bool    `json:"loop"`
	License string  `json:"license"`
	Version int     `json:"version"`
	Active  bool    `json:"-" gorm:"not null;default:true"`
}

func (Cue) TableName() string { return "audio_cues" }

type Binding struct {
	EntityType string `json:"entity_type" gorm:"primaryKey"`
	EntityID   string `json:"entity_id" gorm:"primaryKey"`
	Event      string `json:"event" gorm:"primaryKey"`
	CueKey     string `json:"cue_key"`
}

func (Binding) TableName() string { return "entity_audio_bindings" }

type DefaultCues struct {
	DiceSingle string `json:"diceSingle"`
	DiceRoll   string `json:"diceRoll"`
}

type MusicCues struct {
	Site    string            `json:"site,omitempty"`
	Run     string            `json:"run,omitempty"`
	Battles map[string]string `json:"battles,omitempty"`
}

type Catalog struct {
	Version  int                          `json:"version"`
	Cues     []Cue                        `json:"cues"`
	Bindings []Binding                    `json:"bindings"`
	Profiles map[string]map[string]string `json:"profiles"`
	Defaults DefaultCues                  `json:"defaults"`
	Music    *MusicCues                   `json:"music,omitempty"`
}

// ValidEvent enumerates presentation phases, never gameplay commands.
func ValidEvent(event string) bool {
	switch event {
	case "cast", "charge", "launch", "hit", "miss", "healing", "activate":
		return true
	}
	return false
}

func Defaults() (Catalog, error) { return Decode(data) }

func Decode(source []byte) (Catalog, error) {
	var catalog Catalog
	if err := json.Unmarshal(source, &catalog); err != nil {
		return catalog, err
	}
	if err := catalog.Validate(); err != nil {
		return catalog, err
	}
	return catalog, nil
}

func (catalog Catalog) Validate() error {
	if catalog.Version < 1 || len(catalog.Cues) == 0 {
		return fmt.Errorf("audio catalog must have a version and cues")
	}
	cues := make(map[string]bool, len(catalog.Cues))
	for _, cue := range catalog.Cues {
		if cue.Key == "" || cues[cue.Key] || cue.Name == "" || cue.URL == "" || cue.License == "" || cue.Version < 1 || math.IsNaN(cue.Gain) || cue.Gain < 0 || cue.Gain > 1 {
			return fmt.Errorf("invalid audio cue %q", cue.Key)
		}
		if cue.Channel != "effects" && cue.Channel != "ui" && cue.Channel != "music" {
			return fmt.Errorf("invalid audio channel for %q", cue.Key)
		}
		cues[cue.Key] = true
	}
	for _, key := range []string{catalog.Defaults.DiceSingle, catalog.Defaults.DiceRoll} {
		if !cues[key] {
			return fmt.Errorf("unknown default audio cue %q", key)
		}
	}
	seenBindings := map[string]bool{}
	for _, binding := range catalog.Bindings {
		identity := binding.EntityType + "\x00" + binding.EntityID + "\x00" + binding.Event
		if binding.EntityType == "" || binding.EntityID == "" || !ValidEvent(binding.Event) || !cues[binding.CueKey] || seenBindings[identity] {
			return fmt.Errorf("invalid audio assignment %q", identity)
		}
		seenBindings[identity] = true
	}
	for profile, events := range catalog.Profiles {
		if profile == "" {
			return fmt.Errorf("empty audio profile")
		}
		for event, key := range events {
			if !ValidEvent(event) || !cues[key] {
				return fmt.Errorf("invalid audio profile phase %q/%q", profile, event)
			}
		}
	}
	if catalog.Music != nil {
		musicKeys := []string{catalog.Music.Site, catalog.Music.Run}
		for mapID, key := range catalog.Music.Battles {
			if mapID == "" || key == "" {
				return fmt.Errorf("empty battle music assignment")
			}
			musicKeys = append(musicKeys, key)
		}
		for _, key := range musicKeys {
			if key == "" {
				continue
			}
			found := false
			for _, cue := range catalog.Cues {
				if cue.Key == key && cue.Channel == "music" {
					found = true
				}
			}
			if !found {
				return fmt.Errorf("unknown music cue %q", key)
			}
		}
	}
	return nil
}
