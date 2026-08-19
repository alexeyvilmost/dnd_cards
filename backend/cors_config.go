package main

import (
	"fmt"
	"net/url"
	"os"
	"strings"
)

const corsAllowedOriginsEnv = "CORS_ALLOWED_ORIGINS"

var defaultAllowedOrigins = []string{
	"http://localhost:3000",
	"http://localhost:5173",
	"http://127.0.0.1:3000",
	"http://127.0.0.1:5173",
	"https://frontend-production-550b.up.railway.app",
	"https://bagofholding.up.railway.app",
	"https://bagofholding.ru",
}

func configuredAllowedOrigins() ([]string, error) {
	raw, configured := os.LookupEnv(corsAllowedOriginsEnv)
	if !configured {
		return append([]string(nil), defaultAllowedOrigins...), nil
	}
	if strings.TrimSpace(raw) == "" {
		return nil, fmt.Errorf("%s is set but empty", corsAllowedOriginsEnv)
	}

	parts := strings.Split(raw, ",")
	origins := make([]string, 0, len(parts))
	seen := make(map[string]struct{}, len(parts))
	for index, part := range parts {
		origin := strings.TrimSpace(part)
		parsed, err := url.Parse(origin)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.Path != "" {
			return nil, fmt.Errorf("%s entry %d is not an HTTP origin: %q", corsAllowedOriginsEnv, index+1, origin)
		}
		canonical := parsed.Scheme + "://" + parsed.Host
		if _, exists := seen[canonical]; exists {
			return nil, fmt.Errorf("%s contains duplicate origin %q", corsAllowedOriginsEnv, canonical)
		}
		seen[canonical] = struct{}{}
		origins = append(origins, canonical)
	}
	return origins, nil
}
