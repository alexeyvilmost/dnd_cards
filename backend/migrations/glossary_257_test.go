package migrations

import (
	"encoding/json"
	"regexp"
	"strings"
	"testing"
)

func TestGlossary257ConceptsAndReferences(t *testing.T) {
	var concepts []glossaryConcept257
	if err := json.Unmarshal(glossary257JSON, &concepts); err != nil {
		t.Fatal(err)
	}
	if len(concepts) != 154 {
		t.Fatalf("got %d glossary concepts, want 154", len(concepts))
	}
	ids := make(map[string]bool, len(concepts))
	links := regexp.MustCompile(`\[\[[^\]|]+\|concept:([a-z0-9_]+)\]\]`)
	for index, concept := range concepts {
		if concept.ConceptID == "" || concept.Name == "" || concept.NameEn == "" || concept.Description == "" {
			t.Fatalf("incomplete concept at %d: %#v", index, concept)
		}
		if ids[concept.ConceptID] {
			t.Fatalf("duplicate concept ID %q", concept.ConceptID)
		}
		ids[concept.ConceptID] = true
		if strings.Contains(concept.Description, "<table") || strings.Contains(concept.Description, "КЗ") {
			t.Fatalf("unconverted table or terminology in %q", concept.ConceptID)
		}
	}
	count := 0
	for _, concept := range concepts {
		for _, match := range links.FindAllStringSubmatch(concept.Description, -1) {
			count++
			if !ids[match[1]] {
				t.Fatalf("%s links to absent concept %s", concept.ConceptID, match[1])
			}
		}
	}
	if count < 300 {
		t.Fatalf("only %d cross references", count)
	}
	for _, id := range []string{"saving_throw", "charmed", "disadvantage", "adventure", "encounter", "armor_class"} {
		if !ids[id] {
			t.Errorf("missing concept %s", id)
		}
	}
}
