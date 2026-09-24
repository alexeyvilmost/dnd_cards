package main

import (
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func TestBulkEntityTagsValidation(t *testing.T) {
	id, tag := uuid.NewString(), uuid.NewString()
	req := bulkEntityTagsRequest{"card", []string{id, id}, []string{tag, tag}, "add"}
	if err := req.normalize(); err != nil || len(req.EntityIDs) != 1 || len(req.TagIDs) != 1 {
		t.Fatalf("deduplicate: %+v %v", req, err)
	}
	for _, bad := range []bulkEntityTagsRequest{
		{"cards; DROP TABLE cards", []string{id}, []string{tag}, "add"},
		{"card", []string{id}, []string{tag}, "replace"},
		{"card", []string{}, []string{tag}, "add"},
		{"card", make([]string, 501), []string{tag}, "add"},
		{"card", []string{id}, make([]string, 65), "add"},
		{"card", []string{"bad"}, []string{tag}, "add"},
		{"card", []string{id}, []string{"bad"}, "add"},
	} {
		if bad.normalize() == nil {
			t.Fatalf("accepted invalid bulk: %+v", bad)
		}
	}
}

func TestBulkEntityTagsAtomicAdminOnly(t *testing.T) {
	t.Setenv("JWT_SECRET", characterV3AccessTestSecret)
	f := openCharacterV3AccessFixture(t)
	t.Setenv("CONTENT_ADMIN_USER_IDS", f.owner.ID.String())
	if err := f.db.AutoMigrate(&Card{}, &Feat{}, &EntityTag{}, &EntityTagAssignment{}); err != nil {
		t.Fatal(err)
	}
	tag, otherTag := uuid.NewString(), uuid.NewString()
	for _, id := range []string{tag, otherTag} {
		if err := f.db.Create(&EntityTag{ID: id, Name: id}).Error; err != nil {
			t.Fatal(err)
		}
	}
	a, b := uuid.NewString(), uuid.NewString()
	for _, id := range []string{a, b} {
		if err := f.db.Create(&Card{ID: uuid.MustParse(id), Name: id, CardNumber: id, Rarity: RarityCommon}).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := f.db.Create(&EntityTagAssignment{"card", a, otherTag}).Error; err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	registerEntityTagRoutes(router.Group("/api"), f.auth, f.db)
	request := bulkEntityTagsRequest{"card", []string{a, b, a}, []string{tag}, "add"}
	for _, token := range []string{"", f.token(t, f.other)} {
		r := performCharacterV3Request(t, router, "POST", "/api/entity-tags/bulk", token, request)
		if r.Code != 401 && r.Code != 403 {
			t.Fatalf("unauthorized bulk %d %s", r.Code, r.Body.String())
		}
	}
	var count int64
	f.db.Model(&EntityTagAssignment{}).Where("tag_id = ?", tag).Count(&count)
	if count != 0 {
		t.Fatal("unauthorized tags saved")
	}
	for i := 0; i < 2; i++ { // Repeating the command is idempotent.
		r := performCharacterV3Request(t, router, "POST", "/api/entity-tags/bulk", f.token(t, f.owner), request)
		if r.Code != 200 {
			t.Fatalf("bulk: %d %s", r.Code, r.Body.String())
		}
	}
	f.db.Model(&EntityTagAssignment{}).Count(&count)
	if count != 3 {
		t.Fatalf("unrelated assignment lost or duplicated: %d", count)
	}
	// Unknown entity/tag rolls the complete batch back, including valid members.
	for _, bad := range []bulkEntityTagsRequest{
		{"card", []string{b, uuid.NewString()}, []string{otherTag}, "add"},
		{"card", []string{a, b}, []string{otherTag, uuid.NewString()}, "add"},
	} {
		if applyBulkEntityTags(f.db, bad) == nil {
			t.Fatal("partial invalid batch accepted")
		}
	}
	f.db.Model(&EntityTagAssignment{}).Count(&count)
	if count != 3 {
		t.Fatalf("failed batch mutated tags: %d", count)
	}
	request.Operation = "remove"
	if err := applyBulkEntityTags(f.db, request); err != nil {
		t.Fatal(err)
	}
	f.db.Model(&EntityTagAssignment{}).Count(&count)
	if count != 1 {
		t.Fatalf("remove deleted unrelated tag: %d", count)
	}
	// A second entity type uses the same operation without special-case logic.
	feat := Feat{ID: uuid.New(), Name: "Different tagged entity", CardNumber: "BULK-FEAT"}
	if err := f.db.Create(&feat).Error; err != nil {
		t.Fatal(err)
	}
	if err := applyBulkEntityTags(f.db, bulkEntityTagsRequest{"feat", []string{feat.ID.String()}, []string{tag}, "add"}); err != nil {
		t.Fatal(err)
	}
}
