package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func imageJobFixture(t *testing.T) (*ImageController, *generatedFakeProvider, uuid.UUID) {
	t.Helper()
	t.Setenv("IMAGE_JOBS_ENABLED", "1")
	db := openCatalogPaginationTestDB(t)
	if err := db.AutoMigrate(&ImageJob{}, &User{}, &Card{}); err != nil {
		t.Fatal(err)
	}
	owner := User{ID: uuid.New(), Username: uuid.NewString(), PasswordHash: "owned-test", DisplayName: "Owned admin", IsAdmin: true}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	service, provider, _ := generatedFixture()
	return &ImageController{db: db, generation: service}, provider, owner.ID
}

func TestImageJobsHTTPAdmissionAndWriterRollback(t *testing.T) {
	ic, provider, owner := imageJobFixture(t)
	id := uuid.New()
	request := func() *httptest.ResponseRecorder {
		response := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(response)
		c.Set("user_id", owner)
		c.Request = httptest.NewRequest("POST", "/images/generate-standalone", strings.NewReader(`{"prompt":"local standalone","quality":"low"}`))
		c.Request.Header.Set("Content-Type", "application/json")
		c.Request.Header.Set("Idempotency-Key", id.String())
		ic.GenerateStandaloneImage(c)
		return response
	}
	if response := request(); response.Code != 202 || provider.calls != 0 {
		t.Fatal("HTTP admission called provider or failed", response.Code)
	}
	job, err := ic.claimImageJob(context.Background())
	if err != nil || job == nil {
		t.Fatal(err)
	}
	ic.processImageJob(context.Background(), *job)
	t.Setenv("IMAGE_JOBS_ENABLED", "0")
	if response := request(); response.Code != 202 || provider.calls != 1 {
		t.Fatal("disabling writer turned retry into paid synchronous call", response.Code, provider.calls)
	}
	if readImageJob(t, ic, id).State != "succeeded" {
		t.Fatal("rollback lost existing result")
	}
	id = uuid.New()
	if response := request(); response.Code != 503 || provider.calls != 1 {
		t.Fatal("OFF request without committed receipt fell through to paid sync", response.Code, provider.calls)
	}
	response := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(response)
	c.Set("user_id", owner)
	c.Request = httptest.NewRequest("POST", "/images/jobs/generate-standalone", strings.NewReader(`{"prompt":"local standalone"}`))
	imageJobHandler(ic.GenerateStandaloneImage)(c)
	if response.Code != 400 || provider.calls != 1 {
		t.Fatal("job-only route without key became synchronous")
	}
}
func submitImageJob(ic *ImageController, owner, id uuid.UUID, prompt string) *httptest.ResponseRecorder {
	response := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(response)
	c.Set("user_id", owner)
	c.Request = httptest.NewRequest(http.MethodPost, "/images/generate-standalone", nil)
	c.Request.Header.Set("Idempotency-Key", id.String())
	ic.enqueueImageJob(c, "standalone", map[string]string{"prompt": prompt}, func() (ImageJob, error) {
		return ImageJob{Prompt: prompt, Quality: "low", Size: "1024x1024", Folder: "spell_icons", Label: "Тест"}, nil
	})
	return response
}
func readImageJob(t *testing.T, ic *ImageController, id uuid.UUID) ImageJob {
	t.Helper()
	var job ImageJob
	if err := ic.db.First(&job, "id=?", id).Error; err != nil {
		t.Fatal(err)
	}
	return job
}

func TestImageJobsConcurrentAdmissionUsesOneIdentity(t *testing.T) {
	ic, provider, owner := imageJobFixture(t)
	id := uuid.New()
	var group sync.WaitGroup
	statuses := make(chan int, 8)
	for i := 0; i < 8; i++ {
		group.Add(1)
		go func() { defer group.Done(); statuses <- submitImageJob(ic, owner, id, "local description").Code }()
	}
	group.Wait()
	close(statuses)
	for status := range statuses {
		if status != 202 {
			t.Fatalf("duplicate admission status %d", status)
		}
	}
	var count int64
	ic.db.Model(&ImageJob{}).Count(&count)
	if count != 1 || provider.calls != 0 {
		t.Fatal("admission duplicated job or called provider")
	}
	if submitImageJob(ic, owner, id, "different description").Code != 409 {
		t.Fatal("ID collision accepted")
	}
	if submitImageJob(ic, uuid.New(), id, "local description").Code != 409 {
		t.Fatal("foreign ID accepted")
	}
	response := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(response)
	c.Request = httptest.NewRequest("GET", "/", nil)
	c.Set("user_id", uuid.New())
	c.Params = gin.Params{{Key: "id", Value: id.String()}}
	ic.GetImageJob(c)
	if response.Code != 404 {
		t.Fatal("foreign job disclosed")
	}
}

