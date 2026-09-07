package main

import (
	"crypto/sha256"
	"fmt"
	"regexp"

	"gorm.io/gorm"
)

var roguelikeSnapshotHash = regexp.MustCompile(`^sha256:[a-f0-9]{64}$`)

func roguelikeCombatJournalKey(envelope JSONMap) (string, error) {
	var identity struct {
		ArtifactHash string `json:"artifactHash"`
		Entropy      struct {
			Seed string `json:"seed"`
		} `json:"entropy"`
	}
	if err := decodeJSONMap(envelope, &identity); err != nil {
		return "", err
	}
	if identity.Entropy.Seed == "" || !roguelikeSnapshotHash.MatchString(identity.ArtifactHash) {
		return "", fmt.Errorf("invalid combat journal identity")
	}
	return fmt.Sprintf("%x", sha256.Sum256([]byte(identity.ArtifactHash+":"+identity.Entropy.Seed))), nil
}

func roguelikeCombatJournalRecord(request RoguelikeCommandRequest, before JSONMap, result *roguelikeWorkerResult, first bool) (JSONMap, error) {
	afterHash, _ := result.Trace["afterHash"].(string)
	beforeHash, _ := result.Trace["beforeHash"].(string)
	if !roguelikeSnapshotHash.MatchString(afterHash) || (request.Type != "initialize_combat" && !roguelikeSnapshotHash.MatchString(beforeHash)) {
		return nil, fmt.Errorf("missing verifiable combat trace")
	}
	record := JSONMap{"schemaVersion": 1, "type": request.Type, "intent": request.Payload["intent"],
		"artifactHash": result.Envelope["artifactHash"], "beforeHash": beforeHash, "afterHash": afterHash,
		"randomValues": result.RandomValues, "runtimeRevision": result.Trace["runtimeRevision"]}
	if request.Type == "initialize_combat" {
		record["baseline"] = result.Envelope
		record["baselinePosition"] = "after"
	} else if first {
		// Existing battles acquire a replay baseline on their first accepted command
		// after rollout; no seed reset, catalog migration or historical claim.
		record["baseline"] = before
		record["baselinePosition"] = "before"
	}
	return record, nil
}

func appendRoguelikeCombatEvent(tx *gorm.DB, run *RoguelikeRun, request RoguelikeCommandRequest, before JSONMap, result *roguelikeWorkerResult) error {
	key, err := roguelikeCombatJournalKey(result.Envelope)
	if err != nil {
		return err
	}
	var count int64
	if err = tx.Model(&RoguelikeCombatEvent{}).Where("run_id = ? AND combat_key = ?", run.ID, key).Count(&count).Error; err != nil {
		return err
	}
	record, err := roguelikeCombatJournalRecord(request, before, result, count == 0)
	if err != nil {
		return err
	}
	encounterNumber, _ := numberFromJSON(run.Encounter["number"])
	return tx.Create(&RoguelikeCombatEvent{RunID: run.ID, CommandID: request.CommandID, Revision: run.Revision,
		CombatKey: key, Attempt: run.Attempt, EncounterNumber: int(encounterNumber), Record: record}).Error
}
