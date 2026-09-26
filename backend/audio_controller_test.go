package main

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"dnd-cards-backend/passivepresentation"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func TestAudioBindingIsAdminOnlyAndIndependentFromMechanics(t *testing.T) {
	t.Setenv("JWT_SECRET", characterV3AccessTestSecret)
	f := openCharacterV3AccessFixture(t)
	t.Setenv("CONTENT_ADMIN_USER_IDS", f.owner.ID.String())
	if err := f.db.AutoMigrate(&AudioCue{}, &EntityAudioBinding{}, &passivepresentation.Presentation{}); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"first", "unrelated-second"} {
		if err := f.db.Create(&AudioCue{Key: key, Name: key, URL: "/audio/test.wav", Channel: "effects", Gain: 1, Version: 1}).Error; err != nil {
			t.Fatal(err)
		}
		if err := f.db.Create(&passivepresentation.Presentation{Key: key, Name: key, Version: 1}).Error; err != nil {
			t.Fatal(err)
		}
	}
	registerAudioRoutes(f.router.Group("/api"), f.auth, f.db)
	for _, key := range []string{"first", "unrelated-second"} {
		path := "/api/audio/entities/passive/" + key + "/cast"
		for _, row := range []struct {
			token  string
			status int
		}{{"", 401}, {f.token(t, f.other), 403}, {f.token(t, f.owner), 200}} {
			res := performCharacterV3Request(t, f.router, "PUT", path, row.token, map[string]any{"cue_key": key})
			if res.Code != row.status {
				t.Fatalf("%s: %d %s", key, res.Code, res.Body.String())
			}
		}
	}
	for _, body := range []map[string]any{{"cue_key": "unknown"}, {"cue_key": "first", "mechanics": map[string]any{"hp": 100}}} {
		res := performCharacterV3Request(t, f.router, "PUT", "/api/audio/entities/passive/first/cast", f.token(t, f.owner), body)
		if res.Code != 400 {
			t.Fatal(res.Code)
		}
	}
	var n int64
	f.db.Model(&EntityAudioBinding{}).Count(&n)
	if n != 2 {
		t.Fatal(n)
	}
	res := performCharacterV3Request(t, f.router, "PUT", "/api/audio/entities/passive/first/cast", f.token(t, f.owner), map[string]any{"cue_key": ""})
	if res.Code != 200 {
		t.Fatal(res.Code)
	}
	f.db.Model(&EntityAudioBinding{}).Count(&n)
	if n != 1 {
		t.Fatal(n)
	}
	for _, token := range []string{f.token(t, f.other), f.token(t, f.owner)} {
		if res := performCharacterV3Request(t, f.router, "GET", "/api/audio", token, nil); res.Code != 200 {
			t.Fatal(res.Code)
		}
	}
}
func TestAudioUploadSniffsBytesNotFileExtension(t *testing.T) {
	for _, row := range []struct{ data, ext string }{{"RIFFxxxxWAVEpayload", ".wav"}, {"OggSxxxx", ".ogg"}, {"ID3xxxx", ".mp3"}, {"<script>oops</script>", ""}, {"", ""}} {
		_, ext := audioMediaType([]byte(row.data))
		if ext != row.ext {
			t.Fatalf("%q: %s", row.data, ext)
		}
	}
	for _, event := range []string{"cast", "hit", "miss", "healing"} {
		if !validAudioEvent(event) {
			t.Fatal(event)
		}
	}
	if validAudioEvent("spend_resource") {
		t.Fatal("mechanics accepted")
	}
}

func TestAudioUploadRejectsUnauthorisedUsersAndDisguisedFilesBeforeStorage(t *testing.T) {
	t.Setenv("JWT_SECRET", characterV3AccessTestSecret)
	f := openCharacterV3AccessFixture(t)
	t.Setenv("CONTENT_ADMIN_USER_IDS", f.owner.ID.String())
	registerAudioRoutes(f.router.Group("/api"), f.auth, f.db)
	for _, test := range []struct {
		token  string
		status int
	}{{"", 401}, {f.token(t, f.other), 403}, {f.token(t, f.owner), 400}} {
		var body bytes.Buffer
		w := multipart.NewWriter(&body)
		file, _ := w.CreateFormFile("file", "disguised.wav")
		file.Write([]byte("<html>not audio</html>"))
		w.WriteField("name", "Test")
		w.WriteField("license", "Own recording")
		w.Close()
		req := httptest.NewRequest("POST", "/api/audio/upload", &body)
		req.Header.Set("Content-Type", w.FormDataContentType())
		if test.token != "" {
			req.Header.Set("Authorization", "Bearer "+test.token)
		}
		result := httptest.NewRecorder()
		f.router.ServeHTTP(result, req)
		if result.Code != test.status {
			t.Fatalf("got %d wanted %d: %s", result.Code, test.status, result.Body.String())
		}
	}
}

func TestAudioUploadAcceptsFormerFifteenMegabyteLimitBeforeStorage(t *testing.T) {
	t.Setenv("JWT_SECRET", characterV3AccessTestSecret)
	t.Setenv("YANDEX_CLOUD_ACCESS_KEY_ID", "")
	t.Setenv("YANDEX_CLOUD_SECRET_ACCESS_KEY", "")
	t.Setenv("YANDEX_CLOUD_BUCKET_NAME", "")
	adminID := uuid.New()
	t.Setenv("CONTENT_ADMIN_USER_IDS", adminID.String())
	auth := activeSecurityTestAuthService()
	token, err := auth.generateJWTToken(User{ID: adminID, Username: "audio-admin"})
	if err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	registerAudioRoutes(router.Group("/api"), auth, nil)
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	file, err := writer.CreateFormFile("file", "large.wav")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.Write(append([]byte("RIFFxxxxWAVE"), bytes.Repeat([]byte{0}, 16<<20)...)); err != nil {
		t.Fatal(err)
	}
	if err := writer.WriteField("name", "Large audio"); err != nil {
		t.Fatal(err)
	}
	if err := writer.WriteField("license", "Own recording"); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/audio/upload", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	request.Header.Set("Authorization", "Bearer "+token)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("large valid audio was rejected before storage configuration: %d %s", response.Code, response.Body.String())
	}
}