func TestImageJobsPaidOutcomeSurvivesRetryAndReload(t *testing.T) {
	ic, provider, owner := imageJobFixture(t)
	id := uuid.New()
	if r := submitImageJob(ic, owner, id, "local"); r.Code != 202 {
		t.Fatal(r.Body.String())
	}
	job, err := ic.claimImageJob(context.Background())
	if err != nil || job == nil {
		t.Fatal(err)
	}
	ic.processImageJob(context.Background(), *job)
	saved := readImageJob(t, ic, id)
	if saved.State != "succeeded" || saved.Result["image_url"] == nil || provider.calls != 1 {
		t.Fatalf("bad outcome %s / %d", saved.State, provider.calls)
	}
	before, _ := json.Marshal(saved.Result)
	// A fresh controller represents a restarted API process, sharing only DB.
	restarted := &ImageController{db: ic.db, generation: ic.generation}
	r := submitImageJob(restarted, owner, id, "local")
	if r.Code != 202 {
		t.Fatal(r.Body.String())
	}
	again, _ := json.Marshal(readImageJob(t, restarted, id).Result)
	if string(before) != string(again) || provider.calls != 1 {
		t.Fatal("retry changed paid outcome")
	}
	next, err := restarted.claimImageJob(context.Background())
	if err != nil || next != nil {
		t.Fatal("completed job dispatched again", err)
	}
}

func TestImageJobsUnknownAndExpiredLeaseNeverRedispatch(t *testing.T) {
	for _, scenario := range []string{"provider_timeout", "worker_crash"} {
		t.Run(scenario, func(t *testing.T) {
			ic, provider, owner := imageJobFixture(t)
			id := uuid.New()
			submitImageJob(ic, owner, id, "local")
			job, err := ic.claimImageJob(context.Background())
			if err != nil || job == nil {
				t.Fatal(err)
			}
			if scenario == "provider_timeout" {
				provider.run = func(context.Context) (string, error) { return "", context.DeadlineExceeded }
				ic.processImageJob(context.Background(), *job)
			} else {
				ic.db.Model(job).Update("lease_until", time.Now().Add(-time.Minute))
			}
			next, err := ic.claimImageJob(context.Background())
			if err != nil || next != nil {
				t.Fatal("unknown dispatch repeated", err)
			}
			saved := readImageJob(t, ic, id)
			if saved.State != "unknown" {
				t.Fatalf("lost uncertainty %s", saved.State)
			}
			calls := provider.calls
			submitImageJob(ic, owner, id, "local")
			ic.claimImageJob(context.Background())
			if provider.calls != calls {
				t.Fatal("paid retry")
			}
		})
	}
}

func TestImageJobsLimitsAndRevokedRightsPreventPaidCalls(t *testing.T) {
	ic, provider, owner := imageJobFixture(t)
	t.Setenv("IMAGE_JOBS_MAX_DAILY_ATTEMPTS", "1")
	id := uuid.New()
	if submitImageJob(ic, owner, id, "first").Code != 202 {
		t.Fatal("first rejected")
	}
	if submitImageJob(ic, owner, uuid.New(), "second").Code != 429 {
		t.Fatal("daily budget bypass")
	}
	if submitImageJob(ic, owner, id, "first").Code != 202 {
		t.Fatal("replay incorrectly spends budget")
	}
	job, err := ic.claimImageJob(context.Background())
	if err != nil || job == nil {
		t.Fatal(err)
	}
	if second, err := ic.claimImageJob(context.Background()); err != nil || second != nil {
		t.Fatal("concurrency limit bypass")
	}
	ic.db.Model(&User{}).Where("id=?", owner).Update("is_admin", false)
	ic.processImageJob(context.Background(), *job)
	if provider.calls != 0 || readImageJob(t, ic, id).State != "failed" {
		t.Fatal("revoked right performed paid request")
	}
}

