package main

import (
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func TestListProjectionAndContentImageRouteShareAvailabilityContract(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := openCatalogPaginationTestDB(t)
	if err := db.Exec(`
		CREATE TABLE spells (
			id uuid PRIMARY KEY,
			image_url text,
			image_cloudinary_url text,
			deleted_at timestamptz
		)
	`).Error; err != nil {
		t.Fatal(err)
	}
	blankID := uuid.New()
	whitespaceID := uuid.New()
	embeddedID := uuid.New()
	invalidID := uuid.New()
	insecureCloudID := uuid.New()
	insecureCloudWithFallbackID := uuid.New()
	png := []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a}
	embedded := "data:image/png;base64," + base64.StdEncoding.EncodeToString(png)
	for _, row := range []struct {
		id, image string
	}{
		{id: blankID.String(), image: ""},
		{id: whitespaceID.String(), image: "  \t\n"},
		{id: embeddedID.String(), image: embedded},
		{id: invalidID.String(), image: "not-an-image"},
	} {
		if err := db.Exec(
			"INSERT INTO spells (id, image_url, image_cloudinary_url) VALUES (?, ?, '')",
			row.id, row.image,
		).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Exec(
		"INSERT INTO spells (id, image_url, image_cloudinary_url) VALUES (?, '', ?)",
		insecureCloudID, "http://images.example.test/insecure.png",
	).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(
		"INSERT INTO spells (id, image_url, image_cloudinary_url) VALUES (?, ?, ?)",
		insecureCloudWithFallbackID, embedded, "http://images.example.test/insecure.png",
	).Error; err != nil {
		t.Fatal(err)
	}

	present, err := listLegacyImageIDs(db, "spells", []uuid.UUID{
		blankID,
		whitespaceID,
		embeddedID,
		invalidID,
		insecureCloudID,
		insecureCloudWithFallbackID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if projected := listImageURL("spells", blankID, "", present[blankID]); projected != "" {
		t.Fatalf("blank list row advertised a known-broken image route: %q", projected)
	}
	if projected := listImageURL("spells", whitespaceID, "", present[whitespaceID]); projected != "" {
		t.Fatalf("whitespace-only list row advertised a known-broken image route: %q", projected)
	}
	if projected := listImageURL("spells", invalidID, "", present[invalidID]); projected != "" {
		t.Fatalf("malformed legacy source was advertised by the list projection: %q", projected)
	}
	embeddedRoute := listImageURL("spells", embeddedID, "", present[embeddedID])
	if embeddedRoute == "" {
		t.Fatal("stored embedded image was omitted from the list projection")
	}
	if projected := listImageURL("spells", insecureCloudID, "http://images.example.test/insecure.png", present[insecureCloudID]); projected != "" {
		t.Fatalf("insecure cloud URL leaked into the HTTPS catalog projection: %q", projected)
	}
	fallbackRoute := listImageURL(
		"spells",
		insecureCloudWithFallbackID,
		"http://images.example.test/insecure.png",
		present[insecureCloudWithFallbackID],
	)
	if fallbackRoute == "" {
		t.Fatal("safe legacy fallback was omitted when the cloud URL was insecure")
	}

	router := gin.New()
	router.GET("/api/content-images/:entityType/:id", NewContentImageController(db).Get)
	request := func(path string) *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
		return recorder
	}
	if response := request(embeddedRoute); response.Code != http.StatusOK || response.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("embedded route status=%d type=%q body=%v", response.Code, response.Header().Get("Content-Type"), response.Body.Bytes())
	}
	if response := request(fallbackRoute); response.Code != http.StatusOK || response.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("fallback route status=%d type=%q body=%v", response.Code, response.Header().Get("Content-Type"), response.Body.Bytes())
	}
	resource := ResourceDefinition{ResourceID: "image-route-test", Name: "Image route", ImageURL: embedded}
	if err := db.Create(&resource).Error; err != nil {
		t.Fatal(err)
	}
	if response := request("/api/content-images/resources/" + resource.ID.String()); response.Code != http.StatusOK || response.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("resource image route status=%d type=%q body=%v", response.Code, response.Header().Get("Content-Type"), response.Body.Bytes())
	}
	if response := request("/api/content-images/spells/" + blankID.String()); response.Code != http.StatusNotFound {
		t.Fatalf("blank image route status=%d want=404", response.Code)
	}
	if response := request("/api/content-images/spells/" + whitespaceID.String()); response.Code != http.StatusNotFound {
		t.Fatalf("whitespace-only image route status=%d want=404", response.Code)
	}
	if response := request("/api/content-images/spells/" + invalidID.String()); response.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("invalid MIME route status=%d want=415", response.Code)
	}
}
