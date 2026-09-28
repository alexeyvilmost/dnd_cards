package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"dnd-cards-backend/migrations"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func TestManualContentReviewDoesNotRequireCertificationOrLockMechanics(t *testing.T) {
	for _, status := range []string{"verified", "verified_partial", "not_verified", "not_tested", "narrative", "partial_narrative_verified", "partial_narrative_not_verified"} {
		if !validContentReviewStatuses[status] {
			t.Fatalf("missing manual status %s", status)
		}
	}
	legacy := JSONMap{"status": "verified_mechanical", "mechanics_locked": true}
	if isContentMechanicsLocked(&legacy) || isContentMechanicsLockedValue(legacy) {
		t.Fatal("archived certification still locks mechanics")
	}
	context, _ := gin.CreateTestContext(httptest.NewRecorder())
	if rejectLockedContentMutation(context, &legacy) || rejectLockedMechanicsMutation(context, &legacy, nil, &JSONMap{"effects": "changed"}) {
		t.Fatal("archived certification still rejects ordinary edits")
	}
	retired := httptest.NewRecorder()
	retiredContext, _ := gin.CreateTestContext(retired)
	retiredContentCertification(retiredContext)
	if retired.Code != http.StatusGone {
		t.Fatal("legacy certification can still write live status")
	}
}

func TestManualContentReviewAPIStatusesOwnershipAndPersistence(t *testing.T) {
	t.Setenv("JWT_SECRET", characterV3AccessTestSecret)
	f := openCharacterV3AccessFixture(t)
	t.Setenv("CONTENT_ADMIN_USER_IDS", f.other.ID.String())
	controller := NewContentSupportController(f.db)
	f.router.PATCH("/api/content-review/:entityType/:id", ContentReviewMutation(f.auth, f.db), controller.UpdateReview)
	ids := map[string]string{}
	for kind, table := range contentReviewTables {
		id := uuid.NewString()
		if kind == "passive" {
			id = "test.passive"
			if err := f.db.Exec(`CREATE TABLE passive_presentations (key text PRIMARY KEY, support jsonb)`).Error; err != nil {
				t.Fatal(err)
			}
			if err := f.db.Exec(`INSERT INTO passive_presentations(key) VALUES (?)`, id).Error; err != nil {
				t.Fatal(err)
			}
		} else {
			if err := f.db.Exec(fmt.Sprintf(`CREATE TABLE %s (id uuid PRIMARY KEY, author text, name text, mechanics jsonb, support jsonb, deleted_at timestamptz)`, table)).Error; err != nil {
				t.Fatal(err)
			}
			if err := f.db.Exec("INSERT INTO "+table+"(id,author) VALUES (?,?)", id, f.owner.ID.String()).Error; err != nil {
				t.Fatal(err)
			}
		}
		ids[kind] = id
	}
	sqlDB, err := f.db.DB()
	if err != nil {
		t.Fatal(err)
	}
	for _, migration := range migrations.GetAllMigrations() {
		if migration.Version == "274_manual_content_review" {
			if err := migration.Up(sqlDB); err != nil {
				t.Fatal(err)
			}
		}
	}
	request := func(user *User, kind, id, status string) *httptest.ResponseRecorder {
		t.Helper()
		payload, _ := json.Marshal(map[string]string{"status": status})
		req := httptest.NewRequest(http.MethodPatch, "/api/content-review/"+kind+"/"+id, bytes.NewReader(payload))
		req.Header.Set("Content-Type", "application/json")
		if user != nil {
			token, err := f.auth.generateJWTToken(*user)
			if err != nil {
				t.Fatal(err)
			}
			req.Header.Set("Authorization", "Bearer "+token)
		}
		response := httptest.NewRecorder()
		f.router.ServeHTTP(response, req)
		return response
	}
	for kind, id := range ids {
		// Start with the migration's baseline: an explicit human review must
		// record its actor/time even when the selected status does not change.
		for _, status := range []string{"not_verified", "verified", "verified_partial", "not_tested", "narrative", "partial_narrative_verified", "partial_narrative_not_verified"} {
			result := request(&f.other, kind, id, status)
			if result.Code != http.StatusOK {
				t.Fatalf("%s %s: %d %s", kind, status, result.Code, result.Body.String())
			}
			var body struct {
				EntityID string  `json:"entity_id"`
				Support  JSONMap `json:"support"`
			}
			if err := json.Unmarshal(result.Body.Bytes(), &body); err != nil || body.EntityID != id || body.Support["status"] != status || body.Support["reviewed_by"] != f.other.ID.String() || body.Support["reviewed_at"] == nil {
				t.Fatalf("unexpected persisted review for %s: %s, %v", kind, result.Body.String(), err)
			}
			again := request(&f.other, kind, id, status)
			if again.Code != http.StatusOK || again.Body.String() != result.Body.String() {
				t.Fatalf("repeat review changed saved result: %s / %s", result.Body.String(), again.Body.String())
			}
		}
	}
	for _, check := range []struct {
		user             *User
		kind, id, status string
		code             int
	}{
		{nil, "spell", ids["spell"], "verified", http.StatusUnauthorized},
		{&f.public, "spell", ids["spell"], "verified", http.StatusForbidden},
		{&f.owner, "spell", ids["spell"], "verified", http.StatusOK},
		{&f.owner, "passive", ids["passive"], "verified", http.StatusForbidden},
		{&f.other, "spell", ids["spell"], "verified_mechanical", http.StatusBadRequest},
		{&f.other, "spell", uuid.NewString(), "verified", http.StatusNotFound},
		{&f.other, "unknown", ids["spell"], "verified", http.StatusBadRequest},
	} {
		if got := request(check.user, check.kind, check.id, check.status); got.Code != check.code {
			t.Fatalf("review authorization/validation: got %d %s, want %d", got.Code, got.Body.String(), check.code)
		}
	}
	// The same writer serves unrelated libraries, with DB-authoritative
	// defaults, mechanics invalidation and concurrent review preservation.
	for _, table := range []string{"actions", "spells"} {
		var row struct {
			ID        uuid.UUID `gorm:"type:uuid;primaryKey"`
			Name      string
			Mechanics *JSONMap `gorm:"type:jsonb"`
			Support   *JSONMap `gorm:"type:jsonb"`
		}
		row.ID, row.Name = uuid.New(), "Created"
		if err := contentEntityWrite(f.db.Table(table)).Create(&row).Error; err != nil {
			t.Fatal(err)
		}
		if row.Support == nil || (*row.Support)["status"] != "not_tested" {
			t.Fatalf("%s create did not return database default: %+v", table, row.Support)
		}
		if err := f.db.Table(table).Where("id=?", row.ID).Update("support", JSONMap{"status": "verified"}).Error; err != nil {
			t.Fatal(err)
		}
		row.Name = "Metadata changed with stale support in memory"
		if err := contentEntityWrite(f.db.Table(table)).Save(&row).Error; err != nil {
			t.Fatal(err)
		}
		if row.Support == nil || (*row.Support)["status"] != "verified" {
			t.Fatalf("%s metadata write overwrote a concurrent review: %+v", table, row.Support)
		}
		row.Mechanics = &JSONMap{"effects": []any{map[string]any{"type": "new"}}}
		if err := contentEntityWrite(f.db.Table(table)).Save(&row).Error; err != nil {
			t.Fatal(err)
		}
		if row.Support == nil || (*row.Support)["status"] != "not_verified" {
			t.Fatalf("%s mechanics write returned a stale review: %+v", table, row.Support)
		}
	}
}
