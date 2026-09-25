package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func TestContentEntityMutationChecksOwnerAndStampsCreates(t *testing.T) {
	t.Setenv("JWT_SECRET", "content-owner-test-secret-at-least-32-bytes")
	f := openCharacterV3AccessFixture(t)
	t.Setenv("CONTENT_ADMIN_USER_IDS", f.other.ID.String())
	for _, table := range []string{"cards", "spells", "actions"} {
		if err := f.db.Exec("CREATE TABLE " + table + " (id uuid PRIMARY KEY, author varchar(255), deleted_at timestamptz)").Error; err != nil {
			t.Fatal(err)
		}
	}
	ownedID, foreignID, deletedID := uuid.New(), uuid.New(), uuid.New()
	for _, row := range []struct {
		id      uuid.UUID
		author  string
		deleted bool
	}{
		{ownedID, f.owner.ID.String(), false},
		{foreignID, f.public.ID.String(), false},
		{deletedID, f.owner.ID.String(), true},
	} {
		if row.deleted {
			if err := f.db.Exec("INSERT INTO cards(id, author, deleted_at) VALUES (?, ?, now())", row.id, row.author).Error; err != nil {
				t.Fatal(err)
			}
		} else if err := f.db.Exec("INSERT INTO cards(id, author) VALUES (?, ?)", row.id, row.author).Error; err != nil {
			t.Fatal(err)
		}
	}
	router := gin.New()
	for _, route := range []struct {
		method, path, table string
		create              bool
	}{
		{http.MethodPost, "/cards", "cards", true},
		{http.MethodPost, "/spells", "spells", true},
		{http.MethodPost, "/actions", "actions", true},
		{http.MethodPut, "/cards/:id", "cards", false},
		{http.MethodDelete, "/cards/:id", "cards", false},
	} {
		router.Handle(route.method, route.path, ContentEntityMutation(f.auth, f.db, route.table, route.create), func(c *gin.Context) {
			var body map[string]any
			if c.Request.Method != http.MethodDelete {
				_ = c.ShouldBindJSON(&body)
			}
			c.JSON(http.StatusOK, gin.H{"author": contentEntityAuthor(c, "spoofed"), "body": body})
		})
	}
	router.POST("/images/upload", StrictAuthMiddleware(f.auth), ContentEntityImageMutation(f.db), func(c *gin.Context) { c.Status(http.StatusNoContent) })
	router.DELETE("/images/:entity_type/:entity_id", StrictAuthMiddleware(f.auth), ContentEntityImageMutation(f.db), func(c *gin.Context) { c.Status(http.StatusNoContent) })
	request := func(user User, method, path string) *httptest.ResponseRecorder {
		t.Helper()
		token, err := f.auth.generateJWTToken(user)
		if err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest(method, path, bytes.NewBufferString(`{"name":"test","author":"spoofed"}`))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		router.ServeHTTP(response, req)
		return response
	}
	for _, path := range []string{"/cards", "/spells"} {
		response := request(f.owner, http.MethodPost, path)
		if response.Code != http.StatusOK {
			t.Fatalf("owner create %s: %d %s", path, response.Code, response.Body.String())
		}
		var result struct {
			Author string         `json:"author"`
			Body   map[string]any `json:"body"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if result.Author != f.owner.ID.String() || result.Body["author"] != nil {
			t.Fatalf("author spoof survived: %+v", result)
		}
	}
	if got := request(f.owner, http.MethodPost, "/actions").Code; got != http.StatusForbidden {
		t.Fatalf("ordinary action create: %d", got)
	}
	if got := request(f.owner, http.MethodPut, "/cards/"+ownedID.String()).Code; got != http.StatusOK {
		t.Fatalf("owner edit: %d", got)
	}
	if got := request(f.owner, http.MethodPut, "/cards/"+foreignID.String()).Code; got != http.StatusForbidden {
		t.Fatalf("foreign edit: %d", got)
	}
	if got := request(f.owner, http.MethodDelete, "/cards/"+foreignID.String()).Code; got != http.StatusForbidden {
		t.Fatalf("foreign delete: %d", got)
	}
	if got := request(f.owner, http.MethodPut, "/cards/"+deletedID.String()).Code; got != http.StatusForbidden {
		t.Fatalf("deleted edit: %d", got)
	}
	if got := request(f.other, http.MethodPut, "/cards/"+foreignID.String()).Code; got != http.StatusOK {
		t.Fatalf("admin edit: %d", got)
	}
	if got := request(f.other, http.MethodPost, "/actions").Code; got != http.StatusOK {
		t.Fatalf("admin action create: %d", got)
	}
	imageRequest := func(user User, kind string, id uuid.UUID) int {
		t.Helper()
		token, err := f.auth.generateJWTToken(user)
		if err != nil {
			t.Fatal(err)
		}
		form := url.Values{"entity_type": {kind}, "entity_id": {id.String()}}
		req := httptest.NewRequest(http.MethodPost, "/images/upload", bytes.NewBufferString(form.Encode()))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		response := httptest.NewRecorder()
		router.ServeHTTP(response, req)
		return response.Code
	}
	if got := imageRequest(f.owner, "card", ownedID); got != http.StatusNoContent {
		t.Fatalf("owned image: %d", got)
	}
	if got := imageRequest(f.owner, "card", foreignID); got != http.StatusForbidden {
		t.Fatalf("foreign image: %d", got)
	}
	if got := imageRequest(f.owner, "action", ownedID); got != http.StatusForbidden {
		t.Fatalf("other image type: %d", got)
	}
	if got := imageRequest(f.other, "action", ownedID); got != http.StatusNoContent {
		t.Fatalf("admin image: %d", got)
	}
}
