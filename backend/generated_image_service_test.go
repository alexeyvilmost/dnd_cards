package main

import (
	"context"
	"encoding/base64"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go/service/s3"
	"gorm.io/gorm"
)

var generatedTestPNG = []byte("\x89PNG\r\n\x1a\nlocal-test-image")

type generatedFakeProvider struct {
	calls int
	run   func(context.Context) (string, error)
}

func (f *generatedFakeProvider) GenerateImageContext(ctx context.Context, _, _, _ string) (string, error) {
	f.calls++
	if f.run != nil {
		return f.run(ctx)
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(generatedTestPNG), nil
}

type generatedFakeStorage struct {
	preflights, uploads int
	preflight           func(context.Context) error
	upload              func(context.Context) (string, string, error)
	deleted             []string
	cleanupContextErr   error
	cleanupBudget       time.Duration
}

func (f *generatedFakeStorage) PreflightImageGeneration(ctx context.Context) error {
	f.preflights++
	if f.preflight != nil {
		return f.preflight(ctx)
	}
	return nil
}
func (f *generatedFakeStorage) UploadImageFromBytes(ctx context.Context, data []byte, filename, contentType, folder string) (string, string, error) {
	f.uploads++
	if f.upload != nil {
		return f.upload(ctx)
	}
	return "https://images.example.test/new.png", "cards/new.png", nil
}
func (f *generatedFakeStorage) DeleteImage(ctx context.Context, id string) error {
	f.deleted = append(f.deleted, id)
	f.cleanupContextErr = ctx.Err()
	if deadline, ok := ctx.Deadline(); ok {
		f.cleanupBudget = time.Until(deadline)
	}
	return nil
}

func generatedFixture() (*generatedImageService, *generatedFakeProvider, *generatedFakeStorage) {
	provider, storage := &generatedFakeProvider{}, &generatedFakeStorage{}
	return &generatedImageService{provider: provider, storage: storage}, provider, storage
}

func requireImageProblem(t *testing.T, err error, code, outcome string) *ImageGenerationError {
	t.Helper()
	var problem *ImageGenerationError
	if !errors.As(err, &problem) {
		t.Fatalf("expected typed image failure, got %v", err)
	}
	if problem.Code != code || problem.Outcome != outcome {
		t.Fatalf("unexpected problem: %+v", problem)
	}
	if strings.Contains(problem.Error(), "SECRET") {
		t.Fatalf("unsafe error: %s", problem.Error())
	}
	return problem
}

func TestGeneratedImagePreflightPreventsPaidRequest(t *testing.T) {
	for _, scenario := range []string{"missing-storage", "invalid-config", "cancelled", "cancel-during-preflight"} {
		t.Run(scenario, func(t *testing.T) {
			service, provider, storage := generatedFixture()
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			code := "image_storage_not_configured"
			switch scenario {
			case "missing-storage":
				service.storage = nil
			case "invalid-config":
				storage.preflight = func(context.Context) error { return errors.New("SECRET storage config") }
			case "cancelled":
				cancel()
				code = "image_cancelled"
			case "cancel-during-preflight":
				storage.preflight = func(context.Context) error { cancel(); return nil }
				code = "image_cancelled"
			}
			_, err := service.Generate(ctx, generatedImageInput{}, nil)
			requireImageProblem(t, err, code, "not_started")
			if provider.calls != 0 || storage.uploads != 0 {
				t.Fatal("paid call or upload ran after failed preflight")
			}
		})
	}
}

func TestGeneratedImagePipelineFailuresPreserveExistingEntity(t *testing.T) {
	for _, scenario := range []string{"provider", "download", "non-image", "storage", "data-url-storage", "missing-storage-id"} {
		t.Run(scenario, func(t *testing.T) {
			service, provider, storage := generatedFixture()
			code, outcome := "image_storage_failed", "not_saved"
			switch scenario {
			case "provider":
				provider.run = func(context.Context) (string, error) {
					return "", imagePipelineError("image_provider_limit", "limited", "provider", "rejected", 429, errors.New("SECRET upstream"))
				}
				code, outcome = "image_provider_limit", "rejected"
			case "download":
				service.download = func(context.Context, string) ([]byte, error) { return nil, errors.New("SECRET download URL") }
				code = "image_download_failed"
			case "non-image":
				service.download = func(context.Context, string) ([]byte, error) { return []byte("<svg>SECRET</svg>"), nil }
				code = "image_download_failed"
			case "storage":
				storage.upload = func(context.Context) (string, string, error) {
					return "", "cards/new.png", errors.New("SECRET storage URL")
				}
			case "data-url-storage":
				storage.upload = func(context.Context) (string, string, error) {
					return "data:image/png;base64,AAA", "cards/new.png", nil
				}
			case "missing-storage-id":
				storage.upload = func(context.Context) (string, string, error) { return "https://images.example.test/new.png", "", nil }
			}
			oldURL, writes := "https://images.example.test/old.png", 0
			_, err := service.Generate(context.Background(), generatedImageInput{}, func(_ context.Context, image generatedImageResult) error { writes++; oldURL = image.URL; return nil })
			requireImageProblem(t, err, code, outcome)
			if writes != 0 || oldURL != "https://images.example.test/old.png" || provider.calls != 1 {
				t.Fatal("failure changed entity or retried paid generation")
			}
			for _, id := range storage.deleted {
				if id != "cards/new.png" {
					t.Fatalf("deleted old image: %s", id)
				}
			}
			if scenario == "storage" || scenario == "data-url-storage" {
				if len(storage.deleted) != 1 {
					t.Fatal("new orphan was not cleaned")
				}
			}
		})
	}
}

func TestGeneratedImagePersistenceOutcomeControlsCleanup(t *testing.T) {
	for _, scenario := range []string{"success", "not-found", "database-unknown", "cancel-during-write"} {
		t.Run(scenario, func(t *testing.T) {
			service, provider, storage := generatedFixture()
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			writes := 0
			result, err := service.Generate(ctx, generatedImageInput{}, func(writeCtx context.Context, image generatedImageResult) error {
				writes++
				if writeCtx.Err() != nil || image.Model != "gpt-image-1" || image.URL != "https://images.example.test/new.png" || image.Bytes != len(generatedTestPNG) {
					t.Fatal("invalid image or context passed to writer")
				}
				switch scenario {
				case "not-found":
					return gorm.ErrRecordNotFound
				case "database-unknown":
					return errors.New("SECRET connection lost after commit")
				case "cancel-during-write":
					cancel()
					return context.Canceled
				}
				return nil
			})
			if scenario == "success" {
				if err != nil || result.StorageID != "cards/new.png" {
					t.Fatalf("success failed: %v", err)
				}
			} else if scenario == "not-found" {
				requireImageProblem(t, err, "image_entity_not_found", "not_saved")
			} else {
				requireImageProblem(t, err, "image_persistence_unknown", "unknown")
			}
			if provider.calls != 1 || storage.uploads != 1 || writes != 1 {
				t.Fatal("pipeline repeated or skipped work")
			}
			wantDeleted := 0
			if scenario == "not-found" {
				wantDeleted = 1
			}
			if len(storage.deleted) != wantDeleted {
				t.Fatalf("cleanup after %s: %v", scenario, storage.deleted)
			}
		})
	}
}

func TestGeneratedImageCancellationAfterProviderOrStorage(t *testing.T) {
	for _, stage := range []string{"provider", "storage"} {
		t.Run(stage, func(t *testing.T) {
			service, provider, storage := generatedFixture()
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if stage == "provider" {
				provider.run = func(context.Context) (string, error) { cancel(); return "unused", nil }
			} else {
				storage.upload = func(context.Context) (string, string, error) {
					cancel()
					return "https://images.example.test/new.png", "cards/new.png", nil
				}
			}
			_, err := service.Generate(ctx, generatedImageInput{}, func(context.Context, generatedImageResult) error {
				t.Fatal("writer ran after cancellation")
				return nil
			})
			requireImageProblem(t, err, "image_cancelled", "not_saved")
			if provider.calls != 1 {
				t.Fatal("paid provider retry")
			}
			if stage == "storage" {
				if len(storage.deleted) != 1 || storage.cleanupContextErr != nil || storage.cleanupBudget <= 0 || storage.cleanupBudget > 5*time.Second {
					t.Fatalf("cleanup not detached/bounded: %+v", storage)
				}
			} else if storage.uploads != 0 {
				t.Fatal("upload after cancelled provider")
			}
		})
	}
}

func TestGeneratedImageDownloadHonorsCancellationAndBounds(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		_, _ = w.Write(generatedTestPNG)
	}))
	defer server.Close()
	for _, source := range []string{server.URL, "https://example.test/image.png", "data:image/png;base64,not-valid", "data:image/png;base64," + strings.Repeat("A", base64.StdEncoding.EncodedLen(maxGeneratedImageBytes)+1), "file:///private"} {
		if _, err := downloadGeneratedImage(context.Background(), source); err == nil {
			t.Fatalf("accepted invalid source %q", source)
		}
	}
	if requests != 0 {
		t.Fatal("provider URL caused a second network path")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := downloadGeneratedImage(ctx, server.URL); !errors.Is(err, context.Canceled) {
		t.Fatalf("lost cancellation: %v", err)
	}
}

func TestImageStoragePreflightIsLocalConfigurationOnly(t *testing.T) {
	for _, storage := range []*YandexStorageService{nil, {}, {bucket: "configured-without-client"}} {
		if err := storage.PreflightImageGeneration(context.Background()); err == nil {
			t.Fatal("invalid storage accepted")
		}
	}
	// A configured client needs no HeadBucket/ListBucket call to pass.
	storage := &YandexStorageService{bucket: "test-images", s3Client: &s3.S3{}}
	if err := storage.PreflightImageGeneration(context.Background()); err != nil {
		t.Fatal(err)
	}
}
