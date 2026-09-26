package main

import (
	"bytes"
	"context"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/aws/credentials"
	"github.com/aws/aws-sdk-go/aws/session"
	"github.com/aws/aws-sdk-go/service/s3"
)

func TestImageUploadStreamsPastFormerTwelveMegabyteQuota(t *testing.T) {
	const payloadBytes = 13 << 20
	received := make(chan int64, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Content-Type") != "image/png" {
			t.Errorf("unexpected content type %q", r.Header.Get("Content-Type"))
		}
		count, err := io.Copy(io.Discard, r.Body)
		if err != nil {
			t.Errorf("reading upload: %v", err)
		}
		received <- count
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("image", "large.png")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(bytes.Repeat([]byte{'x'}, payloadBytes)); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/upload", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	if err := request.ParseMultipartForm(8 << 20); err != nil {
		t.Fatal(err)
	}
	defer request.MultipartForm.RemoveAll()
	file := request.MultipartForm.File["image"][0]
	file.Header.Set("Content-Type", "image/png")

	sess := session.Must(session.NewSession(&aws.Config{
		Region:           aws.String("ru-central1"),
		Endpoint:         aws.String(server.URL),
		Credentials:      credentials.NewStaticCredentials("test", "test", ""),
		S3ForcePathStyle: aws.Bool(true),
		MaxRetries:       aws.Int(0),
	}))
	storage := &YandexStorageService{s3Client: s3.New(sess), bucket: "test-bucket"}
	if _, _, err := storage.UploadImage(context.Background(), file, "cards"); err != nil {
		t.Fatal(err)
	}
	if count := <-received; count != payloadBytes {
		t.Fatalf("uploaded %d bytes instead of %d", count, payloadBytes)
	}
}
