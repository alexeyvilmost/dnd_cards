/**
 * Ярость (KB-052 / задача 0.5) на РЕАЛЬНЫХ прод-данных действия ACT-rage. До досева сопротивление
 * физическому урону и преимущество на СИЛ были только narrative-текстом — исполнялся лишь бонус
 * урона. Гейт держит payload'ы на месте и проверяет их через движок урона/модификаторов.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { executeAction, applyIncomingDamage } from './execute';
import { collectRollModifiers } from './modifiers';
import { freshFighterState, FIGHTER_CTX, seededRng } from '../mvp/fixtures';
import { REPO_ROOT } from '../canon/reports';
import type { ExecuteContext, RuntimeState } from '../mvp/contracts';

const actionsRaw = JSON.parse(
  readFileSync(join(REPO_ROOT, 'officials/canon/prod-snapshot/actions.json'), 'utf8'),
) as unknown;
type ProdAction = { id: string; name?: string; mechanics: Record<string, unknown> };
const ACTIONS: ProdAction[] = (Array.isArray(actionsRaw)
  ? actionsRaw
  : (Object.values(actionsRaw as Record<string, unknown>).find(Array.isArray) as ProdAction[])) ?? [];
const RAGE = ACTIONS.find((a) => a.id === '815f7963-ccac-4480-8a4d-6c790d8d2bcb');

describe('прод-данные: Ярость', () => {
  const ctx = (): ExecuteContext => ({ character: FIGHTER_CTX, rng: seededRng(1), passives: [] }) as ExecuteContext;
  // Достаточно HP, чтобы измерять дельту урона без клампа, и заряд Ярости для оплаты действия.
  const tank = (): RuntimeState => {
    const s = freshFighterState();
    return {
      ...s,
      hp: { current: 100, max: 100, temp: 0 },
      resources: { ...s.resources, rage_charge: 2 },
      maxResources: { ...s.maxResources, rage_charge: 2 },
    };
  };
  const raging = (): RuntimeState => {
    if (!RAGE) throw new Error('ACT-rage исчезло из прод-снапшота');
    return executeAction(tank(), RAGE.mechanics, { character: FIGHTER_CTX, rng: seededRng(1) }).state;
  };

  it('сопротивление физическому урону: 28 рубящего → 14', () => {
    const res = applyIncomingDamage(raging(), 28, ctx(), { damageType: 'slashing' });
    expect(100 - res.state.hp.current).toBe(14);
  });

  it('сопротивление и дробящему, и колющему', () => {
    expect(100 - applyIncomingDamage(raging(), 10, ctx(), { damageType: 'bludgeoning' }).state.hp.current).toBe(5);
    expect(100 - applyIncomingDamage(raging(), 10, ctx(), { damageType: 'piercing' }).state.hp.current).toBe(5);
  });

  it('НЕфизический урон (огонь) не режется', () => {
    expect(100 - applyIncomingDamage(raging(), 20, ctx(), { damageType: 'fire' }).state.hp.current).toBe(20);
  });

  it('преимущество на проверки и спасброски СИЛ', () => {
    const s = raging();
    expect(collectRollModifiers(s, [], { roll: 'saving_throw', filter: { ability: 'str' } }).advantage).toBe('advantage');
    expect(collectRollModifiers(s, [], { roll: 'ability_check', filter: { ability: 'str' } }).advantage).toBe('advantage');
  });

  it('не даёт преимущество не-СИЛ спасброскам (ЛВК)', () => {
    expect(collectRollModifiers(raging(), [], { roll: 'saving_throw', filter: { ability: 'dex' } }).advantage).toBe('none');
  });
});
