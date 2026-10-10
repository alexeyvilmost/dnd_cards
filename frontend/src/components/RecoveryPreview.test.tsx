import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Action, PassiveEffect, Spell } from '../types';
import ActionPreview from './ActionPreview';
import SpellPreview from './SpellPreview';
import EffectPreview from './EffectPreview';

const base = { id: 'recovery-test', name: 'Способность', card_number: 'TEST', rarity: 'common', description: 'Описание' };
const metadata = (html: string) => html.split('<div class="sp-meta">')[1]?.split('</div>')[0] || '';

describe('canonical recovery previews', () => {
  it('shows recovery beside the remaining uses without a legacy recharge field', () => {
    const action = { ...base, action_type: 'class_feature', mechanics: {
      uses: { count: 1, per: 'long_rest', resource_id: 'uses_preview' },
      activation: { cost: [{ resource: 'self_uses' }] },
    } } as unknown as Action;
    const meta = metadata(renderToStaticMarkup(createElement(ActionPreview, { action, resources: [],
      runtime: { resources: { uses_preview: 0 }, maxResources: { uses_preview: 1 } },
    })));
    expect(meta).toContain('Долгий отдых');
    expect(meta).toContain('Использования');
    expect(meta).toContain('Использования: 0/1');
  });
  it('shows the bounded policy of another entity, not just its per field', () => {
    const action = { ...base, action_type: 'class_feature', mechanics: { uses: {
      count: 4, per: 'short_rest', recovery: {
        short_rest: { mode: 'fixed', amount: 2 }, long_rest: { mode: 'full' },
      },
    } } } as unknown as Action;
    expect(metadata(renderToStaticMarkup(createElement(ActionPreview, { action, resources: [] }))))
      .toContain('Короткий отдых: +2; долгий отдых: все заряды');
  });
  it('displays the reviewed shared-resource recovery directly, without a custom placeholder', () => {
    const action = { ...base, action_type: 'class_feature', recharge: 'custom',
      recharge_custom: 'Короткий отдых: +1; долгий отдых: все заряды',
    } as unknown as Action;
    const meta = metadata(renderToStaticMarkup(createElement(ActionPreview, { action, resources: [] })));
    expect(meta).toContain('Короткий отдых: +1');
    expect(meta).not.toContain('Произвольная');
  });
  it('supports explicitly limited spells without inventing recovery for regular slots', () => {
    const spell = { ...base, level: 1, mechanics: { uses: { count: 1, per: 'short_rest' } } } as unknown as Spell;
    expect(metadata(renderToStaticMarkup(createElement(SpellPreview, { spell })))).toContain('Короткий или долгий отдых');
    const ordinary = { ...spell, mechanics: { activation: { cost: [{ resource: 'spell_slot', level: 1 }] } } } as unknown as Spell;
    expect(metadata(renderToStaticMarkup(createElement(SpellPreview, { spell: ordinary })))).not.toContain('отдых');
  });
  it('keeps recovery visible for an activated ability represented as an effect', () => {
    const effect = { ...base, effect_type: 'class_feature', mechanics: { uses: { count: 3, per: 'long_rest' } } } as unknown as PassiveEffect;
    expect(metadata(renderToStaticMarkup(createElement(EffectPreview, { effect })))).toContain('Долгий отдых');
  });
});
