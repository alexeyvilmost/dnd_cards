package migrations

import "testing"

func TestGeneralFeatActionPayloadRepairVersion(t *testing.T) {
	if generalFeatActionPayloadRepairVersion != "175_repair_general_feat_action_payloads" {
		t.Fatal(generalFeatActionPayloadRepairVersion)
	}
}
