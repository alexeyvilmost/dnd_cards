package migrations

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"unicode/utf16"
)

// This package cannot import the API's main-package canonicalJSON helper.
// Keep the same JSON/JavaScript string and UTF-16 ordering contract here, and
// reuse the migration SHA helper. No content/root metadata fields are removed.
func spellGrantAbilityCanonical296(raw []byte) ([]byte, error) {
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, err
	}
	var output bytes.Buffer
	var appendValue func(any) error
	appendString := func(text string) {
		output.WriteByte('"')
		for _, character := range text {
			switch character {
			case '"', '\\':
				output.WriteByte('\\')
				output.WriteRune(character)
			case '\b':
				output.WriteString(`\b`)
			case '\f':
				output.WriteString(`\f`)
			case '\n':
				output.WriteString(`\n`)
			case '\r':
				output.WriteString(`\r`)
			case '\t':
				output.WriteString(`\t`)
			default:
				if character < 0x20 {
					fmt.Fprintf(&output, `\u%04x`, character)
				} else {
					output.WriteRune(character)
				}
			}
		}
		output.WriteByte('"')
	}
	appendValue = func(value any) error {
		switch typed := value.(type) {
		case map[string]any:
			keys := make([]string, 0, len(typed))
			for key := range typed {
				keys = append(keys, key)
			}
			sort.Slice(keys, func(left, right int) bool {
				leftIndex, leftNumeric := spellGrantArrayIndex296(keys[left])
				rightIndex, rightNumeric := spellGrantArrayIndex296(keys[right])
				if leftNumeric || rightNumeric {
					if leftNumeric != rightNumeric {
						return leftNumeric
					}
					return leftIndex < rightIndex
				}
				return strings.Compare(string(utf16SortUnits296(keys[left])), string(utf16SortUnits296(keys[right]))) < 0
			})
			output.WriteByte('{')
			for index, key := range keys {
				if index > 0 {
					output.WriteByte(',')
				}
				appendString(key)
				output.WriteByte(':')
				if err := appendValue(typed[key]); err != nil {
					return err
				}
			}
			output.WriteByte('}')
		case []any:
			output.WriteByte('[')
			for index, item := range typed {
				if index > 0 {
					output.WriteByte(',')
				}
				if err := appendValue(item); err != nil {
					return err
				}
			}
			output.WriteByte(']')
		case string:
			appendString(typed)
		default:
			if number, ok := value.(float64); ok && (math.IsInf(number, 0) || math.IsNaN(number)) {
				return fmt.Errorf("non-finite combat repair JSON number")
			}
			if number, ok := value.(float64); ok && number == 0 {
				output.WriteByte('0')
				return nil
			}
			encoded, err := json.Marshal(value)
			if err != nil {
				return err
			}
			output.Write(encoded)
		}
		return nil
	}
	if err := appendValue(value); err != nil {
		return nil, err
	}
	return output.Bytes(), nil
}

// JSON.stringify enumerates canonical array-index object keys first. The
// previous migration helper remains unchanged to preserve applied receipts.
func spellGrantArrayIndex296(key string) (uint64, bool) {
	number, err := strconv.ParseUint(key, 10, 32)
	return number, err == nil && number < 4294967295 && strconv.FormatUint(number, 10) == key
}

func utf16SortUnits296(value string) []byte {
	units := utf16.Encode([]rune(value))
	encoded := make([]byte, 0, len(units)*2)
	for _, unit := range units {
		encoded = append(encoded, byte(unit>>8), byte(unit))
	}
	return encoded
}

func spellGrantAbilityHash296(raw []byte) (string, error) {
	encoded, err := spellGrantAbilityCanonical296(raw)
	if err != nil {
		return "", err
	}
	return levelTwoCertificationHash(string(encoded)), nil
}
