import { describe, expect, it } from 'vitest';
import { recoveryPreview } from './recoveryPreview';

describe('recovery metadata', () => {
  it('shows declared uses even when the legacy presentation field is empty', () => {
    expect(recoveryPreview({ mechanics: { uses: { count: 1, per: 'long_rest' } } })).toBe('Долгий отдых');
    expect(recoveryPreview({ mechanics: { uses: { count: 2, per: 'short_rest' } } })).toBe('Короткий или долгий отдых');
  });
  it('keeps fixed and dice recovery distinct from full recovery', () => {
    expect(recoveryPreview({ mechanics: { uses: { count: 2, per: 'short_rest', recovery: {
      short_rest: { mode: 'fixed', amount: 1 }, long_rest: { mode: 'full' },
    } } } })).toBe('Короткий отдых: +1; долгий отдых: все заряды');
    expect(recoveryPreview({ mechanics: { uses: { count: 6, per: 'day', recovery: {
      short_rest: { mode: 'none' }, long_rest: { mode: 'dice', dice: '1d6' },
    } } } })).toBe('Долгий отдых: 1к6 зарядов');
  });
  it('preserves shared pool conditions and finite supplies', () => {
    expect(recoveryPreview({ recharge: 'custom', recharge_custom: 'Создание новых доз яда' })).toBe('Создание новых доз яда');
    expect(recoveryPreview({ mechanics: { uses: { count: 1, per: 'never' } } })).toBe('Не восстанавливаются');
    expect(recoveryPreview({ mechanics: { activation: { cost: [{ resource: 'spell_slot' }] } } })).toBe('');
  });
  it('does not disguise malformed bounded recovery as a full short rest', () => {
    expect(recoveryPreview({ recharge: 'short_rest', mechanics: { uses: { count: 2, per: 'short_rest', recovery: {} } } }))
      .toBe('Срок восстановления не задан корректно');
  });
});
