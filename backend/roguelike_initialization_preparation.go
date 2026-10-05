package main

import (
	"context"
	"database/sql"
	"os"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// An attempt-local authority proof; never serialized into worker input, cached
// as an actor, or used to reinterpret an already accepted combat receipt.
type roguelikeInitializationProof struct {
	Needs      []roguelikeWorkerNeed
	Users      []uuid.UUID
	Rows       []equipmentInputRow
	Stamp      string
	PolicyHash string
}

func staleInitializationInputs() error {
	return roguelikeError(409, "initialization_inputs_stale", "Данные начала боя изменились. Обновите забег и повторите выбор.")
}

func prepareRoguelikeInitialization(ctx context.Context, db *gorm.DB, client roguelikeWorkerClient, run *RoguelikeRun, seed, maneuver string) (*roguelikeWorkerResult, JSONMap, error) {
	var result *roguelikeWorkerResult
	var catalog JSONMap
	err := db.WithContext(ctx).Transaction(func(read *gorm.DB) error {
		fresh, err := ownedRoguelikeRun(read, run.ID, run.UserID, false)
		if err != nil {
			return err
		}
		// Earlier HTTP reads can span several snapshots. Do not prepare a mixed
		// old actor/run input even if its numerical revision did not change.
		if equipmentInputHash(fresh) != equipmentInputHash(run) {
			return staleInitializationInputs()
		}
		proof := &roguelikeInitializationProof{Users: []uuid.UUID{run.UserID}, Rows: []equipmentInputRow{{Table: "roguelike_runs", ID: run.ID}}, PolicyHash: equipmentInputHash(os.Getenv("CONTENT_ADMIN_USER_IDS"))}
		members := fresh.Characters
		if len(members) == 0 && fresh.Character != nil {
			members = []*CharacterV3{fresh.Character}
		}
		for _, member := range members {
			if err := equipmentOwner(read, run.UserID, *member); err != nil {
				return err
			}
			proof.Users = append(proof.Users, member.UserID)
			proof.Rows = append(proof.Rows, equipmentInputRow{Table: "characters_v3", ID: member.ID})
		}
		result, catalog, err = initializeRoguelikeWorker(ctx, read, client, fresh, seed, maneuver)
		if err != nil {
			return err
		}
		proof.Needs = append([]roguelikeWorkerNeed(nil), result.initializationDependencies...)
		proof.Stamp, err = equipmentCatalogFingerprint(read, proof.Needs, proof.Users, true, proof.Rows...)
		if err == nil {
			result.initializationProof = proof
		}
		return err
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, catalog, err
}

// Called after the normal run/member locks and exact receipt lookup, before
// any patch, event or receipt write. There is no worker call below this check.
func validateRoguelikeInitializationProof(tx *gorm.DB, result *roguelikeWorkerResult) error {
	if result == nil || result.initializationProof == nil {
		return staleInitializationInputs()
	}
	proof := result.initializationProof
	if equipmentInputHash(os.Getenv("CONTENT_ADMIN_USER_IDS")) != proof.PolicyHash {
		return staleInitializationInputs()
	}
	stamp, err := equipmentCatalogFingerprint(tx, proof.Needs, proof.Users, true, proof.Rows...)
	if err != nil {
		return err
	}
	if stamp != proof.Stamp {
		return staleInitializationInputs()
	}
	return nil
}
