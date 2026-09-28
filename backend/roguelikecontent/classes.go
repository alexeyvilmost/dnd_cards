package roguelikecontent

import (
	_ "embed"
	"encoding/json"
)

//go:embed classes.json
var runClassesJSON []byte

// Shared with frontend eligibility. Admission depends on level, not class.
func StartingLevel() int {
	var policy struct {
		StartingLevel int `json:"starting_level"`
	}
	if err := json.Unmarshal(runClassesJSON, &policy); err != nil {
		panic(err)
	}
	if policy.StartingLevel < 1 {
		panic("invalid roguelike starting level")
	}
	return policy.StartingLevel
}
