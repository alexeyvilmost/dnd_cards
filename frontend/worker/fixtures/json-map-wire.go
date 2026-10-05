// Models the JSONMap Scan -> worker-client json.Marshal transport. This is a
// synthetic contract fixture, not a rules implementation or historical record.
package main

import (
	"encoding/json"
	"io"
	"os"
)

type JSONMap map[string]interface{}

func main() {
	input, err := io.ReadAll(os.Stdin)
	if err != nil { panic(err) }
	var body JSONMap
	if err := json.Unmarshal(input, &body); err != nil { panic(err) }
	output, err := json.Marshal(body)
	if err != nil { panic(err) }
	if _, err := os.Stdout.Write(output); err != nil { panic(err) }
}
