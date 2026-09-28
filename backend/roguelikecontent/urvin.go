package roguelikecontent

import _ "embed"

// UrvinDefinition is installed into the mode catalog by the additive migration.
// Each new run freezes the installed definition, rather than reading live rules.
//
//go:embed urvin.json
var UrvinDefinition []byte
