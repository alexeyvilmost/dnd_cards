package main

import (
	"fmt"
	"strings"
)

const (
	maxEncounterApplyBodyBytes   int64 = 256 << 10
	maxEncounterApplyArrayItems        = 128
	maxEncounterLogMessageBytes        = 4 << 10
	maxEncounterLegacyEventBytes       = 4 << 10
)

// validateEncounterApplyEnvelope bounds the client-authoritative relay before
// it opens a transaction. Legacy events are documented free-form log strings;
// structured log payloads use the same EngineEvent validator as CharacterV3.
func validateEncounterApplyEnvelope(req ApplyRequest) error {
	for _, field := range []struct {
		name  string
		count int
	}{
		{name: "patches", count: len(req.Patches)},
		{name: "add", count: len(req.Add)},
		{name: "remove", count: len(req.Remove)},
		{name: "events", count: len(req.Events)},
		{name: "log", count: len(req.Log)},
	} {
		if field.count > maxEncounterApplyArrayItems {
			return fmt.Errorf("%s: no more than %d items are allowed", field.name, maxEncounterApplyArrayItems)
		}
	}

	for index, raw := range req.Events {
		message, ok := raw.(string)
		if !ok || len(message) > maxEncounterLegacyEventBytes {
			return fmt.Errorf("events[%d]: must be a bounded legacy log string", index)
		}
	}

	for index, entry := range req.Log {
		path := fmt.Sprintf("log[%d]", index)
		if len(entry.Message) > maxEncounterLogMessageBytes {
			return fmt.Errorf("%s.message: is too large", path)
		}
		if len(entry.TargetCharacterID) > 64 {
			return fmt.Errorf("%s.targetCharacterId: is too large", path)
		}

		hasPayload := entry.Payload != nil
		hasType := strings.TrimSpace(entry.Type) != ""
		hasTarget := strings.TrimSpace(entry.TargetCharacterID) != ""
		if !hasPayload {
			if hasType || hasTarget {
				return fmt.Errorf("%s: structured character log requires both type and payload", path)
			}
			continue
		}
		if !hasType {
			return fmt.Errorf("%s.type: is required when payload is present", path)
		}
		if err := validateCharacterEvent(entry.Type, entry.Payload); err != nil {
			return fmt.Errorf("%s: %w", path, err)
		}
	}
	return nil
}
