package migrations

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func testRetirementRequest() RetirementRequest {
	hash := "sha256:" + strings.Repeat("b", 64)
	return RetirementRequest{1, "retire-character-generations-301", hash, hash, hash, map[string]RetirementPreimage{
		"characters": {21, hash}, "characters_v2": {12, hash}, "retired_inventories": {10, hash}, "retired_items": {45, hash},
	}}
}
func TestRetirementIdentityIsSupportedButNeverExecutable(t *testing.T) {
	identity := RetirementMigrationIdentity()
	if identity.Checksum != hashBytes(retirement301Source) || !validIdentityHash(identity.Checksum) {
		t.Fatal("source identity differs")
	}
	for _, row := range GetAllMigrations() {
		if row.Version == identity.ID {
			t.Fatal("retirement registered at startup")
		}
	}
	for _, row := range AdditiveMigrationIdentities() {
		if row.ID == identity.ID {
			t.Fatal("retirement registered as additive")
		}
	}
	if !reflect.DeepEqual(RetirementSupportedMigrationIDs(), []string{identity.ID}) {
		t.Fatal("unsupported metadata")
	}
}
func TestRetirementReceiptRejectsUnknownAndMalformedData(t *testing.T) {
	base, _ := json.Marshal(retirementReceipt{"retired-character-generations-receipt", testRetirementRequest(), strings.Repeat("a", 64), strings.Repeat("c", 64)})
	if _, err := decodeRetirementReceipt(base); err != nil {
		t.Fatal(err)
	}
	for name, raw := range map[string][]byte{
		"unknown":          append(base[:len(base)-1], []byte(`,"unknown":true}`)...),
		"extra":            append(append([]byte{}, base...), []byte(` {}`)...),
		"malformed":        []byte(`{"kind":`),
		"wrong-kind":       []byte(strings.Replace(string(base), "retired-character-generations-receipt", "other", 1)),
		"missing-hash":     []byte(strings.Replace(string(base), `"retainedItemsHash":"`+strings.Repeat("c", 64)+`"`, `"retainedItemsHash":""`, 1)),
		"unknown-preimage": []byte(strings.Replace(string(base), `"characters_v2"`, `"other"`, 1)),
		"negative-rows":    []byte(strings.Replace(string(base), `"rows":21`, `"rows":-1`, 1)),
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := decodeRetirementReceipt(raw); err == nil {
				t.Fatal("invalid receipt accepted")
			}
		})
	}
}
func TestReleaseRetirementInspectionReadOnlyAndRejectsDrift(t *testing.T) {
	for _, name := range []string{"valid-and-repeat", "v3-and-personal-gameplay-after-retirement", "missing-receipt", "different-request", "receipt-changed", "wrong-sql", "unknown-migration", "legacy-table-returned", "legacy-column-returned", "legacy-inventory-returned", "missing-v3", "ledger-rule", "ledger-rls"} {
		t.Run(name, func(t *testing.T) {
			db, ordinary := releaseFixture(t)
			m := NewMigrator(db)
			if _, err := m.RunReleaseAdditive(context.Background(), ordinary); err != nil {
				t.Fatal(err)
			}
			if _, err := db.Exec(`CREATE TABLE characters_v3(id int PRIMARY KEY,payload jsonb); INSERT INTO characters_v3 VALUES(1,'{"keep":"v3"}');
			CREATE TABLE inventories(id int PRIMARY KEY,type text,user_id int,group_id int); INSERT INTO inventories VALUES(1,'personal',1,NULL),(2,'group',NULL,2);
			CREATE TABLE inventory_items(id int PRIMARY KEY,inventory_id int,payload jsonb); INSERT INTO inventory_items VALUES(1,1,'{"current":true}');`); err != nil {
				t.Fatal(err)
			}
			retirement := testRetirementRequest()
			raw, _ := json.Marshal(retirementReceipt{"retired-character-generations-receipt", retirement, strings.Repeat("a", 64), strings.Repeat("c", 64)})
			if _, err := db.Exec(`INSERT INTO schema_migrations(version,description) VALUES($1,$2)`, retirement301Version, string(raw)); err != nil {
				t.Fatal(err)
			}
			request := ReleaseRetirementInspectionRequest{SchemaVersion: 1, Kind: "inspect-character-retirement-301", ReleaseID: "owned-retirement-inspection", ExpectedCurrent: append(ordinary.Target, RetirementMigrationIdentity()), SQLSourceHash: RetirementMigrationIdentity().Checksum, ReceiptHash: hashBytes(raw), Retirement: retirement}
			success := name == "valid-and-repeat" || name == "v3-and-personal-gameplay-after-retirement"
			var mutation string
			switch name {
			case "v3-and-personal-gameplay-after-retirement":
				mutation = `UPDATE characters_v3 SET payload='{"currentGame":2}';INSERT INTO inventories VALUES(3,'personal',9,NULL);INSERT INTO inventory_items VALUES(2,3,'{"newItem":true}');`
			case "missing-receipt":
				mutation = `DELETE FROM schema_migrations WHERE version='301_retire_legacy_characters'`
			case "different-request":
				request.Retirement.BackupHash = "sha256:" + strings.Repeat("d", 64)
			case "receipt-changed":
				mutation = `UPDATE schema_migrations SET description=description||' ' WHERE version='301_retire_legacy_characters'`
			case "wrong-sql":
				request.SQLSourceHash = "sha256:" + strings.Repeat("d", 64)
			case "unknown-migration":
				mutation = `INSERT INTO schema_migrations(version) VALUES('999_unreviewed')`
			case "legacy-table-returned":
				mutation = `CREATE TABLE characters_v2(id int)`
			case "legacy-column-returned":
				mutation = `ALTER TABLE inventories ADD COLUMN character_id int`
			case "legacy-inventory-returned":
				mutation = `INSERT INTO inventories VALUES(3,'character',1,NULL)`
			case "missing-v3":
				mutation = `DROP TABLE characters_v3`
			case "ledger-rule":
				mutation = `CREATE RULE ledger_read AS ON DELETE TO schema_migrations DO INSTEAD NOTHING`
			case "ledger-rls":
				mutation = `ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY`
			}
			if mutation != "" {
				if _, err := db.Exec(mutation); err != nil {
					t.Fatal(err)
				}
			}
			const snapshot = `SELECT jsonb_build_object('ledger',(SELECT jsonb_agg(to_jsonb(t) ORDER BY version) FROM schema_migrations t),'inventories',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM inventories t),'items',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM inventory_items t))::text`
			var before, after string
			if err := db.QueryRow(snapshot).Scan(&before); err != nil {
				t.Fatal(err)
			}
			first, err := m.InspectReleaseRetirement(context.Background(), request)
			if (err == nil) != success {
				t.Fatalf("unexpected inspection result %v", err)
			}
			if success {
				second, err := m.InspectReleaseRetirement(context.Background(), request)
				if err != nil || !reflect.DeepEqual(first, second) || len(first.Applied) != 0 || !validIdentityHash(first.SchemaProofHash) {
					t.Fatal("read-only repeat differs", err)
				}
				// The ordinary executor still refuses 301, even when it is present.
				if _, err := m.RunReleaseAdditive(context.Background(), ReleaseMigrationRequest{SchemaVersion: 1, ReleaseID: request.ReleaseID, ExpectedCurrent: request.ExpectedCurrent, Target: request.ExpectedCurrent}); err == nil {
					t.Fatal("retirement entered additive executor")
				}
			}
			if err := db.QueryRow(snapshot).Scan(&after); err != nil || before != after {
				t.Fatal("inspection mutated ledger/data", err)
			}
		})
	}
}
