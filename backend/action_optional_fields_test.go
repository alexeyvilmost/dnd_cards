package main

import "testing"

func TestNormalizeActionRechargeTreatsEmptySelectAsNull(t *testing.T) {
	emptyRechargeValue := ActionRecharge("  ")
	emptyRecharge := &emptyRechargeValue
	emptyCustomValue := "  "
	emptyCustom := &emptyCustomValue
	normalizeActionRecharge(&emptyRecharge, &emptyCustom)
	if emptyRecharge != nil {
		t.Fatalf("recharge=%q, want nil", *emptyRecharge)
	}
	if emptyCustom != nil {
		t.Fatalf("custom=%q, want nil", *emptyCustom)
	}
}

func TestNormalizeActionRechargeTrimsCustomText(t *testing.T) {
	rechargeValue := RechargeCustom
	recharge := &rechargeValue
	customValue := "  после особого события  "
	custom := &customValue
	normalizeActionRecharge(&recharge, &custom)
	if recharge == nil || *recharge != RechargeCustom {
		t.Fatalf("recharge=%v, want custom", recharge)
	}
	if custom == nil || *custom != "после особого события" {
		t.Fatalf("custom=%v, want trimmed value", custom)
	}
}
