import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import EffectiveSenseValue from './EffectiveSenseValue';

describe('EffectiveSenseValue', () => {
  it('distinguishes a permanent build sense from a temporary runtime sense', () => {
    const permanent = renderToStaticMarkup(createElement(EffectiveSenseValue, { sense: {
      sense: 'darkvision', range: 120,
      sources: [{ kind: 'build', sourceEntityIds: ['RACE-0003'] }],
    } }));
    expect(permanent).toContain('120 фт');
    expect(permanent).toContain('Постоянное чувство');
    expect(permanent).not.toContain('временно');

    const temporary = renderToStaticMarkup(createElement(EffectiveSenseValue, { sense: {
      sense: 'tremorsense', range: 60,
      sources: [{
        kind: 'runtime', sourceEntityIds: ['RE-dwarf-4'],
        runtimeEffectId: 'stonecunning:1', roundsLeft: 99,
      }],
    } }));
    expect(temporary).toContain('60 фт · временно: 99 раунд.');
    expect(temporary).toContain('Осталось раундов: 99');
    expect(temporary).toContain('data-testid="effective-sense-tremorsense"');
  });
});
