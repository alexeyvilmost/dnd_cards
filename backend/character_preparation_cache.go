package main

import (
	"bytes"
	"container/list"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strconv"
	"sync"
	"unsafe"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// The existing worker canonicalStringify inserts lexicographically sorted keys
// into an ordinary JS object, after which JSON.stringify enumerates array-index
// keys numerically first. Keep that historical serializer intact. This adapter
// matches it only for the consumed-catalog proof, reusing the strict primitive
// encoder; DB03 identity remains its separately versioned go-json-v1 format.
func workerCatalogHash(value any) (string, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	decoded, err := decodeUniqueJSON(raw)
	if err != nil {
		return "", err
	}
	return workerCatalogHashDecoded(decoded)
}

// Only already-parsed JSON maps, arrays and primitives enter this adapter.
func workerCatalogHashDecoded(decoded any) (string, error) {
	raw, err := workerCatalogJSONDecoded(decoded)
	if err != nil {
		return "", err
	}
	return canonicalSHA256(raw), nil
}
func workerCatalogJSONDecoded(decoded any, limits ...int) ([]byte, error) {
	var output bytes.Buffer
	var appendValue func(any) error
	index := func(key string) (uint64, bool) {
		if len(key) == 0 || len(key) > 10 || key[0] < '0' || key[0] > '9' || (len(key) > 1 && key[0] == '0') {
			return 0, false
		}
		for i := 1; i < len(key); i++ {
			if key[i] < '0' || key[i] > '9' {
				return 0, false
			}
		}

		n, err := strconv.ParseUint(key, 10, 32)
		return n, err == nil && n < 4294967295 && strconv.FormatUint(n, 10) == key
	}
	appendValue = func(value any) error {
		if len(limits) > 0 && output.Len() > limits[0] {
			return fmt.Errorf("canonical worker value too large")
		}
		switch typed := value.(type) {
		case map[string]any:
			keys := make([]string, 0, len(typed))
			for key := range typed {
				keys = append(keys, key)
			}
			sort.Slice(keys, func(i, j int) bool {
				a, ai := index(keys[i])
				b, bi := index(keys[j])
				if ai && bi {
					return a < b
				}
				if ai != bi {
					return ai
				}
				return compareUTF16(keys[i], keys[j]) < 0
			})
			output.WriteByte('{')
			for i, key := range keys {
				if i > 0 {
					output.WriteByte(',')
				}
				if err := appendCanonicalJSONString(&output, key); err != nil {
					return err
				}
				output.WriteByte(':')
				if err := appendValue(typed[key]); err != nil {
					return err
				}
			}
			output.WriteByte('}')
			return nil
		case []any:
			output.WriteByte('[')
			for i, item := range typed {
				if i > 0 {
					output.WriteByte(',')
				}
				if err := appendValue(item); err != nil {
					return err
				}
			}
			output.WriteByte(']')
			return nil
		default:
			return appendCanonicalJSON(&output, value)
		}
	}
	if err := appendValue(decoded); err != nil {
		return nil, err
	}
	if len(limits) > 0 && output.Len() > limits[0] {
		return nil, fmt.Errorf("canonical worker value too large")
	}
	return output.Bytes(), nil
}

type roguelikeCatalogSelection struct {
	Version  int `json:"version"`
	Entities []struct {
		EntityType string `json:"entityType"`
		ID         string `json:"id"`
	} `json:"entities"`
	EffectTypes []string              `json:"effectTypes"`
	Variables   bool                  `json:"variables"`
	Reads       []roguelikeWorkerNeed `json:"reads"`
}

// Contains immutable declarations only. Never stores a participant, runtime,
// random seed, command or prepared patch. Every request decodes its own copy.
type preparationCatalogEntry struct {
	Hint, ContentHash, Fingerprint, Artifact, ManifestHash string
	Payload                                                []byte
	BasicIDs                                               []string
	Needs                                                  []roguelikeWorkerNeed
	chargedBytes                                           int
}

func preparationCatalogCharge(entry preparationCatalogEntry) int {
	// Count owned backing bytes AND Go string/slice headers. The fixed margin
	// covers the LRU node and map entry; shared strings are conservatively charged
	// twice. This bounds retained entry storage, not all request/allocator memory.
	charge := int(unsafe.Sizeof(entry)) + 128 + len(entry.Hint) + len(entry.ContentHash) + len(entry.Fingerprint) + len(entry.Artifact) + len(entry.ManifestHash) + len(entry.Payload)
	charge += len(entry.BasicIDs)*int(unsafe.Sizeof("")) + len(entry.Needs)*int(unsafe.Sizeof(roguelikeWorkerNeed{}))
	for _, id := range entry.BasicIDs {
		charge += len(id)
	}
	for _, need := range entry.Needs {
		charge += len(need.Kind) + len(need.EntityType) + len(need.Reference) + len(need.EffectType)
	}
	return charge
}

type preparationCatalogLRU struct {
	mu                          sync.Mutex
	maxBytes, maxEntries, bytes int
	rows                        map[string]*list.Element
	order                       *list.List
}

func newPreparationCatalogLRU(maxBytes, maxEntries int) *preparationCatalogLRU {
	return &preparationCatalogLRU{maxBytes: maxBytes, maxEntries: maxEntries, rows: map[string]*list.Element{}, order: list.New()}
}

var characterPreparationCatalogs = newPreparationCatalogLRU(8<<20, 128)

func preparationReadsCovered(proven, requested []roguelikeWorkerNeed) bool {
	index := map[roguelikeWorkerNeed]bool{}
	for _, need := range proven {
		index[need] = true
	}
	for _, need := range requested {
		if !index[need] {
			return false
		}
	}
	return true
}

func (cache *preparationCatalogLRU) get(hint string) *preparationCatalogEntry {
	cache.mu.Lock()
	defer cache.mu.Unlock()
	if element := cache.rows[hint]; element != nil {
		cache.order.MoveToFront(element)
		// Entry bytes are immutable after publication. No caller receives a map
		// backed by another request; json.Unmarshal below allocates a fresh tree.
		copy := *element.Value.(*preparationCatalogEntry)
		copy.Payload = append([]byte(nil), copy.Payload...)
		copy.Needs = append([]roguelikeWorkerNeed(nil), copy.Needs...)
		copy.BasicIDs = append([]string(nil), copy.BasicIDs...)
		return &copy
	}
	return nil
}
func (cache *preparationCatalogLRU) put(entry preparationCatalogEntry) {
	cache.mu.Lock()
	defer cache.mu.Unlock()
	entry.chargedBytes = preparationCatalogCharge(entry)
	if entry.chargedBytes > cache.maxBytes || cache.maxEntries < 1 {
		return
	}
	if old := cache.rows[entry.Hint]; old != nil {
		cache.bytes -= old.Value.(*preparationCatalogEntry).chargedBytes
		cache.order.Remove(old)
		delete(cache.rows, entry.Hint)
	}
	entry.Payload = append([]byte(nil), entry.Payload...)
	entry.BasicIDs = append([]string(nil), entry.BasicIDs...)
	entry.Needs = append([]roguelikeWorkerNeed(nil), entry.Needs...)
	cache.rows[entry.Hint] = cache.order.PushFront(&entry)
	cache.bytes += entry.chargedBytes
	for cache.bytes > cache.maxBytes || len(cache.rows) > cache.maxEntries {
		old := cache.order.Back()
		entry := old.Value.(*preparationCatalogEntry)
		cache.bytes -= entry.chargedBytes
		delete(cache.rows, entry.Hint)
		cache.order.Remove(old)
	}
}

func preparationCatalogHint(tx *gorm.DB, callerID uuid.UUID, character CharacterV3) (string, error) {
	db, err := tx.DB()
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%p/%s/%s/%s", db, callerID, character.UserID, character.ID), nil
}
func preparationCatalogHash(catalog roguelikeFrozenCatalog, owner uuid.UUID, artifact string) (string, error) {
	payload, err := mapFromJSON(catalog)
	if err != nil {
		return "", err
	}
	// Same serializer/owner/artifact/content identity as DB03; fresh-cache
	// fingerprints are separate from durable historical snapshot identity.
	return frozenCatalogHash(FrozenCombatCatalog{UserID: owner, SerializerVersion: 1, ProtocolVersion: 1, ArtifactHash: artifact, Payload: payload})
}

func validatedPreparationCatalog(ctx context.Context, tx *gorm.DB, callerID uuid.UUID, character CharacterV3) (*preparationCatalogEntry, *roguelikeFrozenCatalog, error) {
	if os.Getenv("RULES_PREPARATION_CACHE_ENABLED") != "1" {
		return nil, nil, nil
	}
	done := performanceSince(ctx, "preparation_cache_validate_ms")
	defer done()
	hint, err := preparationCatalogHint(tx, callerID, character)
	if err != nil {
		return nil, nil, err
	}
	entry := characterPreparationCatalogs.get(hint)
	if entry == nil {
		performanceAdd(ctx, "preparation_cache_miss", 1)
		return nil, nil, nil
	}
	// The caller has already authorized this fresh owned character. The proof
	// includes persistent caller/owner rows and configured policy on every hit.
	fingerprint, err := equipmentCatalogFingerprint(tx, entry.Needs, []uuid.UUID{callerID, character.UserID}, true)
	if err != nil {
		return nil, nil, err
	}
	if fingerprint != entry.Fingerprint {
		performanceAdd(ctx, "preparation_cache_stale", 1)
		return nil, nil, nil
	}
	var catalog roguelikeFrozenCatalog
	if err = json.Unmarshal(entry.Payload, &catalog); err != nil {
		return nil, nil, err
	}
	hash, err := preparationCatalogHash(catalog, character.UserID, entry.Artifact)
	if err != nil || hash != entry.ContentHash {
		return nil, nil, fmt.Errorf("immutable preparation catalog integrity failed")
	}
	performanceAdd(ctx, "preparation_cache_candidate", 1)
	return entry, &catalog, nil
}

func selectPreparationCatalog(catalog roguelikeFrozenCatalog, selection *roguelikeCatalogSelection) (roguelikeFrozenCatalog, error) {
	if selection == nil || selection.Version != 1 || len(selection.Entities) > 4096 || len(selection.Reads) > 4096 {
		return catalog, fmt.Errorf("invalid consumed catalog selection")
	}
	selected := emptyRoguelikeFrozenCatalog()
	seen := map[string]bool{}
	for _, ref := range selection.Entities {
		key := ref.EntityType + "/" + ref.ID
		if seen[key] {
			return selected, fmt.Errorf("duplicate consumed catalog entity")
		}
		seen[key] = true
		found := false
		for _, row := range catalog.Entities[ref.EntityType] {
			if row["id"] == ref.ID {
				selected.Entities[ref.EntityType] = append(selected.Entities[ref.EntityType], row)
				found = true
				break
			}
		}
		if !found {
			return selected, fmt.Errorf("consumed catalog entity absent")
		}
	}
	for kind := range selected.Entities {
		sort.Slice(selected.Entities[kind], func(i, j int) bool {
			return selected.Entities[kind][i]["id"].(string) < selected.Entities[kind][j]["id"].(string)
		})
	}
	if selection.Variables {
		if !catalog.VariablesComplete {
			return selected, fmt.Errorf("consumed variables incomplete")
		}
		selected.Variables = catalog.Variables
		selected.VariablesComplete = true
	}
	for _, kind := range selection.EffectTypes {
		found := false
		for _, loaded := range catalog.CompleteEffectTypes {
			if loaded == kind {
				found = true
				break
			}
		}
		if !found {
			return selected, fmt.Errorf("consumed effect membership incomplete")
		}
		selected.CompleteEffectTypes = append(selected.CompleteEffectTypes, kind)
	}
	sort.Strings(selected.CompleteEffectTypes)
	return selected, nil
}

func rememberPreparationCatalog(ctx context.Context, tx *gorm.DB, callerID uuid.UUID, character CharacterV3, catalog roguelikeFrozenCatalog, ids []string, result *roguelikeWorkerResult, candidate *preparationCatalogEntry) error {
	if os.Getenv("RULES_PREPARATION_CACHE_ENABLED") != "1" || result.CatalogSelection == nil {
		return nil
	}
	if candidate != nil && candidate.Artifact == result.ArtifactHash && candidate.ManifestHash == result.ContentManifestHash &&
		preparationReadsCovered(candidate.Needs, result.CatalogSelection.Reads) && preparationReadsCovered(result.CatalogSelection.Reads, candidate.Needs) {
		// This request already checked every byte/membership/right in the same
		// read snapshot. Identical consumed content/selectors need no second
		// proof query, reserialization or immutable entry publication.
		performanceAdd(ctx, "preparation_cache_retained", 1)
		return nil
	}
	done := performanceSince(ctx, "preparation_cache_publish_ms")
	defer done()
	selected, err := selectPreparationCatalog(catalog, result.CatalogSelection)
	if err != nil {
		return err
	}
	fingerprint, err := equipmentCatalogFingerprint(tx, result.CatalogSelection.Reads, []uuid.UUID{callerID, character.UserID}, true)
	if err != nil {
		return err
	}
	hint, err := preparationCatalogHint(tx, callerID, character)
	if err != nil {
		return err
	}
	// A worker manifest alone cannot authorize reuse. The key also covers this
	// caller's independently verified complete row/membership/policy fingerprint,
	// owner, artifact, schema and exact selectors. No transaction is shared.
	key := equipmentInputHash([]any{callerID, character.UserID, result.ArtifactHash, selected.SchemaVersion, result.ContentManifestHash, fingerprint, ids, result.CatalogSelection})
	entry, joined, err := characterPreparationFlights.do(ctx, key, func() (preparationCatalogEntry, error) {
		workerHash, err := workerCatalogHash(selected)
		if err != nil || workerHash != result.ContentManifestHash {
			return preparationCatalogEntry{}, fmt.Errorf("consumed catalog hash mismatch")
		}
		hash, err := preparationCatalogHash(selected, character.UserID, result.ArtifactHash)
		if err != nil {
			return preparationCatalogEntry{}, err
		}
		payload, err := json.Marshal(selected)
		if err != nil {
			return preparationCatalogEntry{}, err
		}
		return preparationCatalogEntry{ContentHash: hash, Fingerprint: fingerprint, Artifact: result.ArtifactHash, ManifestHash: result.ContentManifestHash, Payload: payload, BasicIDs: ids, Needs: result.CatalogSelection.Reads}, nil
	})
	if err != nil {
		return err
	}
	if joined {
		performanceAdd(ctx, "preparation_cache_processing_joined", 1)
	}
	entry.Hint = hint
	characterPreparationCatalogs.put(entry)
	performanceAdd(ctx, "preparation_cache_published_bytes", float64(len(entry.Payload)))
	return nil
}
