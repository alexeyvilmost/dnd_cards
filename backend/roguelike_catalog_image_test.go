package main

import "testing"

func TestNewRoguelikeCatalogSeparatesArtFromMechanics(t *testing.T) {
	for _, kind := range []string{"action", "spell"} {
		catalog := emptyRoguelikeFrozenCatalog()
		row := JSONMap{"id": "test-id", "image_url": "data:image/png;base64,AAAA", "name": "Test", "mechanics": JSONMap{"kind": "test"}}
		if err := catalog.add(kind, row); err != nil {
			t.Fatal(err)
		}
		got := catalog.Entities[kind][0]
		if got["image_url"] != "/api/content-images/"+kind+"s/test-id" {
			t.Fatal(got["image_url"])
		}
		if row["image_url"] != "data:image/png;base64,AAAA" {
			t.Fatal("source changed")
		}
		if got["name"] != "Test" || got["mechanics"] == nil {
			t.Fatal("content lost")
		}
	}
}
