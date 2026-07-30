import assert from 'node:assert/strict';
import test from 'node:test';
import { CANTRIP_UPGRADES, EXPECTED_CANTRIP_NAMES } from './cantrips-2024.mjs';

test('манифест содержит ровно 35 уникальных заговоров', () => {
  assert.equal(EXPECTED_CANTRIP_NAMES.length, 35);
  assert.equal(new Set(EXPECTED_CANTRIP_NAMES).size, 35);
});

test('каждый заговор имеет исполнимую механику и честный статус поддержки', () => {
  for (const [name, upgrade] of Object.entries(CANTRIP_UPGRADES)) {
    assert.ok(upgrade.mechanics?.activation, `${name}: activation`);
    assert.ok(upgrade.mechanics?.effects?.length, `${name}: effects`);
    assert.ok(upgrade.mechanics?.targeting, `${name}: targeting`);
    assert.match(upgrade.support.status, /^verified_(mechanical|partial|narrative)$/);
    if (upgrade.support.status === 'verified_partial') {
      assert.ok(upgrade.support.limitations.some((item) => item.trim()), `${name}: limitations`);
    }
  }
});

test('ключевые заговоры используют общие примитивы, а не проверки по названию', () => {
  const bladeWard = CANTRIP_UPGRADES['Защита от оружия'].mechanics.effects[0].result[0];
  assert.deepEqual(
    {
      kind: bladeWard.kind,
      roll: bladeWard.applies_to.roll,
      scope: bladeWard.scope,
      op: bladeWard.op,
      faces: bladeWard.faces,
      sign: bladeWard.sign,
    },
    { kind: 'modifier', roll: 'attack', scope: 'target', op: 'bonus_die', faces: 4, sign: -1 },
  );

  const trueStrike = CANTRIP_UPGRADES['Меткий удар'].mechanics.effects[0];
  assert.equal(trueStrike.ability, 'spellcasting');
  assert.equal(trueStrike.on_hit[0].kind, 'choice');

  const sorcerousBurst = CANTRIP_UPGRADES['Чародейский выброс'].mechanics.effects[0].on_hit[0];
  assert.equal(sorcerousBurst.options.items.length, 7);
  assert.equal(sorcerousBurst.options.items[0].grants[0].explode.limit, 'spellcasting');
});
