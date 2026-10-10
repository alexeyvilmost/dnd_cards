import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CharacterFormulaProvider } from '../contexts/CharacterFormulaContext';
import { parseMechanicsStats } from '../engine/describeMechanics';
import type { FormulaContext } from '../engine/formula';
import type { Spell } from '../types';
import RollPreviewMeta from './RollPreviewMeta';
import SpellPreview from './SpellPreview';

const ctx: FormulaContext = { profBonus: 2, spellcastingMod: 3, abilityMods: { con: 2 } };
const renderSave = (dc: string | number, context: FormulaContext | null = ctx) => renderToStaticMarkup(
  createElement(CharacterFormulaProvider, { value: context, children: createElement(RollPreviewMeta, {
    stats: parseMechanicsStats({ effects: [{ resolution: 'save', ability: 'con', dc }] }),
  }) }),
);

describe('roll metadata in entity previews', () => {
  it('uses authored DC formulas and fixed values without guessing absent character values', () => {
    expect(renderSave('8 + prof + spellcasting')).toContain('(СЛ 13)');
    expect(renderSave('spell_save_dc')).toContain('(СЛ 13)');
    expect(renderSave('8 + prof + con')).toContain('(СЛ 12)');
    expect(renderSave(15, null)).toContain('(СЛ 15)');
    expect(renderSave('8 + prof + spellcasting', null)).not.toContain('СЛ ');
    expect(renderSave('spell_save_dc', null)).not.toContain('СЛ ');
  });

  it('keeps spell saves and attacks alongside range/duration, outside the damage block', () => {
    const base = { id: 'spell', name: 'Заклинание', level: 1, range: '60 футов', duration: 'Мгновенно', description: 'Описание' };
    for (const [effect, text, spellcasting] of [
      [{ resolution: 'save', ability: 'dex', dc: 'spell_save_dc' }, '(СЛ 14)', { saveDC: 14 }],
      [{ resolution: 'attack_roll', ability: 'spellcasting' }, 'Бросок атаки (+6)', { attack: 6 }],
    ] as const) {
      const html = renderToStaticMarkup(createElement(SpellPreview, {
        spell: { ...base, mechanics: { effects: [effect] } } as unknown as Spell, spellcasting,
      }));
      const meta = html.split('<div class="sp-meta">')[1].split('</div>')[0];
      expect(meta).toContain(text);
      expect(meta).toContain('60 футов');
      expect(meta).toContain('Мгновенно');
      expect(html).not.toContain('class="sp-stats"');
    }
  });

  it('does not replace an authored fixed DC with the general spell DC', () => {
    const html = renderToStaticMarkup(createElement(RollPreviewMeta, {
      stats: parseMechanicsStats({ effects: [{ resolution: 'save', ability: 'wis', dc: 11 }] }),
      spellcasting: { saveDC: 17 },
    }));
    expect(html).toContain('(СЛ 11)');
    expect(html).not.toContain('(СЛ 17)');
  });
});
