package roguelikecontent

import (
	_ "embed"
	"encoding/json"
)

//go:embed classes.json
var runClassesJSON []byte

// Shared with frontend eligibility. This is mode admission, not class mechanics.
func StartingClassCards() []string {
	var policy struct {
		ClassCards []string `json:"class_cards"`
	}
	if err := json.Unmarshal(runClassesJSON, &policy); err != nil {
		panic(err)
	}
	return policy.ClassCards
}
