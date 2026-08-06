package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"sort"
	"strconv"
	"unicode/utf16"
	"unicode/utf8"
)

var errCanonicalJSONDuplicateKey = errors.New("canonical JSON contains a duplicate object key")

// decodeUniqueJSON decodes JSON with json.Number precision at the parser
// boundary and rejects duplicate object keys. encoding/json normally accepts
// the last duplicate, which would make a signed/hash-checked request
// ambiguous before canonicalization.
func decodeUniqueJSON(raw []byte) (any, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	value, err := decodeUniqueJSONValue(decoder)
	if err != nil {
		return nil, err
	}
	if token, err := decoder.Token(); err != io.EOF {
		if err != nil {
			return nil, err
		}
		return nil, fmt.Errorf("unexpected trailing JSON token %v", token)
	}
	return value, nil
}

func decodeUniqueJSONValue(decoder *json.Decoder) (any, error) {
	token, err := decoder.Token()
	if err != nil {
		return nil, err
	}
	delimiter, isDelimiter := token.(json.Delim)
	if !isDelimiter {
		return token, nil
	}

	switch delimiter {
	case '{':
		object := make(map[string]any)
		for decoder.More() {
			keyToken, err := decoder.Token()
			if err != nil {
				return nil, err
			}
			key, ok := keyToken.(string)
			if !ok {
				return nil, errors.New("JSON object key is not a string")
			}
			if _, exists := object[key]; exists {
				return nil, fmt.Errorf("%w: %q", errCanonicalJSONDuplicateKey, key)
			}
			value, err := decodeUniqueJSONValue(decoder)
			if err != nil {
				return nil, err
			}
			object[key] = value
		}
		end, err := decoder.Token()
		if err != nil {
			return nil, err
		}
		if end != json.Delim('}') {
			return nil, errors.New("unterminated JSON object")
		}
		return object, nil
	case '[':
		array := make([]any, 0)
		for decoder.More() {
			value, err := decodeUniqueJSONValue(decoder)
			if err != nil {
				return nil, err
			}
			array = append(array, value)
		}
		end, err := decoder.Token()
		if err != nil {
			return nil, err
		}
		if end != json.Delim(']') {
			return nil, errors.New("unterminated JSON array")
		}
		return array, nil
	default:
		return nil, fmt.Errorf("unexpected JSON delimiter %q", delimiter)
	}
}

// canonicalJSON implements the rules-core canonicalStringify contract for
// JSON values: object keys are ordered as JavaScript UTF-16 strings, numbers
// use ECMAScript-compatible encoding/json formatting, and non-ASCII text is
// retained as UTF-8. The request boundary has no undefined/bigint values, so
// the JSON domain is the complete supported domain here.
func canonicalJSON(value any) ([]byte, error) {
	var output bytes.Buffer
	if err := appendCanonicalJSON(&output, value); err != nil {
		return nil, err
	}
	return output.Bytes(), nil
}

func appendCanonicalJSON(output *bytes.Buffer, value any) error {
	switch typed := value.(type) {
	case nil:
		output.WriteString("null")
	case bool:
		if typed {
			output.WriteString("true")
		} else {
			output.WriteString("false")
		}
	case string:
		return appendCanonicalJSONString(output, typed)
	case json.Number:
		floatValue, err := strconv.ParseFloat(string(typed), 64)
		if err != nil || math.IsInf(floatValue, 0) || math.IsNaN(floatValue) {
			return fmt.Errorf("canonical JSON contains an invalid number %q", typed)
		}
		if floatValue == 0 {
			output.WriteByte('0')
			break
		}
		encoded, err := json.Marshal(floatValue)
		if err != nil {
			return err
		}
		output.Write(encoded)
	case float64:
		if math.IsInf(typed, 0) || math.IsNaN(typed) {
			return errors.New("canonical JSON contains a non-finite number")
		}
		if typed == 0 {
			output.WriteByte('0')
			break
		}
		encoded, err := json.Marshal(typed)
		if err != nil {
			return err
		}
		output.Write(encoded)
	case int:
		output.WriteString(strconv.Itoa(typed))
	case int64:
		output.WriteString(strconv.FormatInt(typed, 10))
	case int32:
		output.WriteString(strconv.FormatInt(int64(typed), 10))
	case uint:
		output.WriteString(strconv.FormatUint(uint64(typed), 10))
	case uint64:
		output.WriteString(strconv.FormatUint(typed, 10))
	case uint32:
		output.WriteString(strconv.FormatUint(uint64(typed), 10))
	case []any:
		output.WriteByte('[')
		for index, item := range typed {
			if index > 0 {
				output.WriteByte(',')
			}
			if err := appendCanonicalJSON(output, item); err != nil {
				return err
			}
		}
		output.WriteByte(']')
	case map[string]any:
		keys := make([]string, 0, len(typed))
		for key := range typed {
			keys = append(keys, key)
		}
		sort.Slice(keys, func(left, right int) bool {
			return compareUTF16(keys[left], keys[right]) < 0
		})
		output.WriteByte('{')
		for index, key := range keys {
			if index > 0 {
				output.WriteByte(',')
			}
			if err := appendCanonicalJSONString(output, key); err != nil {
				return err
			}
			output.WriteByte(':')
			if err := appendCanonicalJSON(output, typed[key]); err != nil {
				return err
			}
		}
		output.WriteByte('}')
	default:
		return fmt.Errorf("canonical JSON cannot contain %T", value)
	}
	return nil
}

func compareUTF16(left, right string) int {
	leftUnits := utf16.Encode([]rune(left))
	rightUnits := utf16.Encode([]rune(right))
	limit := len(leftUnits)
	if len(rightUnits) < limit {
		limit = len(rightUnits)
	}
	for index := 0; index < limit; index++ {
		if leftUnits[index] < rightUnits[index] {
			return -1
		}
		if leftUnits[index] > rightUnits[index] {
			return 1
		}
	}
	if len(leftUnits) < len(rightUnits) {
		return -1
	}
	if len(leftUnits) > len(rightUnits) {
		return 1
	}
	return 0
}

func appendCanonicalJSONString(output *bytes.Buffer, value string) error {
	if !utf8.ValidString(value) {
		return errors.New("canonical JSON contains invalid UTF-8")
	}
	output.WriteByte('"')
	for _, character := range value {
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
				fmt.Fprintf(output, `\u%04x`, character)
			} else {
				output.WriteRune(character)
			}
		}
	}
	output.WriteByte('"')
	return nil
}

func canonicalizeRawJSON(raw []byte) (any, []byte, error) {
	value, err := decodeUniqueJSON(raw)
	if err != nil {
		return nil, nil, err
	}
	canonical, err := canonicalJSON(value)
	if err != nil {
		return nil, nil, err
	}
	return value, canonical, nil
}

func canonicalSHA256(canonical []byte) string {
	digest := sha256.Sum256(canonical)
	return "sha256:" + hex.EncodeToString(digest[:])
}
