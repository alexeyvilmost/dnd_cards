import {describe, expect, it} from 'vitest';
import type {PassiveEffect, Spell} from '../types';
import {assemble} from './assemble';
import {emptyDraft} from './types';
import {requiredChoiceIssues} from './forgeHelpers';
import {collectLongRestPreparationChoices} from './sheetSpellPreparation';

function fixture() {
  const spells = ['parent-command', 'parent-hex'].flatMap((id) => [
    {id, card_number: id, name: id, level: 1, mechanics: {spell_variant_ids: [`${id}-child`]}} as unknown as Spell,
    {id: `${id}-child`, card_number: `${id}-child-card`, name: `${id}-child`, level: 1, mechanics: {variant_of_spell_id: id}} as unknown as Spell,
  ]);
  const effect = {id: 'book-source', name: 'Book source', mechanics: {effects: [
    {kind: 'choice', id: 'book', count: 2, options: {source: 'spell'}, grant: {kind: 'grant_spell', label: 'spellbook'}},
    {kind: 'prepared_spell_choice', id: 'prepared', source_choice_id: 'book', prompt: 'Prepare', count: 2, resolution: 'on_acquire'},
  ]}} as unknown as PassiveEffect;
  const bundle = {race: null, klass: null, background: null, feats: [], actions: [], spells, resources: [],
    effects: [{effect, origin: {kind: 'other' as const, id: 'book-owner', name: 'Book owner'}}]};
  const draft = emptyDraft();
  const initial = assemble(bundle, draft);
  const book = initial.pendingChoices.find((choice) => choice.source === 'spell')!;
  const prepared = initial.pendingChoices.find((choice) => choice.source === 'prepared_spell')!;
  draft.resolvedChoices = {[book.id]: ['parent-command', 'parent-command-child', 'parent-hex', 'parent-hex-child-card'],
    [prepared.id]: ['parent-command', 'parent-hex']};
  return {bundle, draft, book, prepared};
}

describe('ordinary spell acquisition and preparation', () => {
  it('excludes polluted child references from the assembled spellbook domain without deleting cast catalog rows', () => {
    const {bundle, draft, prepared} = fixture();
    const assembled = assemble(bundle, draft);
    expect(assembled.pendingChoices.find((choice) => choice.id === prepared.id)?.allowedOptionIds).toEqual(['parent-command', 'parent-hex']);
    expect(assembled.spells).toHaveLength(4);
    expect(requiredChoiceIssues(draft, assembled)).toEqual([
      '«parent-command-child»: версию можно выбрать только при наложении родительского заклинания',
      '«parent-hex-child»: версию можно выбрать только при наложении родительского заклинания',
    ]);
  });

  it('cleans long-rest option domains and preselection even when passed an old assembled choice', () => {
    const {bundle, draft, prepared} = fixture();
    const assembled = assemble(bundle, draft);
    assembled.pendingChoices.find((choice) => choice.id === prepared.id)!.allowedOptionIds = bundle.spells.map((spell) => spell.id);
    const [choice] = collectLongRestPreparationChoices({assembled, character: {turn_state: null,
      resolved_choices: {[prepared.id]: ['parent-command-child', 'parent-hex']}}});
    expect(choice.items?.map((item) => item.previewSpell?.id)).toEqual(['parent-command', 'parent-hex']);
    expect(choice.allowedOptionIds).toEqual(['parent-command', 'parent-hex']);
    expect(choice.recommended).toEqual(['parent-hex']);
  });

  it('allows ordinary parents and blocks a direct manual child in completion checks', () => {
    const {bundle, draft, book} = fixture();
    draft.resolvedChoices[book.id] = ['parent-command', 'parent-hex'];
    draft.spellIds = ['parent-command', 'parent-hex'];
    const assembled = assemble(bundle, draft);
    expect(requiredChoiceIssues(draft, assembled)).toEqual([]);
    draft.manualSpellIds = ['parent-command-child'];
    expect(requiredChoiceIssues(draft, assembled)).toHaveLength(1);
  });
});
