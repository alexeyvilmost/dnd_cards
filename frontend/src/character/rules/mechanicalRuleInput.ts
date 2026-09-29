import type { RuleInput } from './types';

/** Presentation belongs to the library, not to the saved input of the rule
 * resolver. In particular, uploaded data-URI portraits can exceed the entire
 * atomic-command budget. Keep mechanics and source identities unchanged. */
function ruleEntity<T extends object | null | undefined>(entity: T): T {
  if (!entity) return entity;
  const result = { ...entity };
  for (const key of [
    'image_url', 'image_url_spent', 'icon_url', 'image_cloudinary_url',
    'image_cloudinary_id', 'image_generation_prompt', 'references', 'referenced_by',
  ]) {
    delete (result as Record<string, unknown>)[key];
  }
  return result;
}

export function mechanicalRuleInput(input: RuleInput): RuleInput {
  const { assembled } = input;
  const draft = { ...input.draft };
  delete draft.avatarUrl;
  delete draft.description;
  delete draft.notes;
  return {
    ...input,
    draft,
    assembled: {
      ...assembled,
      race: ruleEntity(assembled.race),
      subrace: ruleEntity(assembled.subrace),
      klass: ruleEntity(assembled.klass),
      classes: assembled.classes?.map(ruleEntity),
      subclass: ruleEntity(assembled.subclass),
      subclasses: assembled.subclasses?.map(ruleEntity),
      background: ruleEntity(assembled.background),
      feats: assembled.feats.map(ruleEntity),
      effects: assembled.effects.map(row => ({ ...row, effect: ruleEntity(row.effect) })),
      actions: assembled.actions.map(row => ({ ...row, action: ruleEntity(row.action) })),
      spells: assembled.spells.map(ruleEntity),
      resources: assembled.resources?.map(ruleEntity),
      pendingChoices: assembled.pendingChoices.map(choice => ({
        ...choice,
        items: choice.items?.map(item => ({
          ...item,
          previewCard: ruleEntity(item.previewCard),
          previewSpell: ruleEntity(item.previewSpell),
          previewAction: ruleEntity(item.previewAction),
        })),
      })),
    },
  };
}
