package main

import (
	"fmt"
	"net"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
)

const trustedProxyCIDRsEnv = "TRUSTED_PROXY_CIDRS"

// Only loopback is trusted by default. The Timecloud Compose deployment pins
// its Caddy network explicitly through TRUSTED_PROXY_CIDRS.
var defaultTrustedProxyCIDRs = []string{
	"127.0.0.0/8",
	"::1/128",
}

func parseTrustedProxyCIDRs(raw string, configured bool) ([]string, error) {
	if !configured {
		return append([]string(nil), defaultTrustedProxyCIDRs...), nil
	}
	if strings.TrimSpace(raw) == "" {
		return nil, fmt.Errorf("%s is set but empty", trustedProxyCIDRsEnv)
	}

	parts := strings.Split(raw, ",")
	trusted := make([]string, 0, len(parts))
	seen := make(map[string]struct{}, len(parts))
	for index, part := range parts {
		candidate := strings.TrimSpace(part)
		if candidate == "" {
			return nil, fmt.Errorf("%s entry %d is empty", trustedProxyCIDRsEnv, index+1)
		}

		ip, network, err := net.ParseCIDR(candidate)
		if err != nil {
			return nil, fmt.Errorf("%s entry %q is not a valid CIDR: %w", trustedProxyCIDRsEnv, candidate, err)
		}
		if !ip.Equal(network.IP) {
			return nil, fmt.Errorf("%s entry %q has host bits set; use %q", trustedProxyCIDRsEnv, candidate, network.String())
		}
		ones, bits := network.Mask.Size()
		minimumPrefix := 32
		if bits == net.IPv4len*8 {
			minimumPrefix = 8
		}
		if ones < minimumPrefix {
			return nil, fmt.Errorf(
				"%s entry %q is too broad; require at least /%d for IPv%d",
				trustedProxyCIDRsEnv,
				candidate,
				minimumPrefix,
				bits,
			)
		}

		canonical := network.String()
		if _, exists := seen[canonical]; exists {
			return nil, fmt.Errorf("%s contains duplicate CIDR %q", trustedProxyCIDRsEnv, canonical)
		}
		seen[canonical] = struct{}{}
		trusted = append(trusted, canonical)
	}

	return trusted, nil
}

func configureTrustedClientIPs(router *gin.Engine) error {
	raw, configured := os.LookupEnv(trustedProxyCIDRsEnv)
	trusted, err := parseTrustedProxyCIDRs(raw, configured)
	if err != nil {
		return err
	}

	// Gin defaults to trusting every proxy and consults X-Forwarded-For first.
	// Caddy owns X-Real-IP, so only that header is accepted and only when the
	// immediate network peer belongs to an explicitly trusted proxy CIDR.
	router.ForwardedByClientIP = true
	router.RemoteIPHeaders = []string{"X-Real-IP"}
	router.TrustedPlatform = ""
	if err := router.SetTrustedProxies(trusted); err != nil {
		return fmt.Errorf("configure trusted proxy CIDRs: %w", err)
	}
	return nil
}
