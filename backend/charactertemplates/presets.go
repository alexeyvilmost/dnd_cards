package charactertemplates

import (
	_ "embed"
	"encoding/json"
)

//go:embed presets.json
var presetsJSON []byte

type Preset struct {
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	Description string          `json:"description"`
	PresetKey   string          `json:"preset_key"`
	Character   json.RawMessage `json:"character"`
}

func Presets() ([]Preset, error) {
	var rows []Preset
	err := json.Unmarshal(presetsJSON, &rows)
	return rows, err
}
