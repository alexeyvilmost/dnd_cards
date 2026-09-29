import { payloadsOf } from './mechanicsView';
type Dict = Record<string, unknown>;
/** Actor-neutral catalog mechanics are projected once for both picker and
 * authority; the canonical spell itself is never edited. */
export function applyItemSpellProjectiles(mechanics: Dict, refs: readonly string[], passives: readonly unknown[]): Dict {
  const primitive = mechanics.primitive as Dict | undefined;
  if (primitive?.type !== 'magic_missile') return mechanics;
  const bonus = passives.filter((row):row is Dict=>!!row&&typeof row==='object'&&!Array.isArray(row)).flatMap(payloadsOf).filter(payload => payload.kind === 'spell_projectiles'
    && Array.isArray(payload.spell_refs) && payload.spell_refs.some(ref => typeof ref === 'string' && refs.includes(ref)))
    .reduce((sum, payload) => {
      if (!Number.isSafeInteger(payload.add) || Number(payload.add) < 1) throw Error('Projectile bonus must be a positive integer');
      return sum + Number(payload.add);
    }, 0);
  if (!bonus) return mechanics;
  const policy = primitive.policy as Dict, targeting = mechanics.targeting as Dict;
  if (Number(targeting.max_targets) + bonus > 64) throw Error('Projectile count exceeds supported limit');
  return { ...mechanics, primitive: { ...primitive, policy: { ...policy, base_dart_count: Number(policy.base_dart_count) + bonus } },
    targeting: { ...targeting, max_targets: Number(targeting.max_targets) + bonus } };
}
