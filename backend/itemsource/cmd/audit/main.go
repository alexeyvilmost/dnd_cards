// Audit is read-only and refuses a non-loopback PostgreSQL server.
package main

import (
	"context"
	"database/sql"
	"dnd-cards-backend/itemsource"
	"encoding/json"
	"flag"
	"fmt"
	_ "github.com/jackc/pgx/v5/stdlib"
	"net"
	"net/url"
	"os"
	"time"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	configPath := flag.String("config", "C:/Users/alexe/AppData/Local/dnd-cards-dev/local-env.json", "local service configuration (never printed)")
	database := flag.String("database", "shop_review_249_20260915", "local database, overriding the stale name in configuration")
	flag.Parse()
	data, err := os.ReadFile(*configPath)
	if err != nil {
		return fmt.Errorf("cannot read local configuration")
	}
	var config struct {
		URL string `json:"DATABASE_URL"`
	}
	if json.Unmarshal(data, &config) != nil {
		return fmt.Errorf("invalid local configuration")
	}
	u, err := url.Parse(config.URL)
	if err != nil || u == nil {
		return fmt.Errorf("invalid database URL")
	}
	ip := net.ParseIP(u.Hostname())
	if (u.Scheme != "postgres" && u.Scheme != "postgresql") || (u.Hostname() != "localhost" && (ip == nil || !ip.IsLoopback())) {
		return fmt.Errorf("audit requires a loopback PostgreSQL server")
	}
	u.Path = "/" + *database
	q := u.Query()
	q.Set("default_transaction_read_only", "on")
	u.RawQuery = q.Encode()
	db, err := sql.Open("pgx", u.String())
	if err != nil {
		return fmt.Errorf("cannot configure local database connection")
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	tx, err := db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return fmt.Errorf("cannot open read-only local database transaction")
	}
	defer tx.Rollback()
	rows, err := itemsource.Inventory(ctx, tx)
	if err != nil {
		return err
	}
	classifier, err := itemsource.New()
	if err != nil {
		return err
	}
	type decision struct {
		itemsource.InventoryRow
		itemsource.Result
	}
	report := struct {
		Database        string         `json:"database"`
		ReadOnly        bool           `json:"read_only"`
		CatalogSHA256   string         `json:"catalog_sha256"`
		Counts          map[string]int `json:"counts"`
		PreviousSources map[string]int `json:"previous_sources"`
		Items           []decision     `json:"items"`
	}{Database: *database, ReadOnly: true, CatalogSHA256: classifier.Hash(), Counts: map[string]int{}, PreviousSources: map[string]int{}, Items: []decision{}}
	for _, row := range rows {
		report.Counts["all"]++
		if row.Deleted {
			report.Counts["deleted_untouched"]++
			continue
		}
		r := classifier.Classify(row.Card)
		report.Counts["active"]++
		report.Counts[r.Source]++
		report.Counts["status_"+r.Status]++
		if r.NeedsReview {
			report.Counts["needs_review"]++
		}
		if row.Certified {
			report.Counts["certified"]++
			report.Counts["certified_"+r.Source]++
		}
		if row.PreviousSource == nil || *row.PreviousSource != r.Source {
			report.Counts["source_changes"]++
		}
		old := "<NULL>"
		if row.PreviousSource != nil {
			old = *row.PreviousSource
		}
		report.PreviousSources[old]++
		report.Items = append(report.Items, decision{row, r})
	}
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	return encoder.Encode(report)
}
