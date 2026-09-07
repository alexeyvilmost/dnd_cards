package migrations

import "testing"

func TestRoguelikeMultiattackMaterializesSeparateAttackRolls(t *testing.T) {
	mechanics := roguelikeAttackMechanics(roguelikeMonsterAttack{
		Damage: "1d6 + 2", DamageType: "bludgeoning", Ability: "str",
		Kind: "weapon_melee", Bonus: 4, Range: 5, Repeats: 2,
	})
	effects, ok := mechanics["effects"].([]map[string]any)
	if !ok || len(effects) != 2 {
		t.Fatalf("multiattack effects = %#v", mechanics["effects"])
	}
	for index, effect := range effects {
		if effect["resolution"] != "attack_roll" || effect["attack_bonus_override"] != 4 {
			t.Fatalf("attack %d is malformed: %#v", index, effect)
		}
	}
}
