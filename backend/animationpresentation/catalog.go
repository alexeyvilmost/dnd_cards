// Package animationpresentation owns presentation-only entity assignments.
// Its catalog is also imported by the client as the offline fallback.
package animationpresentation

import (
	_ "embed"
	"encoding/json"
)

//go:embed catalog.json
var data []byte

type Profile struct {
	Key        string          `json:"key" gorm:"primaryKey"`
	Definition json.RawMessage `json:"definition" gorm:"type:jsonb"`
}

func (Profile) TableName() string { return "animation_profiles" }

type Binding struct {
	EntityType string `json:"entity_type" gorm:"primaryKey"`
	EntityID   string `json:"entity_id" gorm:"primaryKey"`
	ProfileKey string `json:"profile_key"`
}

func (Binding) TableName() string { return "entity_animation_bindings" }

type Catalog struct {
	Version  int               `json:"version"`
	Profiles []json.RawMessage `json:"profiles"`
	Bindings []Binding         `json:"bindings"`
	Defaults json.RawMessage   `json:"defaults"`
}

func Defaults() (Catalog, error) {
	var catalog Catalog
	err := json.Unmarshal(data, &catalog)
	return catalog, err
}
