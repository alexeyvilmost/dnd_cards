package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

func TestReceiptStorageExactDualReadAndIntegrity(t *testing.T) {
	for _, enabled := range []bool{false, true} {
		expected := JSONMap{"run": JSONMap{"revision": 17, "description": strings.Repeat("Сохранённый расчёт КД ", 1000), "pending": JSONMap{"source": "immutable"}}}
		before, _ := json.Marshal(expected)
		var storage ReceiptStorage
		if err := storage.encode(&expected, enabled); err != nil {
			t.Fatal(err)
		}
		if enabled && (storage.ResponseVersion != 2 || len(expected) != 0) {
			t.Fatal("compact writer was not selected")
		}
		if err := storage.decode(&expected); err != nil {
			t.Fatal(err)
		}
		after, _ := json.Marshal(expected)
		if !bytes.Equal(before, after) {
			t.Fatal("immutable response changed")
		}
		if enabled {
			for _, mutate := range []func(*ReceiptStorage){
				func(s *ReceiptStorage) { s.ResponseVersion = 3 },
				func(s *ReceiptStorage) { s.ResponseLength-- },
				func(s *ReceiptStorage) { s.ResponseLength = maxReceiptJSONBytes + 1 },
				func(s *ReceiptStorage) { s.ResponseSHA256 = strings.Repeat("0", 64) },
				func(s *ReceiptStorage) { s.ResponsePayload = []byte("broken") },
			} {
				broken := storage
				mutate(&broken)
				if err := broken.decode(&expected); err == nil {
					t.Fatal("corrupt receipt accepted")
				}
			}
		}
	}
}

func TestReceiptStorageSmallResponseKeepsLegacy(t *testing.T) {
	response := JSONMap{"accepted": true}
	var storage ReceiptStorage
	if err := storage.encode(&response, true); err != nil {
		t.Fatal(err)
	}
	if storage.ResponseVersion != 1 || response["accepted"] != true {
		t.Fatal("small response was rewritten")
	}
}

func TestReceiptStorageAtomicRollbackAndWriterDisable(t *testing.T) {
	f := openCharacterV3AccessFixture(t)
	if err := f.db.AutoMigrate(&RoguelikeCommandReceipt{}); err != nil {
		t.Fatal(err)
	}
	newReceipt := func() RoguelikeCommandReceipt {
		return RoguelikeCommandReceipt{RunID: uuid.New(), UserID: f.owner.ID, CommandID: uuid.New(), CommandType: "camp_turn", RequestHash: strings.Repeat("a", 64), Request: JSONMap{}, Response: JSONMap{"revision": 2, "text": strings.Repeat("snapshot", 2000)}}
	}
	t.Setenv("DB_COMPACT_RECEIPTS", "0")
	old := newReceipt()
	if err := f.db.Create(&old).Error; err != nil {
		t.Fatal(err)
	}
	var oldBytes string
	if err := f.db.Raw("SELECT response::text FROM roguelike_command_receipts WHERE id=?", old.ID).Scan(&oldBytes).Error; err != nil {
		t.Fatal(err)
	}
	t.Setenv("DB_COMPACT_RECEIPTS", "1")
	failed := newReceipt()
	err := f.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&CharacterV3{}).Where("id=?", f.ownerCharacter.ID).Update("current_hp", 1).Error; err != nil {
			return err
		}
		if err := tx.Create(&failed).Error; err != nil {
			return err
		}
		return errors.New("simulated failure after receipt insertion")
	})
	if err == nil {
		t.Fatal("transaction unexpectedly committed")
	}
	var count int64
	f.db.Model(&RoguelikeCommandReceipt{}).Where("id=?", failed.ID).Count(&count)
	if count != 0 {
		t.Fatal("receipt escaped rolled back transaction")
	}
	var hp int
	f.db.Model(&CharacterV3{}).Select("current_hp").Where("id=?", f.ownerCharacter.ID).Scan(&hp)
	if hp != f.ownerCharacter.CurrentHP {
		t.Fatal("character escaped rolled back transaction")
	}
	current := newReceipt()
	if err := f.db.Create(&current).Error; err != nil {
		t.Fatal(err)
	}
	if current.ResponseVersion != 2 || current.Response["text"] == nil {
		t.Fatal("create return did not restore exact response")
	}
	var stored struct {
		Response        string
		ResponseVersion int
	}
	f.db.Raw("SELECT response::text,response_version FROM roguelike_command_receipts WHERE id=?", current.ID).Scan(&stored)
	if stored.Response != "{}" || stored.ResponseVersion != 2 {
		t.Fatal("compact payload was not stored")
	}
	t.Setenv("DB_COMPACT_RECEIPTS", "0")
	var loaded RoguelikeCommandReceipt
	if err := f.db.First(&loaded, "id=?", current.ID).Error; err != nil {
		t.Fatal(err)
	}
	if loaded.Response["text"] != current.Response["text"] {
		t.Fatal("writer disable broke reader")
	}
	legacy := newReceipt()
	if err := f.db.Create(&legacy).Error; err != nil {
		t.Fatal(err)
	}
	if legacy.ResponseVersion != 1 {
		t.Fatal("writer disable ignored")
	}
	var retained string
	f.db.Raw("SELECT response::text FROM roguelike_command_receipts WHERE id=?", old.ID).Scan(&retained)
	if retained != oldBytes {
		t.Fatal("historical JSON bytes changed")
	}
	if err := f.db.Model(&RoguelikeCommandReceipt{}).Where("id=?", current.ID).Update("response_sha256", strings.Repeat("0", 64)).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.db.First(&loaded, "id=?", current.ID).Error; err == nil {
		t.Fatal("damaged stored receipt did not fail closed")
	}
}

func TestCompactReceiptRestStillCommitsOnce(t *testing.T) {
	t.Setenv("DB_COMPACT_RECEIPTS", "1")
	TestTrustedRoguelikeRestIgnoresClientPatchAndCommitsOnce(t)
}

func TestCompactReceiptConcurrentRetryAndRollback(t *testing.T) {
	t.Setenv("DB_COMPACT_RECEIPTS", "1")
	t.Run("concurrent retry", TestCharacterRuntimeCommandConcurrentRetryCommitsOnce)
	t.Run("journal failure", TestCharacterRuntimeCommandRollsBackEveryProjectionWhenJournalWriteFails)
	t.Run("receipt failure", TestCharacterRuntimeCommandRollsBackProjectionsAndJournalWhenReceiptWriteFails)
	t.Run("request mismatch", TestCharacterRuntimeCommandRejectsIDReuseAndStaleRevisionWithoutPartialWrite)
}
