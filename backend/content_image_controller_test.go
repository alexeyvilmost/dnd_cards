package main

import (
	"bytes"
	"encoding/base64"
	"testing"

	"github.com/google/uuid"
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
		"data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
	} {
		if _, _, accepted := decodeContentImageDataURI(invalid); accepted {
			t.Fatalf("invalid image source was accepted: %q", invalid)
		}
	}
}

func TestContentImageRedirectSourceRejectsProtocolRelativeAndInsecureTargets(t *testing.T) {
	for _, valid := range []string{"https://cdn.example.test/image.webp", "/assets/image.png"} {
		if !contentImageRedirectSource(valid) {
			t.Fatalf("valid image redirect was rejected: %q", valid)
		}
	}
	for _, invalid := range []string{
		"http://cdn.example.test/image.png",
		"//attacker.example/image.png",
		`/\attacker.example/image.png`,
		"data:image/png;base64,iVBORw==",
	} {
		if contentImageRedirectSource(invalid) {
			t.Fatalf("unsafe image redirect was accepted: %q", invalid)
		}
	}
}

func TestCatalogImageProjectionMatchesContentRouteAvailability(t *testing.T) {
	id := uuid.MustParse("7cd8f57e-72bb-4a8d-ad93-34d2fb7ff414")
	route := "/api/content-images/spells/" + id.String()
	tests := []struct {
		name      string
		cloudURL  string
		hasLegacy bool
		want      string
	}{
		{name: "no stored source", want: ""},
		{name: "legacy embedded source", hasLegacy: true, want: route},
		{name: "cloud source", cloudURL: "https://cdn.example.test/spell.png", want: "https://cdn.example.test/spell.png"},
		{name: "non-http cloud source uses media route", cloudURL: "data:image/png;base64,iVBORw==", want: route},
		{name: "insecure cloud source without fallback is omitted", cloudURL: "http://cdn.example.test/spell.png", want: ""},
		{name: "insecure cloud source uses safe legacy fallback", cloudURL: "http://cdn.example.test/spell.png", hasLegacy: true, want: route},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := listImageURL("spells", id, test.cloudURL, test.hasLegacy); got != test.want {
				t.Fatalf("list image projection=%q want=%q", got, test.want)
			}
		})
	}
}

func TestStoredContentImageSourceTreatsWhitespaceAsMissing(t *testing.T) {
	if source := storedContentImageSource(contentImageRow{
		ImageURL: " \n ", ImageCloudinaryURL: "\t",
	}); source != "" {
		t.Fatalf("whitespace-only sources must have 404 semantics, got %q", source)
	}
	if source := storedContentImageSource(contentImageRow{
		ImageURL: "data:image/png;base64,iVBORw==", ImageCloudinaryURL: " ",
	}); source != "data:image/png;base64,iVBORw==" {
		t.Fatalf("legacy source was not selected: %q", source)
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
