// Package itemsource classifies library metadata, never gameplay behavior.
// The catalog is a human-reviewed set of exact name/text variants, with a
// fingerprint guard against silently classifying changed rules as original PH.
package itemsource

import (
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
)

const (
	PlayersHandbook            = "Player's Handbook"
	BagOfHolding               = "Bag Of Holding"
	AvailableForPlayersTagID   = "d2620000-0000-4000-8000-000000000001"
	AvailableForPlayersTagName = "Available for Players"
)

//go:embed reviewed_equipment.v1.json
var catalogJSON []byte

type Card struct {
	ID                  string `json:"id,omitempty"`
	CardNumber          string `json:"card_number,omitempty"`
	Name                string `json:"name"`
	NameEN              string `json:"name_en"`
	Description         string `json:"description"`
	DetailedDescription string `json:"detailed_description"`
	RulesFingerprint    string `json:"rules_fingerprint"`
}

type Review struct {
	Card
	Decision string `json:"decision"` // ph, non_ph, ambiguous
	Reason   string `json:"reason"`
}

type Entry struct {
	Key        string   `json:"key"`
	Canonical  string   `json:"canonical"`
	Edition    string   `json:"edition"`
	Section    string   `json:"section"`
	References []string `json:"references"`
	Aliases    []string `json:"aliases"`
	Reviews    []Review `json:"reviews"`
}

type Catalog struct {
	SchemaVersion int               `json:"schema_version"`
	References    map[string]string `json:"references"`
	Entries       []Entry           `json:"entries"`
}

type Result struct {
	Source      string `json:"source"`
	RuleID      string `json:"rule_id,omitempty"`
	Canonical   string `json:"canonical,omitempty"`
	Status      string `json:"status"`
	Reason      string `json:"reason"`
	NeedsReview bool   `json:"needs_review"`
}

type Classifier struct {
	byName map[string][]Entry
	hash   string
}

// Normalize changes case, Russian yo, and whitespace only. It deliberately
// retains punctuation, numbers, negation, markup and added effect clauses.
func Normalize(s string) string {
	return strings.Join(strings.Fields(strings.ReplaceAll(strings.ToLower(s), "ё", "е")), " ")
}

func New() (*Classifier, error) { return newClassifier(catalogJSON) }

func newClassifier(data []byte) (*Classifier, error) {
	var catalog Catalog
	if err := json.Unmarshal(data, &catalog); err != nil {
		return nil, err
	}
	if catalog.SchemaVersion != 1 || len(catalog.Entries) == 0 {
		return nil, fmt.Errorf("unsupported item source catalog")
	}
	digest := sha256.Sum256(data)
	c := &Classifier{byName: map[string][]Entry{}, hash: hex.EncodeToString(digest[:])}
	keys := map[string]bool{}
	decisions := map[[5]string]string{}
	for _, entry := range catalog.Entries {
		if entry.Key == "" || keys[entry.Key] || entry.Canonical == "" || entry.Section == "" || len(entry.References) == 0 {
			return nil, fmt.Errorf("invalid source entry %q", entry.Key)
		}
		keys[entry.Key] = true
		for _, ref := range entry.References {
			if catalog.References[ref] == "" {
				return nil, fmt.Errorf("unknown reference %s", ref)
			}
		}
		aliases := map[string]bool{}
		for _, alias := range append(append([]string(nil), entry.Aliases...), entry.Canonical) {
			aliases[Normalize(alias)] = true
		}
		for _, review := range entry.Reviews {
			guard, err := hex.DecodeString(review.RulesFingerprint)
			if err != nil || len(guard) != sha256.Size || !aliases[Normalize(review.Name)] || review.Reason == "" {
				return nil, fmt.Errorf("invalid review %s/%s", entry.Key, review.CardNumber)
			}
			if review.Decision != "ph" && review.Decision != "non_ph" && review.Decision != "ambiguous" {
				return nil, fmt.Errorf("unknown review decision")
			}
			key := [5]string{Normalize(review.Name), Normalize(review.NameEN), Normalize(review.Description), Normalize(review.DetailedDescription), review.RulesFingerprint}
			decision := entry.Key + "/" + review.Decision
			if previous, exists := decisions[key]; exists && previous != decision {
				return nil, fmt.Errorf("conflicting source reviews for %s", review.CardNumber)
			}
			decisions[key] = decision
		}
		for alias := range aliases {
			if alias == "" {
				return nil, fmt.Errorf("empty name alias")
			}
			c.byName[alias] = append(c.byName[alias], entry)
		}
	}
	return c, nil
}

func (c *Classifier) Hash() string { return c.hash }

// Classify does not consult card IDs, previous sources, prices, rarity, tags or
// template status. Repriced duplicates with another ID get the same decision.
// New paraphrases require explicit review; this is not a fuzzy-language oracle.
func (c *Classifier) Classify(card Card) Result {
	result := Result{Source: BagOfHolding, Status: "non_ph", Reason: "No original PH equipment name in the reviewed catalog."}
	entries := c.byName[Normalize(card.Name)]
	if len(entries) == 0 {
		return result
	}
	result.Status, result.NeedsReview = "unreviewed", true
	result.Reason = "Known equipment name, but this complete text/rules variant has not been reviewed."
	for _, entry := range entries {
		for _, review := range entry.Reviews {
			if Normalize(card.Name) != Normalize(review.Name) || Normalize(card.NameEN) != Normalize(review.NameEN) ||
				Normalize(card.Description) != Normalize(review.Description) || Normalize(card.DetailedDescription) != Normalize(review.DetailedDescription) ||
				card.RulesFingerprint != review.RulesFingerprint {
				continue
			}
			result.RuleID, result.Canonical = entry.Key+"/"+review.CardNumber, entry.Canonical
			result.Status, result.Reason = review.Decision, review.Reason
			result.NeedsReview = review.Decision == "ambiguous"
			if review.Decision == "ph" {
				result.Source = PlayersHandbook
			}
			return result
		}
	}
	return result
}
