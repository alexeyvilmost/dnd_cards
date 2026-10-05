package migrations

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func legacyRequest(request ReleaseMigrationRequest) ReleaseMigrationRequest {
	request.SchemaVersion = 2
	request.Kind = "observed-legacy-baseline"
	request.BaselineObservationHash = "sha256:" + strings.Repeat("e", 64)
	for _, row := range request.ExpectedCurrent {
		request.ExpectedCurrentIDs = append(request.ExpectedCurrentIDs, row.ID)
	}
	request.ExpectedCurrent = nil
	known := map[string]bool{}
	for _, row := range AdditiveMigrationIdentities() {
		known[row.ID] = true
	}
	for i := range request.Target {
		if !known[request.Target[i].ID] {
			request.Target[i].Checksum = ""
			request.Target[i].Kind = "observed-id-only"
			request.Target[i].ObservationHash = request.BaselineObservationHash
		}
	}
	return request
}

func TestReleaseAdditiveObservedLegacyAtomicCrashRepeat(t *testing.T) {
	db, old := releaseFixture(t)
	request := legacyRequest(old)
	for _, id := range []string{"011_add_detailed_description_formatting", "096_register_micro_mvp_rules_release", "097_repair_micro_mvp_rules_release_identity", "098_repair_magic_initiate_2024"} {
		if _, err := db.Exec("INSERT INTO schema_migrations(version,description,executed_at) VALUES($1,'Retained historical ledger',NOW())", id); err != nil {
			t.Fatal(err)
		}
		request.ExpectedCurrentIDs = append(request.ExpectedCurrentIDs, id)
		request.Target = append(request.Target, MigrationIdentity{ID: id, Kind: "observed-id-only", ObservationHash: request.BaselineObservationHash})
	}
	m := NewMigrator(db)
	if _, err := m.runReleaseAdditive(context.Background(), request, func() error { return errors.New("owned test before ledger") }); err == nil {
		t.Fatal("crash ignored")
	}
	var columns int
	if err := db.QueryRow("SELECT count(*) FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='roguelike_command_receipts' AND column_name='response_version'").Scan(&columns); err != nil || columns != 0 {
		t.Fatal("legacy DDL escaped rolled back transaction", err)
	}
	first, err := m.RunReleaseAdditive(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Applied) != 3 || first.BaselineObservationHash != request.BaselineObservationHash || !first.RollbackReadersSafe {
		t.Fatalf("incomplete legacy result: %+v", first)
	}
	// A lost acknowledgement is reconciled by the same exact candidate request.
	inspected, err := m.InspectReleaseAdditive(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	repeated, err := m.RunReleaseAdditive(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	if len(repeated.Applied) != 0 || inspected.SchemaProofHash != first.SchemaProofHash || repeated.SchemaProofHash != first.SchemaProofHash {
		t.Fatal("legacy replay changed schema")
	}
	// The next ordinary release preserves the adopted identity, without ever
	// promoting unknown historical SQL to a checksum.
	ordinary := request
	ordinary.SchemaVersion = 1
	ordinary.Kind = ""
	ordinary.BaselineObservationHash = ""
	ordinary.ExpectedCurrentIDs = nil
	ordinary.ExpectedCurrent = append([]MigrationIdentity(nil), request.Target...)
	if _, err := m.RunReleaseAdditive(context.Background(), ordinary); err != nil {
		t.Fatal("next ordinary release cannot retain observation", err)
	}
	changed := ordinary
	changed.Target = append([]MigrationIdentity(nil), ordinary.Target...)
	for i := range changed.Target {
		if changed.Target[i].Kind == "observed-id-only" {
			changed.Target[i].ObservationHash = "sha256:" + strings.Repeat("f", 64)
			break
		}
	}
	if _, err := m.RunReleaseAdditive(context.Background(), changed); err == nil {
		t.Fatal("next release changed historical observation")
	}
	var historical string
	if err := db.QueryRow("SELECT response::text FROM roguelike_command_receipts WHERE id=1").Scan(&historical); err != nil || historical != `{"past": "unchanged"}` {
		t.Fatal("legacy historical response changed", err)
	}
	if _, err = db.Exec(`DROP TRIGGER frozen_catalog_immutable ON frozen_combat_catalogs; CREATE TRIGGER frozen_catalog_immutable BEFORE UPDATE OR DELETE ON frozen_combat_catalogs FOR EACH ROW WHEN(false) EXECUTE FUNCTION reject_frozen_catalog_mutation()`); err != nil {
		t.Fatal(err)
	}
	if _, err = m.InspectReleaseAdditive(context.Background(), request); err == nil {
		t.Fatal("legacy request bypassed schema proof")
	}
}

func TestReleaseAdditiveObservedLegacyRejectsMissingUnknownAndAmbiguous(t *testing.T) {
	for name, mutate := range map[string]func(*ReleaseMigrationRequest){
		"missing_observation": func(r *ReleaseMigrationRequest) { r.BaselineObservationHash = "" },
		"historical_checksums": func(r *ReleaseMigrationRequest) {
			r.ExpectedCurrent = []MigrationIdentity{{ID: r.ExpectedCurrentIDs[0], Checksum: "sha256:" + strings.Repeat("a", 64)}}
		},
		"unknown_ID": func(r *ReleaseMigrationRequest) { r.ExpectedCurrentIDs = append(r.ExpectedCurrentIDs, "999_unknown") },
		"unknown_observed_ID": func(r *ReleaseMigrationRequest) {
			r.ExpectedCurrentIDs = append(r.ExpectedCurrentIDs, "012_unregistered_history")
			r.Target = append(r.Target, MigrationIdentity{ID: "012_unregistered_history", Kind: "observed-id-only", ObservationHash: r.BaselineObservationHash})
		},
		"unobserved_retired_ID": func(r *ReleaseMigrationRequest) {
			r.Target = append(r.Target, MigrationIdentity{ID: "011_add_detailed_description_formatting", Kind: "observed-id-only", ObservationHash: r.BaselineObservationHash})
		},
		"duplicate_ID": func(r *ReleaseMigrationRequest) {
			r.ExpectedCurrentIDs = append(r.ExpectedCurrentIDs, r.ExpectedCurrentIDs[0])
		},
		"wrong_kind": func(r *ReleaseMigrationRequest) { r.Kind = "inferred" },
		"invented_historical_checksum": func(r *ReleaseMigrationRequest) {
			for i := range r.Target {
				if r.Target[i].Kind == "observed-id-only" {
					r.Target[i] = MigrationIdentity{ID: r.Target[i].ID, Checksum: "sha256:" + strings.Repeat("f", 64)}
					break
				}
			}
		},
		"changed_historical_observation": func(r *ReleaseMigrationRequest) {
			for i := range r.Target {
				if r.Target[i].Kind == "observed-id-only" {
					r.Target[i].ObservationHash = "sha256:" + strings.Repeat("f", 64)
					break
				}
			}
		},
		"missing_historical_ID": func(r *ReleaseMigrationRequest) { r.ExpectedCurrentIDs = r.ExpectedCurrentIDs[1:] },
		"wrong_additive_checksum": func(r *ReleaseMigrationRequest) {
			r.Target[len(r.Target)-1].Checksum = "sha256:" + strings.Repeat("f", 64)
		},
	} {
		t.Run(name, func(t *testing.T) {
			db, old := releaseFixture(t)
			r := legacyRequest(old)
			mutate(&r)
			if _, err := NewMigrator(db).RunReleaseAdditive(context.Background(), r); err == nil {
				t.Fatal("invalid legacy request accepted")
			}
		})
	}
	t.Run("missing_actual_ledger", func(t *testing.T) {
		db, old := releaseFixture(t)
		r := legacyRequest(old)
		if _, err := db.Exec("DELETE FROM schema_migrations WHERE version=$1", r.ExpectedCurrentIDs[0]); err != nil {
			t.Fatal(err)
		}
		if _, err := NewMigrator(db).RunReleaseAdditive(context.Background(), r); err == nil {
			t.Fatal("missing observed ledger accepted")
		}
	})
}
