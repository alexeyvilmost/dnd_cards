package main

import (
	"bytes"
	"encoding/base64"
	"testing"
)

func TestDecodeContentImageDataURI(t *testing.T) {
	png := []byte{0x89, 0x50, 0x4e, 0x47}
	dataURI := "data:image/png;base64," + base64.StdEncoding.EncodeToString(png)
	contentType, body, ok := decodeContentImageDataURI(dataURI)
	if !ok || contentType != "image/png" || !bytes.Equal(body, png) {
		t.Fatalf("valid embedded image did not round-trip: type=%q ok=%v body=%v", contentType, ok, body)
	}

	for _, invalid := range []string{
		"https://example.test/image.png",
		"data:text/plain;base64,SGVsbG8=",
		"data:image/png,not-base64",
		"data:image/png;base64,%%%",
	} {
		if _, _, accepted := decodeContentImageDataURI(invalid); accepted {
			t.Fatalf("invalid image source was accepted: %q", invalid)
		}
	}
}

func TestContentImageETagIsStableAndContentBound(t *testing.T) {
	if contentImageETag("a") != contentImageETag("a") {
		t.Fatal("equal image sources produced different ETags")
	}
	if contentImageETag("a") == contentImageETag("b") {
		t.Fatal("different image sources produced the same ETag")
	}
}
