package migrations

import (
	"context"
	"errors"
	"reflect"
	"sort"
	"strings"
	"testing"
)

// Requires a separately owned database restored from the checked-in full 297
// schema and its nonempty canaries. This does not certify historical install.
func TestSupportedObservedLegacyBaseline(t *testing.T) {
	var input baselineMatrixInput
	db := baselineMatrixOwnedDatabase(t, &input)
	if input.Baseline != 297 {
		t.Fatal("exact imported 297 baseline required")
	}
	sort.Strings(input.Versions)
	if !reflect.DeepEqual(baselineMatrixVersions(t, db), input.Versions) {
		t.Fatal("fixture ledger differs")
	}
	columns := baselineMatrixColumns(t, db)
	rows := baselineMatrixRows(t, db, columns)
	objects := baselineMatrixSchemaObjects(t, db)
	ledger := baselineMatrixLedger(t, db, input.Versions)
	request := ReleaseMigrationRequest{SchemaVersion: 2, Kind: "observed-legacy-baseline", ReleaseID: "portable-observed297", ExpectedCurrentIDs: input.Versions, BaselineObservationHash: "sha256:" + strings.Repeat("e", 64)}
	for _, id := range input.Versions {
		request.Target = append(request.Target, MigrationIdentity{ID: id, Kind: "observed-id-only", ObservationHash: request.BaselineObservationHash})
	}
	request.Target = append(request.Target, AdditiveMigrationIdentities()...)
	assertHistory := func() {
		t.Helper()
		if !reflect.DeepEqual(rows, baselineMatrixRows(t, db, columns)) || ledger != baselineMatrixLedger(t, db, input.Versions) {
			t.Fatal("old-column bytes or ledger changed")
		}
		baselineMatrixRetainedSchema(t, db, objects)
	}
	m := NewMigrator(db)
	if _, err := m.runReleaseAdditive(context.Background(), request, func() error { return errors.New("owned before-ledger failure") }); err == nil {
		t.Fatal("failure not propagated")
	}
	assertHistory()
	if !reflect.DeepEqual(baselineMatrixVersions(t, db), input.Versions) || !reflect.DeepEqual(baselineMatrixSchemaObjects(t, db), objects) {
		t.Fatal("failed transaction changed schema/ledger")
	}
	first, err := m.RunReleaseAdditive(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Applied) != len(additiveRegistry()) || !first.RollbackReadersSafe {
		t.Fatal("incomplete expansion or old reader unsafe")
	}
	assertHistory()
	expected := append([]string{}, input.Versions...)
	for _, row := range AdditiveMigrationIdentities() {
		expected = append(expected, row.ID)
	}
	sort.Strings(expected)
	if !reflect.DeepEqual(first.ObservedVersions, expected) {
		t.Fatal("retired IDs lost or unexpected migration added")
	}
	repeated, err := m.RunReleaseAdditive(context.Background(), request)
	if err != nil || len(repeated.Applied) != 0 || repeated.SchemaProofHash != first.SchemaProofHash {
		t.Fatal("lost-ack repeat changed result", err)
	}
	ordinary := request
	ordinary.SchemaVersion = 1
	ordinary.Kind = ""
	ordinary.ExpectedCurrentIDs = nil
	ordinary.BaselineObservationHash = ""
	ordinary.ExpectedCurrent = append([]MigrationIdentity{}, request.Target...)
	inspected, err := m.InspectReleaseAdditive(context.Background(), ordinary)
	if err != nil || !reflect.DeepEqual(inspected.ObservedVersions, expected) {
		t.Fatal("ordinary successor rejected observed history", err)
	}
	assertHistory()
}
