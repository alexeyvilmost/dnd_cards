package passivepresentation

import (
	_ "embed"
	"encoding/json"
)

//go:embed catalog.json
var data []byte

type Presentation struct {
	Key                 string `json:"key" gorm:"primaryKey"`
	Name                string `json:"name"`
	Description         string `json:"description"`
	ImageURL            string `json:"image_url"`
	EnabledDescription  string `json:"enabled_description"`
	DisabledDescription string `json:"disabled_description"`
	Version             int    `json:"version"`
}

func (Presentation) TableName() string { return "passive_presentations" }
func Defaults() ([]Presentation, error) {
	var rows []Presentation
	err := json.Unmarshal(data, &rows)
	return rows, err
}