func TestImageJobsEntityWriteAndSuccessAreAtomic(t *testing.T) {
	ic, provider, owner := imageJobFixture(t)
	card := Card{ID: uuid.New(), Name: "Local", CardNumber: "job-test-card", ImageURL: "https://old.example.test/image.png"}
	if err := ic.db.Create(&card).Error; err != nil {
		t.Fatal(err)
	}
	id := uuid.New()
	submitImageJob(ic, owner, id, "local")
	ic.db.Model(&ImageJob{}).Where("id=?", id).Updates(map[string]any{"kind": "entity", "entity_type": "card", "entity_id": card.ID.String()})
	job, err := ic.claimImageJob(context.Background())
	if err != nil || job == nil {
		t.Fatal(err)
	}
	// Fail the success write inside the same DB transaction, after entity update.
	callback := "owned_image_job_failure"
	ic.db.Callback().Update().Before("gorm:update").Register(callback, func(tx *gorm.DB) {
		if tx.Statement.Table == "image_jobs" {
			if updates, ok := tx.Statement.Dest.(map[string]any); ok && updates["state"] == "succeeded" {
				tx.AddError(errors.New("owned commit failure"))
			}
		}
	})
	defer ic.db.Callback().Update().Remove(callback)
	ic.processImageJob(context.Background(), *job)
	var after Card
	ic.db.First(&after, "id=?", card.ID)
	if after.ImageURL != card.ImageURL || readImageJob(t, ic, id).State == "succeeded" || provider.calls != 1 {
		t.Fatal("partial entity/job commit")
	}
}

func TestImageJobsHistoryPagesStayOwnedAndExpireWithWriterOff(t *testing.T) {
	ic, provider, owner := imageJobFixture(t)
	ids := map[uuid.UUID]bool{}
	for i := 0; i < 25; i++ {
		job := ImageJob{ID: uuid.New(), OwnerID: owner, Fingerprint: strings.Repeat("a", 64), Kind: "standalone", State: "unknown", Prompt: "private prompt", Quality: "low", Size: "1024x1024", Folder: "test", CreatedAt: time.Now().Add(-time.Duration(i) * time.Minute)}
		if err := ic.db.Create(&job).Error; err != nil {
			t.Fatal(err)
		}
		ids[job.ID] = true
	}
	past := time.Now().Add(-time.Minute)
	foreign := ImageJob{ID: uuid.New(), OwnerID: uuid.New(), Fingerprint: strings.Repeat("b", 64), Kind: "standalone", State: "unknown", Prompt: "foreign", Quality: "low", Size: "1024x1024", Folder: "test"}
	ic.db.Create(&foreign)
	var stale ImageJob
	ic.db.Where("owner_id=?", owner).First(&stale)
	ic.db.Model(&stale).Updates(map[string]any{"state": "running", "lease_until": past})
	t.Setenv("IMAGE_JOBS_ENABLED", "0")
	seen := map[uuid.UUID]bool{}
	for page := 1; page <= 2; page++ {
		response := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(response)
		c.Set("user_id", owner)
		c.Request = httptest.NewRequest("GET", fmt.Sprintf("/images/jobs?page=%d", page), nil)
		ic.ListImageJobs(c)
		var body struct {
			Jobs    []ImageJob `json:"jobs"`
			HasMore bool       `json:"has_more"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil || response.Code != 200 {
			t.Fatal(err, response.Code)
		}
		if body.HasMore != (page == 1) || len(body.Jobs) != (map[int]int{1: 20, 2: 5}[page]) {
			t.Fatal("incomplete history pagination")
		}
		for _, job := range body.Jobs {
			if !ids[job.ID] || seen[job.ID] {
				t.Fatal("foreign or duplicate history row")
			}
			seen[job.ID] = true
		}
		if strings.Contains(response.Body.String(), "private prompt") {
			t.Fatal("history disclosed prompt")
		}
	}
	if readImageJob(t, ic, stale.ID).State != "unknown" || provider.calls != 0 {
		t.Fatal("expired job was resumed or hidden by disabled writer")
	}
}
