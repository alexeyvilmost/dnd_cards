package main

import (
 "database/sql"
 "encoding/json"
 "fmt"
 "net/url"
 "os"
 "regexp"
 "sort"

 "dnd-cards-backend/migrations"
 _ "github.com/jackc/pgx/v5/stdlib"
)

func main() {
 runID := os.Getenv("TEST_RUN_ID")
 target, err := url.Parse(os.Getenv("TEST_DATABASE_URL"))
 if err != nil || !regexp.MustCompile(`^test_[a-f0-9]{24}$`).MatchString(runID) || target.Hostname() != "127.0.0.1" || target.Port() != os.Getenv("TEST_PG_PORT") || target.Path != "/"+runID || target.User == nil || target.User.Username() != "test_runner" || target.Query().Get("sslmode") != "disable" { panic("owned local target required") }
 db, err := sql.Open("pgx", target.String())
 if err != nil { panic("private database driver unavailable") }
 defer db.Close()
 var owner, database string
 var markers int
 if err = db.QueryRow("SELECT current_database(), min(run_id), count(*) FROM test_run_ownership").Scan(&database, &owner, &markers); err != nil || database != runID || owner != runID || markers != 1 { panic("owned local marker required") }
 registered := map[string]bool{}
 ids := []string{}
 for _, m := range migrations.GetAllMigrations() { registered[m.Version] = true; ids = append(ids,m.Version) }
 sort.Strings(ids)
 err = migrations.NewMigrator(db).Run()
 reply := map[string]any{"status":"passed","registered":ids}
 var applied int
 var boundary sql.NullString
 if db.QueryRow("SELECT count(*), max(version) FROM schema_migrations").Scan(&applied, &boundary) == nil && applied >= 0 && applied <= len(ids) {
  reply["appliedCount"] = applied
  if boundary.Valid && registered[boundary.String] { reply["ledgerBoundary"] = boundary.String }
 }
 if err != nil {
  fmt.Fprintln(os.Stderr, err)
  stage := "unknown"
  m := regexp.MustCompile(`failed to run migration ([a-zA-Z0-9_]+):`).FindStringSubmatch(err.Error())
  if len(m)==2 && registered[m[1]] { stage=m[1] }
  reply["status"]="failed"; reply["stage"]=stage; reply["code"]="MIGRATION_FAILED"
 }
 _ = json.NewEncoder(os.Stdout).Encode(reply)
 if err != nil { os.Exit(1) }
}
