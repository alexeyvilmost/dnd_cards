package roguelikecontent

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

// Deployment builds frontend and backend in separate Docker contexts.
func TestAdmissionPolicyParity(t *testing.T) {
	b, err := os.ReadFile("../../frontend/src/roguelike/data/classes.json")
	if err != nil {
		t.Fatal(err)
	}
	var backend, frontend any
	if err := json.Unmarshal(runClassesJSON, &backend); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(b, &frontend); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(backend, frontend) {
		t.Fatal("Run admission policies differ")
	}
	if len(StartingClassCards()) != 3 {
		t.Fatal("Expected three starting classes")
	}
}
