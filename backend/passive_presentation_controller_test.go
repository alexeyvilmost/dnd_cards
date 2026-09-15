package main

import (
	"dnd-cards-backend/passivepresentation"
	"testing"
)

func TestPassivePresentationAdminOnlyVersionedMetadata(t *testing.T) {
	t.Setenv("JWT_SECRET", characterV3AccessTestSecret)
	f := openCharacterV3AccessFixture(t)
	t.Setenv("CONTENT_ADMIN_USER_IDS", f.owner.ID.String())
	if err := f.db.AutoMigrate(&passivepresentation.Presentation{}); err != nil {
		t.Fatal(err)
	}
	row := passivepresentation.Presentation{Key: "unrelated.second-rule", Name: "Original", Version: 1}
	if err := f.db.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	registerPassivePresentationRoutes(f.router.Group("/api"), f.auth, f.db)
	root := "/api/passive-presentations/" + row.Key
	body := map[string]any{"name": "Renamed", "description": "New text", "image_url": "/new.png", "enabled_description": "Yes", "disabled_description": "No", "version": 1}
	for _, test := range []struct {
		token  string
		status int
	}{{"", 401}, {f.token(t, f.other), 403}, {f.token(t, f.owner), 200}, {f.token(t, f.owner), 409}} {
		response := performCharacterV3Request(t, f.router, "PUT", root, test.token, body)
		if response.Code != test.status {
			t.Fatalf("got %d, want %d: %s", response.Code, test.status, response.Body.String())
		}
	}
	body["version"] = 2
	body["mechanics"] = map[string]any{"predicate": "spend_resource"}
	response := performCharacterV3Request(t, f.router, "PUT", root, f.token(t, f.owner), body)
	if response.Code != 400 {
		t.Fatalf("mechanics accepted: %d %s", response.Code, response.Body.String())
	}
	var saved passivepresentation.Presentation
	if err := f.db.First(&saved, "key = ?", row.Key).Error; err != nil {
		t.Fatal(err)
	}
	if saved.Name != "Renamed" || saved.ImageURL != "/new.png" || saved.Version != 2 {
		t.Fatal(saved)
	}
}
