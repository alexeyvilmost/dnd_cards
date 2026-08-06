package main

import "testing"

func stringPointer(value string) *string {
	return &value
}

func TestApplyNullableStringUpdate(t *testing.T) {
	t.Run("omitted value preserves the current field", func(t *testing.T) {
		original := "30/120"
		field := &original

		applyNullableStringUpdate(&field, nil)

		if field == nil || *field != original {
			t.Fatalf("expected %q to be preserved, got %#v", original, field)
		}
	})

	t.Run("non-empty value replaces the current field", func(t *testing.T) {
		field := stringPointer("30/120")
		requested := stringPointer("80/320")

		applyNullableStringUpdate(&field, requested)

		if field == nil || *field != "80/320" {
			t.Fatalf("expected replacement value, got %#v", field)
		}
		if field == requested {
			t.Fatal("stored field must not alias the request transport pointer")
		}
	})

	t.Run("empty value clears the field to null", func(t *testing.T) {
		field := stringPointer("30/120")

		applyNullableStringUpdate(&field, stringPointer(""))

		if field != nil {
			t.Fatalf("expected nil after explicit clear, got %q", *field)
		}
	})
}
