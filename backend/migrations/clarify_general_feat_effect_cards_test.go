package migrations

import (
	"database/sql"
	"os"
	"testing"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestGeneralFeatEffectClarityMigrationVersion(t *testing.T) {
	if generalFeatEffectClarityMigrationVersion != "174_clarify_general_feat_effect_cards" {
		t.Fatal(generalFeatEffectClarityMigrationVersion)
	}
}

func TestGeneralFeatEffectClarityAgainstPostgres(t *testing.T) {
	dsn := os.Getenv("GENERAL_FEAT_CLARITY_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set GENERAL_FEAT_CLARITY_TEST_DATABASE_URL for clone integration")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for run := 1; run <= 2; run++ {
		if err = clarifyGeneralFeatEffectCards(db); err != nil {
			t.Fatalf("run %d: %v", run, err)
		}
	}
	var total, clear, untested int
	err = db.QueryRow(`SELECT count(*),
		count(*) FILTER (WHERE e.name=f.name||' — правила'
			AND e.description=CASE WHEN f.card_number='FEAT-0049' THEN f.description ELSE
				f.description||E'\n\nПовышение характеристики: увеличьте одну допустимую характеристику на 1, максимум до 20.' END
			AND e.detailed_description=CASE WHEN f.card_number='FEAT-0049' THEN
				COALESCE(NULLIF(f.detailed_description,''),f.description) ELSE
				COALESCE(NULLIF(f.detailed_description,''),f.description)||E'\n\nПовышение характеристики: увеличьте одну допустимую характеристику на 1, максимум до 20.' END),
		count(*) FILTER (WHERE e.support->>'status'='untested')
	FROM feats f JOIN effects e ON e.id::text IN (
		SELECT jsonb_array_elements_text(COALESCE(f.related_effects,'[]'::jsonb))
	)
	WHERE f.card_number ~ '^FEAT-00(1[1-9]|[2-4][0-9]|5[0-3])$'
		AND f.deleted_at IS NULL AND e.deleted_at IS NULL`).Scan(&total, &clear, &untested)
	if err != nil {
		t.Fatal(err)
	}
	if total != 43 || clear != 43 || untested != 43 {
		t.Fatalf("total=%d clear=%d untested=%d, want 43/43/43", total, clear, untested)
	}
}
