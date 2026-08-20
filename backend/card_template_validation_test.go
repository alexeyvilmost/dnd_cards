package main

import "testing"

func TestNormalizeCreateCardTemplateType(t *testing.T) {
	tests := []struct {
		name  string
		input TemplateType
		want  TemplateType
		valid bool
	}{
		{name: "omitted defaults to ordinary card", input: "", want: TemplateFalse, valid: true},
		{name: "ordinary card", input: TemplateFalse, want: TemplateFalse, valid: true},
		{name: "template and card", input: TemplateBoth, want: TemplateBoth, valid: true},
		{name: "template only", input: TemplateOnly, want: TemplateOnly, valid: true},
		{name: "unknown value", input: TemplateType("not_template"), want: TemplateType("not_template"), valid: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, valid := normalizeCreateCardTemplateType(test.input)
			if got != test.want || valid != test.valid {
				t.Fatalf("normalizeCreateCardTemplateType(%q) = (%q, %v), want (%q, %v)", test.input, got, valid, test.want, test.valid)
			}
		})
	}
}
