package main

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"sync"

	"gorm.io/gorm"
)

const maxReceiptJSONBytes = 64 << 20

// Reset detaches every private output buffer before a compressor is reused.
// The stored gzip representation and the historical reader remain unchanged.
var receiptCompressors = sync.Pool{New: func() any {
	writer, _ := gzip.NewWriterLevel(io.Discard, gzip.BestSpeed)
	return writer
}}

// ReceiptStorage is an additive representation of the exact accepted JSON.
// Version 1 retains the existing JSONB. Version 2 never consults current state.
// Disabling the writer leaves the dual reader available for previous receipts.
type ReceiptStorage struct {
	ResponseVersion int    `json:"-" gorm:"not null;default:1"`
	ResponsePayload []byte `json:"-" gorm:"type:bytea"`
	ResponseSHA256  string `json:"-" gorm:"type:varchar(64);not null;default:''"`
	ResponseLength  int    `json:"-" gorm:"not null;default:0"`
}

func (storage *ReceiptStorage) encode(response *JSONMap, enabled bool) error {
	if storage.ResponseVersion > 1 || len(storage.ResponsePayload) != 0 || storage.ResponseSHA256 != "" || storage.ResponseLength != 0 {
		return fmt.Errorf("receipt storage must be created from an unencoded response")
	}
	storage.ResponseVersion = 1
	if !enabled {
		return nil
	}
	raw, err := json.Marshal(*response)
	if err != nil {
		return fmt.Errorf("receipt JSON encoding failed")
	}
	// Small or unusually large responses retain the proven legacy representation.
	if len(raw) < 1024 || len(raw) > maxReceiptJSONBytes {
		return nil
	}
	var compressed bytes.Buffer
	writer := receiptCompressors.Get().(*gzip.Writer)
	writer.Reset(&compressed)
	defer func() {
		writer.Reset(io.Discard)
		receiptCompressors.Put(writer)
	}()
	if _, err = writer.Write(raw); err != nil {
		return fmt.Errorf("receipt compression failed")
	}
	if err = writer.Close(); err != nil {
		return fmt.Errorf("receipt compression failed")
	}
	if compressed.Len()+128 >= len(raw) {
		return nil
	}
	storage.ResponseVersion = 2
	storage.ResponsePayload = compressed.Bytes()
	storage.ResponseSHA256 = fmt.Sprintf("%x", sha256.Sum256(raw))
	storage.ResponseLength = len(raw)
	*response = JSONMap{}
	return nil
}

func (storage ReceiptStorage) decode(response *JSONMap) error {
	if storage.ResponseVersion == 0 || storage.ResponseVersion == 1 {
		if len(storage.ResponsePayload) != 0 || storage.ResponseLength != 0 || storage.ResponseSHA256 != "" {
			return fmt.Errorf("invalid legacy receipt storage")
		}
		return nil
	}
	if storage.ResponseVersion != 2 || storage.ResponseLength < 1 || storage.ResponseLength > maxReceiptJSONBytes || len(storage.ResponsePayload) == 0 || len(storage.ResponsePayload) > maxReceiptJSONBytes {
		return fmt.Errorf("unsupported or invalid receipt storage")
	}
	reader, err := gzip.NewReader(bytes.NewReader(storage.ResponsePayload))
	if err != nil {
		return fmt.Errorf("invalid receipt compression")
	}
	raw, err := io.ReadAll(io.LimitReader(reader, int64(storage.ResponseLength)+1))
	closeErr := reader.Close()
	if err != nil || closeErr != nil || len(raw) != storage.ResponseLength || fmt.Sprintf("%x", sha256.Sum256(raw)) != storage.ResponseSHA256 {
		return fmt.Errorf("receipt integrity check failed")
	}
	var decoded JSONMap
	if err = json.Unmarshal(raw, &decoded); err != nil || decoded == nil {
		return fmt.Errorf("invalid receipt JSON")
	}
	*response = decoded
	return nil
}

func (receipt *RoguelikeCommandReceipt) encodeStorage(ctx context.Context) error {
	defer performanceSince(ctx, "receipt_encode_ms")()
	err := receipt.ReceiptStorage.encode(&receipt.Response, os.Getenv("DB_COMPACT_RECEIPTS") == "1")
	performanceAdd(ctx, "receipt_encoded_bytes", float64(len(receipt.ResponsePayload)))
	return err
}

// The accepted DTO is immutable. Encoding can overlap the row writes, but must
// finish successfully before receipt insertion and transaction commit. Joining
// even on a SQL failure keeps the encoder inside the persistence lifetime.
func (receipt *RoguelikeCommandReceipt) prepareStorage(ctx context.Context) func() error {
	done := make(chan struct{})
	var err error
	go func() {
		err = receipt.encodeStorage(ctx)
		receipt.storagePrepared = err == nil
		close(done)
	}()
	return func() error { <-done; return err }
}

func (receipt *RoguelikeCommandReceipt) BeforeCreate(tx *gorm.DB) error {
	if receipt.storagePrepared {
		receipt.storagePrepared = false
		return nil
	}
	return receipt.encodeStorage(tx.Statement.Context)
}
func (receipt *RoguelikeCommandReceipt) AfterFind(_ *gorm.DB) error {
	return receipt.ReceiptStorage.decode(&receipt.Response)
}
func (receipt *RoguelikeCommandReceipt) AfterCreate(_ *gorm.DB) error {
	if receipt.omitResponseReload {
		return nil
	}
	return receipt.ReceiptStorage.decode(&receipt.Response)
}
func (receipt *CharacterRuntimeCommandRecord) BeforeCreate(tx *gorm.DB) error {
	defer performanceSince(tx.Statement.Context, "receipt_encode_ms")()
	err := receipt.ReceiptStorage.encode(&receipt.Response, os.Getenv("DB_COMPACT_RECEIPTS") == "1")
	performanceAdd(tx.Statement.Context, "receipt_encoded_bytes", float64(len(receipt.ResponsePayload)))
	return err
}
func (receipt *CharacterRuntimeCommandRecord) AfterFind(_ *gorm.DB) error {
	return receipt.ReceiptStorage.decode(&receipt.Response)
}
func (receipt *CharacterRuntimeCommandRecord) AfterCreate(_ *gorm.DB) error {
	return receipt.ReceiptStorage.decode(&receipt.Response)
}
