package main

import (
	"encoding/json"
	"github.com/gin-gonic/gin"
	"net/http"
	"strings"
	"testing"
)

func TestPaperDocumentTrashOwnershipAndRestore(t *testing.T) {
	t.Setenv("JWT_SECRET", characterV3AccessTestSecret)
	f := openCharacterV3AccessFixture(t)
	if err := f.db.AutoMigrate(&paperDocument{}); err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	registerPaperDocumentRoutes(router, f.auth, f.db)
	owner, other := f.token(t, f.owner), f.token(t, f.other)
	doc := map[string]any{"version": 1, "fields": map[string]string{"name": "Удаляемый лист", "hpCurrent": "7"}}
	for _, anonymous := range []bool{false, true} {
		created := performCharacterV3Request(t, router, "POST", "/api/paper-sheets", owner, map[string]any{"document": doc, "anonymous": anonymous})
		var row struct {
			ID string `json:"id"`
		}
		if created.Code != 201 || json.Unmarshal(created.Body.Bytes(), &row) != nil {
			t.Fatal(created.Body.String())
		}
		path := "/api/paper-sheets/" + row.ID
		for _, token := range []string{"", other} {
			want := 404
			if token == "" {
				want = 401
			}
			for _, command := range []struct{ method, path string }{{"DELETE", path}, {"POST", path + "/restore"}} {
				if got := performCharacterV3Request(t, router, command.method, command.path, token, nil); got.Code != want {
					t.Fatalf("foreign mutation: %d %s", got.Code, got.Body.String())
				}
			}
		}
		removed := performCharacterV3Request(t, router, "DELETE", path, owner, nil)
		if anonymous {
			if removed.Code != 404 {
				t.Fatal("anonymous edit link must not grant ownership")
			}
			continue
		}
		if removed.Code != http.StatusNoContent {
			t.Fatal(removed.Body.String())
		}
		for _, command := range []struct {
			method string
			body   any
		}{{"GET", nil}, {"PUT", map[string]any{"document": doc, "revision": 1}}} {
			if got := performCharacterV3Request(t, router, command.method, path, owner, command.body); got.Code != 404 {
				t.Fatalf("deleted sheet accessible: %d", got.Code)
			}
		}
		active := performCharacterV3Request(t, router, "GET", "/api/paper-sheets", owner, nil)
		trash := performCharacterV3Request(t, router, "GET", "/api/paper-sheets?deleted=true", owner, nil)
		foreignTrash := performCharacterV3Request(t, router, "GET", "/api/paper-sheets?deleted=true", other, nil)
		if strings.Contains(active.Body.String(), row.ID) || !strings.Contains(trash.Body.String(), row.ID) || strings.Contains(foreignTrash.Body.String(), row.ID) {
			t.Fatal("trash ownership/list isolation failed")
		}
		if got := performCharacterV3Request(t, router, "POST", path+"/restore", owner, nil); got.Code != 204 {
			t.Fatal(got.Body.String())
		}
		restored := performCharacterV3Request(t, router, "GET", path, owner, nil)
		var saved struct {
			Revision int64          `json:"revision"`
			Document map[string]any `json:"document"`
		}
		if restored.Code != 200 || json.Unmarshal(restored.Body.Bytes(), &saved) != nil || saved.Revision != 3 || saved.Document["fields"].(map[string]any)["hpCurrent"] != "7" {
			t.Fatalf("restore changed data: %s", restored.Body.String())
		}
		if got := performCharacterV3Request(t, router, "PUT", path, owner, map[string]any{"document": doc, "revision": 1}); got.Code != 409 {
			t.Fatal("stale editor must not overwrite restored document")
		}
	}
}

func TestPaperDocumentValidation(t *testing.T) {
	for _, test := range []struct {
		name, raw string
		valid     bool
	}{
		{"minimal", `{"version":1,"fields":{"name":"Герой"}}`, true},
		{"another", `{"version":1,"fields":{"class":"Монах","dex":"16"},"training":{"acrobatics":2},"sections":{"notes":{"text":"Запись","fontSize":12}}}`, true},
		{"missing fields", `{"version":1}`, false},
		{"wrong version", `{"version":2,"fields":{}}`, false},
		{"unsafe types", `{"version":1,"fields":{"name":{"html":"bad"}}}`, false},
		{"invalid training", `{"version":1,"fields":{},"training":{"acrobatics":4}}`, false},
		{"null", `null`, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := validPaperDocument(json.RawMessage(test.raw)); got != test.valid {
				t.Fatalf("valid=%v, want %v", got, test.valid)
			}
		})
	}
}

func TestPaperDocumentOwnershipAndRevision(t *testing.T) {
	t.Setenv("JWT_SECRET", characterV3AccessTestSecret)
	fixture := openCharacterV3AccessFixture(t)
	if err := fixture.db.AutoMigrate(&paperDocument{}); err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	registerPaperDocumentRoutes(router, fixture.auth, fixture.db)
	ownerToken, otherToken := fixture.token(t, fixture.owner), fixture.token(t, fixture.other)
	document := map[string]any{"version": 1, "fields": map[string]string{"name": "Лист проверки"}}
	for _, anonymous := range []bool{false, true} {
		created := performCharacterV3Request(t, router, "POST", "/api/paper-sheets", ownerToken, map[string]any{"document": document, "anonymous": anonymous})
		if created.Code != 201 {
			t.Fatalf("create %d %s", created.Code, created.Body.String())
		}
		var row struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(created.Body.Bytes(), &row); err != nil {
			t.Fatal(err)
		}
		path := "/api/paper-sheets/" + row.ID
		for _, token := range []string{"", otherToken, ownerToken} {
			want := 200
			if !anonymous && token != ownerToken {
				want = 404
			}
			read := performCharacterV3Request(t, router, "GET", path, token, nil)
			if read.Code != want {
				t.Fatalf("read anonymous=%v want %d got%d", anonymous, want, read.Code)
			}
			if read.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("missing no-store")
			}
		}
		denied := performCharacterV3Request(t, router, "PUT", path, otherToken, map[string]any{"document": document, "revision": 1})
		if !anonymous && denied.Code != 404 {
			t.Fatalf("foreign update: %d", denied.Code)
		}
		revision := 1
		if anonymous {
			if denied.Code != 200 {
				t.Fatal(denied.Body.String())
			}
			revision = 2
		}
		changed := performCharacterV3Request(t, router, "PUT", path, ownerToken, map[string]any{"document": document, "revision": revision})
		if changed.Code != 200 {
			t.Fatalf("save: %d %s", changed.Code, changed.Body.String())
		}
		replay := performCharacterV3Request(t, router, "PUT", path, ownerToken, map[string]any{"document": document, "revision": revision})
		if replay.Code != 409 {
			t.Fatalf("replay must conflict, got%d", replay.Code)
		}
	}
	list := performCharacterV3Request(t, router, "GET", "/api/paper-sheets", ownerToken, nil)
	var listing struct {
		Sheets []any `json:"sheets"`
	}
	if err := json.Unmarshal(list.Body.Bytes(), &listing); err != nil {
		t.Fatal(err)
	}
	if list.Code != 200 || len(listing.Sheets) != 1 {
		t.Fatalf("owned list %d %s", list.Code, list.Body.String())
	}
	if result := performCharacterV3Request(t, router, "GET", "/api/paper-sheets", "", nil); result.Code != 401 {
		t.Fatal("anonymous index must not enumerate capability IDs")
	}
}
