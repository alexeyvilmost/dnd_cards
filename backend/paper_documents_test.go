package main

import (
	"encoding/json"
	"github.com/gin-gonic/gin"
	"testing"
)

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
