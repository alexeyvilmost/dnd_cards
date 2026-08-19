package main

import (
	"os"
	"reflect"
	"testing"
)

func TestConfiguredAllowedOrigins(t *testing.T) {
	t.Run("safe defaults", func(t *testing.T) {
		original, existed := os.LookupEnv(corsAllowedOriginsEnv)
		if err := os.Unsetenv(corsAllowedOriginsEnv); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			if existed {
				_ = os.Setenv(corsAllowedOriginsEnv, original)
			} else {
				_ = os.Unsetenv(corsAllowedOriginsEnv)
			}
		})
		got, err := configuredAllowedOrigins()
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(got, defaultAllowedOrigins) {
			t.Fatalf("origins = %#v, want defaults %#v", got, defaultAllowedOrigins)
		}
	})

	t.Run("multiple normalized origins", func(t *testing.T) {
		t.Setenv(corsAllowedOriginsEnv, " https://bagofholding.ru, http://localhost:5173 ")
		got, err := configuredAllowedOrigins()
		if err != nil {
			t.Fatal(err)
		}
		want := []string{"https://bagofholding.ru", "http://localhost:5173"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("origins = %#v, want %#v", got, want)
		}
	})

	for name, value := range map[string]string{
		"empty":       "",
		"not URL":     "bagofholding.ru",
		"path":        "https://bagofholding.ru/api",
		"duplicate":   "https://bagofholding.ru,https://bagofholding.ru",
		"empty entry": "https://bagofholding.ru,",
	} {
		t.Run(name, func(t *testing.T) {
			t.Setenv(corsAllowedOriginsEnv, value)
			if _, err := configuredAllowedOrigins(); err == nil {
				t.Fatalf("expected %q to be rejected", value)
			}
		})
	}
}
