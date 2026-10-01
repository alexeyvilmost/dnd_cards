package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func TestSpellClassReferenceAliasesComeFromClassData(t *testing.T) {
	englishName := "Star Caller"
	classID := uuid.New()
	got := spellClassReferenceAliases(Class{
		ID: classID, Name: " Гадатель ", NameEn: &englishName, CardNumber: "CLASS-oracle",
	})
	want := []string{"гадатель", "class-oracle", "star caller", classID.String(), "oracle"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("aliases = %#v, want %#v", got, want)
	}
	got = spellClassReferenceAliases(Class{Name: "Wizard", CardNumber: "CLASS-wizard"})
	want = []string{"wizard", "class-wizard"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("deduplicated aliases = %#v, want %#v", got, want)
	}
}

func TestSpellListClassFilterResolvesCatalogAliasesBeforePagination(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := openCatalogPaginationTestDB(t)
	if err := db.AutoMigrate(&Spell{}, &Class{}); err != nil {
		t.Fatal(err)
	}
	englishName := "Star Caller"
	wizard := Class{ID: uuid.New(), CardNumber: "CLASS-wizard", Name: "Волшебник"}
	oracle := Class{ID: uuid.New(), CardNumber: "CLASS-oracle", Name: "Гадатель", NameEn: &englishName}
	if err := db.Create(&[]Class{wizard, oracle}).Error; err != nil {
		t.Fatal(err)
	}
	rows := []Spell{
		{ID: uuid.New(), CardNumber: "SPELL-CLASS-LEGACY", Name: "Legacy wizard", Classes: &Properties{"волшебник"}},
		{ID: uuid.New(), CardNumber: "SPELL-CLASS-SLUG", Name: "Slug wizard", Classes: &Properties{"wizard"}, Level: 1},
		{ID: uuid.New(), CardNumber: "SPELL-CLASS-CASE", Name: "Spaced wizard", Classes: &Properties{" WIZARD "}, Level: 1},
		{ID: uuid.New(), CardNumber: "SPELL-CLASS-CARD", Name: "Stable wizard", Classes: &Properties{wizard.CardNumber}, Level: 1},
		{ID: uuid.New(), CardNumber: "SPELL-CLASS-PARTIAL", Name: "Unrelated class", Classes: &Properties{"wizardry"}},
		{ID: uuid.New(), CardNumber: "SPELL-CLASS-NULL", Name: "No class"},
		{ID: uuid.New(), CardNumber: "SPELL-CLASS-ORACLE-RU", Name: "Localized oracle", Classes: &Properties{"гадатель"}},
		{ID: uuid.New(), CardNumber: "SPELL-CLASS-ORACLE-EN", Name: "English oracle", Classes: &Properties{"star caller"}},
		{ID: uuid.New(), CardNumber: "SPELL-CLASS-ORACLE-SLUG", Name: "Slug oracle", Classes: &Properties{"oracle"}},
	}
	if err := db.Create(&rows).Error; err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	router.GET("/spells", NewSpellController(db).GetSpells)
	for _, group := range []struct {
		name       string
		references []string
		wanted     []Spell
	}{
		{"wizard", []string{"wizard", "ВОЛШЕБНИК", " CLASS-wizard ", wizard.ID.String()}, rows[:4]},
		{"oracle", []string{"oracle", "Гадатель", "STAR CALLER", oracle.CardNumber, oracle.ID.String()}, rows[6:]},
	} {
		for _, reference := range group.references {
			for _, fields := range []string{"", "list"} {
				t.Run(group.name+"/"+reference+"/"+fields, func(t *testing.T) {
					seen := make(map[uuid.UUID]bool)
					for page := 1; page <= len(group.wanted); page++ {
						path := fmt.Sprintf("/spells?class=%s&limit=1&page=%d&fields=%s", url.QueryEscape(reference), page, fields)
						response := requestSpellClassFilterPage(t, router, path)
						if response.Total != int64(len(group.wanted)) || len(response.Spells) != 1 {
							t.Fatalf("%s: total=%d rows=%d, want total=%d and one row", path, response.Total, len(response.Spells), len(group.wanted))
						}
						if seen[response.Spells[0].ID] {
							t.Fatalf("spell %s repeated across pages", response.Spells[0].ID)
						}
						seen[response.Spells[0].ID] = true
					}
					for _, spell := range group.wanted {
						if !seen[spell.ID] {
							t.Fatalf("spell %s missing from filtered pages", spell.CardNumber)
						}
					}
				})
			}
		}
	}
	response := requestSpellClassFilterPage(t, router, "/spells?class=wizard&level=1&search=Slug&fields=list")
	if response.Total != 1 || len(response.Spells) != 1 || response.Spells[0].ID != rows[1].ID {
		t.Fatalf("class filter did not compose with level/search: %#v", response)
	}
}

func TestSpellListClassFilterMatchesUnknownLabelsLiterally(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := openCatalogPaginationTestDB(t)
	if err := db.AutoMigrate(&Spell{}, &Class{}); err != nil {
		t.Fatal(err)
	}
	isSubclass := true
	subclass := Class{ID: uuid.New(), CardNumber: "CLASS-rune-path", Name: "Rune_20%", IsSubclass: &isSubclass}
	if err := db.Create(&subclass).Error; err != nil {
		t.Fatal(err)
	}
	rows := []Spell{
		{ID: uuid.New(), CardNumber: "SPELL-CLASS-LITERAL", Name: "Literal label", Classes: &Properties{"Rune_20%"}},
		{ID: uuid.New(), CardNumber: "SPELL-CLASS-WILDCARD", Name: "Different label", Classes: &Properties{"runeX200"}},
		{ID: uuid.New(), CardNumber: "SPELL-CLASS-SUBCLASS", Name: "Subclass alias", Classes: &Properties{"rune-path"}},
	}
	if err := db.Create(&rows).Error; err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	router.GET("/spells", NewSpellController(db).GetSpells)
	response := requestSpellClassFilterPage(t, router, "/spells?fields=list&class="+url.QueryEscape("RUNE_20%"))
	if response.Total != 1 || len(response.Spells) != 1 || response.Spells[0].ID != rows[0].ID {
		t.Fatalf("unknown class label was treated as a substring, wildcard, or subclass: %#v", response)
	}
	response = requestSpellClassFilterPage(t, router, "/spells?fields=list&class="+url.QueryEscape("%"))
	if response.Total != 0 || len(response.Spells) != 0 {
		t.Fatalf("wildcard widened class filter: %#v", response)
	}
}

type spellClassFilterPage struct {
	Spells []SpellResponse `json:"spells"`
	Total  int64           `json:"total"`
}

func requestSpellClassFilterPage(t *testing.T, router http.Handler, path string) spellClassFilterPage {
	t.Helper()
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("%s: status=%d body=%s", path, recorder.Code, recorder.Body.String())
	}
	var response spellClassFilterPage
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	return response
}
