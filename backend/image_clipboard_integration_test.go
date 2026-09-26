package main

import (
	"bytes"
	"errors"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func TestDetailClipboardImagesPersistForEveryExistingImageEditor(t *testing.T) {
	f := openCharacterV3AccessFixture(t)
	if err := f.db.AutoMigrate(&Spell{}, &Action{}, &Effect{}, &Feat{}); err != nil {
		t.Fatal(err)
	}
	rows := []struct {
		kind, table string
		model       any
	}{
		{"spell", "spells", &Spell{ID: uuid.New(), Name: "Test spell", Description: "Test", Rarity: Rarity("common"), CardNumber: "clip-spell", Author: f.other.ID.String()}},
		{"action", "actions", &Action{ID: uuid.New(), Name: "Test action", Description: "Test", Rarity: Rarity("common"), CardNumber: "clip-action", ActionType: ActionType("action"), Author: f.other.ID.String()}},
		{"effect", "effects", &Effect{ID: uuid.New(), Name: "Test effect", Description: "Test", Rarity: Rarity("common"), CardNumber: "clip-effect", EffectType: EffectType("passive"), Author: f.other.ID.String()}},
		{"feat", "feats", &Feat{ID: uuid.New(), Name: "Test feat", Description: "Test", Rarity: Rarity("common"), CardNumber: "clip-feat", Author: f.other.ID.String()}},
	}
	imageController := NewImageController(f.db, nil, nil)
	for _, row := range rows {
		if err := f.db.Create(row.model).Error; err != nil {
			t.Fatalf("create %s: %v", row.kind, err)
		}
		var id uuid.UUID
		switch model := row.model.(type) {
		case *Spell:
			id = model.ID
		case *Action:
			id = model.ID
		case *Effect:
			id = model.ID
		case *Feat:
			id = model.ID
		}
		url := fmt.Sprintf("https://example.test/%s.png", row.kind)
		if err := imageController.updateEntityImage(row.kind, id.String(), url, "clipboard/"+row.kind, false, ""); err != nil {
			t.Fatalf("save %s image: %v", row.kind, err)
		}
		var stored struct{ ImageURL, ImageCloudinaryID string }
		if err := f.db.Table(row.table).Select("image_url, image_cloudinary_id").Where("id = ?", id).Take(&stored).Error; err != nil {
			t.Fatal(err)
		}
		if stored.ImageURL != url || stored.ImageCloudinaryID != "clipboard/"+row.kind {
			t.Fatalf("%s image not persisted: %+v", row.kind, stored)
		}
		info, err := imageController.getEntityInfo(row.kind, id.String())
		if err != nil || info["name"] == "" {
			t.Fatalf("%s image library info: %v %+v", row.kind, err, info)
		}
	}
	if err := imageController.updateEntityImage("spell", uuid.NewString(), "url", "id", false, ""); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("missing spell: %v", err)
	}
}

func TestDetailClipboardImageUploadRetainsEntityOwnerPermissions(t *testing.T) {
	t.Setenv("JWT_SECRET", characterV3AccessTestSecret)
	t.Setenv("CONTENT_ADMIN_USER_IDS", "")
	f := openCharacterV3AccessFixture(t)
	if err := f.db.AutoMigrate(&Spell{}, &Action{}); err != nil {
		t.Fatal(err)
	}
	spell := Spell{ID: uuid.New(), Name: "Owned spell", Description: "Test", Rarity: Rarity("common"), CardNumber: "owned-clip-spell", Author: f.other.ID.String()}
	action := Action{ID: uuid.New(), Name: "Owned action", Description: "Test", Rarity: Rarity("common"), CardNumber: "owned-clip-action", ActionType: ActionType("action"), Author: f.other.ID.String()}
	if err := f.db.Create(&spell).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.db.Create(&action).Error; err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	router.POST("/upload", StrictAuthMiddleware(f.auth), ContentEntityImageMutation(f.db), func(c *gin.Context) { c.Status(http.StatusNoContent) })
	request := func(kind, id, token string) int {
		t.Helper()
		var body bytes.Buffer
		form := multipart.NewWriter(&body)
		_ = form.WriteField("entity_type", kind)
		_ = form.WriteField("entity_id", id)
		_ = form.Close()
		req := httptest.NewRequest(http.MethodPost, "/upload", &body)
		req.Header.Set("Content-Type", form.FormDataContentType())
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		response := httptest.NewRecorder()
		router.ServeHTTP(response, req)
		return response.Code
	}
	if got := request("spell", spell.ID.String(), ""); got != http.StatusUnauthorized {
		t.Fatalf("anonymous upload: %d", got)
	}
	if got := request("spell", spell.ID.String(), f.token(t, f.owner)); got != http.StatusForbidden {
		t.Fatalf("another user upload: %d", got)
	}
	if got := request("spell", spell.ID.String(), f.token(t, f.other)); got != http.StatusNoContent {
		t.Fatalf("owned spell upload: %d", got)
	}
	if got := request("action", action.ID.String(), f.token(t, f.other)); got != http.StatusForbidden {
		t.Fatalf("non-admin action upload: %d", got)
	}
	t.Setenv("CONTENT_ADMIN_USER_IDS", f.owner.ID.String())
	if got := request("action", action.ID.String(), f.token(t, f.owner)); got != http.StatusNoContent {
		t.Fatalf("administrator action upload: %d", got)
	}
}
