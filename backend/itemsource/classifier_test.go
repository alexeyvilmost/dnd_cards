package itemsource

import (
	"encoding/json"
	"testing"
)

func catalogFixture(t *testing.T) (Catalog, *Classifier) {
	t.Helper()
	var catalog Catalog
	if err := json.Unmarshal(catalogJSON, &catalog); err != nil {
		t.Fatal(err)
	}
	c, err := New()
	if err != nil {
		t.Fatal(err)
	}
	return catalog, c
}

func findReview(t *testing.T, catalog Catalog, number string) Card {
	t.Helper()
	for _, e := range catalog.Entries {
		for _, r := range e.Reviews {
			if r.CardNumber == number {
				return r.Card
			}
		}
	}
	t.Fatalf("missing fixture %s", number)
	return Card{}
}

func TestReviewedEquipment262(t *testing.T) {
	catalog, c := catalogFixture(t)
	counts := map[string]int{}
	for _, entry := range catalog.Entries {
		for _, review := range entry.Reviews {
			r := c.Classify(review.Card)
			if r.Status != review.Decision || r.Canonical != entry.Canonical || r.NeedsReview != (review.Decision == "ambiguous") {
				t.Errorf("%s: %+v", review.CardNumber, r)
			}
			if (r.Source == PlayersHandbook) != (review.Decision == "ph") {
				t.Errorf("wrong source: %+v", r)
			}
			counts[r.Status]++
		}
	}
	if counts["ph"] != 242 || counts["ambiguous"] != 0 || counts["non_ph"] != 19 {
		t.Fatalf("review inventory changed: %v", counts)
	}
}

func TestClassification262CopiesAndTextGuards(t *testing.T) {
	catalog, c := catalogFixture(t)
	// Two unrelated entity families exercise the same classifier operations.
	for _, number := range []string{"CARD-0297", "CARD-0706"} {
		base := findReview(t, catalog, number)
		copy := base
		copy.ID = "another-id"
		copy.CardNumber = "another-number"
		copy.Name = "  " + copy.Name + "  "
		copy.Description = "\n" + copy.Description + "\t"
		if r := c.Classify(copy); r.Source != PlayersHandbook {
			t.Fatalf("repriced copy: %+v", r)
		}
		for label, alter := range map[string]func(*Card){
			"added rule":               func(c *Card) { c.Description += " Grants +2 to all attacks." },
			"detailed rule":            func(c *Card) { c.DetailedDescription = "Allows flight." },
			"different rules":          func(c *Card) { c.RulesFingerprint = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
			"missing guard":            func(c *Card) { c.RulesFingerprint = "" },
			"conflicting English name": func(c *Card) { c.NameEN = "Vorpal Sword" },
		} {
			changed := base
			alter(&changed)
			if r := c.Classify(changed); r.Source != BagOfHolding || !r.NeedsReview {
				t.Errorf("%s/%s incorrectly accepted: %+v", number, label, r)
			}
		}
		for _, name := range []string{"Магический " + base.Name, base.Name + " +1", base.Name + " (Забег)"} {
			changed := base
			changed.Name = name
			if r := c.Classify(changed); r.Source != BagOfHolding {
				t.Errorf("substring accepted: %s", name)
			}
		}
	}
	// Unknown original-looking paraphrases remain explicitly reviewable.
	copy := findReview(t, catalog, "CARD-0706")
	copy.Description = "Пеньковая верёвка длиной пятьдесят футов."
	if r := c.Classify(copy); r.Source != BagOfHolding || r.Status != "unreviewed" {
		t.Fatal(r)
	}
}

func TestClassification262KnownDuplicatesAndLookalikes(t *testing.T) {
	catalog, c := catalogFixture(t)
	for number, source := range map[string]string{
		"CARD-0297": PlayersHandbook, "CARD-0492": PlayersHandbook,
		"CARD-0275": PlayersHandbook, "CARD-0493": PlayersHandbook, "CARD-0777": PlayersHandbook,
		"CARD-0249": BagOfHolding, "CARD-0270": BagOfHolding, "CARD-0147": BagOfHolding,
		"CARD-0039": PlayersHandbook, "CARD-0839": PlayersHandbook,
		"CARD-0802": PlayersHandbook, "CARD-0804": PlayersHandbook, "CARD-0807": PlayersHandbook,
		"CARD-0702": BagOfHolding, "CARD-0724": BagOfHolding, "CARD-0387": BagOfHolding,
		"CARD-0805": PlayersHandbook, "CARD-0415": PlayersHandbook, "CARD-0778": PlayersHandbook,
	} {
		if r := c.Classify(findReview(t, catalog, number)); r.Source != source {
			t.Errorf("%s: %+v", number, r)
		}
	}
}

func TestNormalize262DoesNotEraseSemanticChanges(t *testing.T) {
	if Normalize("\tВЕРЁВКА \n") != Normalize("веревка") {
		t.Fatal("whitespace/yo")
	}
	for _, pair := range [][2]string{{"1d4", "1d6"}, {"+1", "-1"}, {"даёт преимущество", "не даёт преимущество"}, {"2 факела", "10 факелов"}} {
		if Normalize(pair[0]) == Normalize(pair[1]) {
			t.Fatalf("erased distinction: %v", pair)
		}
	}
}

func TestInvalidCatalog262FailsClosed(t *testing.T) {
	catalog, _ := catalogFixture(t)
	catalog.Entries[0].Reviews[0].Decision = "maybe-ph"
	data, _ := json.Marshal(catalog)
	if _, err := newClassifier(data); err == nil {
		t.Fatal("invalid catalog accepted")
	}
	catalog, _ = catalogFixture(t)
	conflict := catalog.Entries[0].Reviews[0]
	conflict.Decision = "non_ph"
	conflict.CardNumber = "CONFLICTING-REVIEW"
	catalog.Entries[0].Reviews = append(catalog.Entries[0].Reviews, conflict)
	data, _ = json.Marshal(catalog)
	if _, err := newClassifier(data); err == nil {
		t.Fatal("contradictory reviews silently accepted")
	}
}
