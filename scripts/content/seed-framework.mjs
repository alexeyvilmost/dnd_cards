/**
 * Идемпотентный сидер контента через API (фаза G1).
 * Upsert по card_number: PUT если есть, POST если нет.
 */
import { apiRequest, buildIndex, fetchAll, login } from './api.mjs';

export class ContentSeeder {
  /** @type {Map<string, unknown>} */
  #index = new Map();

  constructor({ token, dryRun = false } = {}) {
    this.token = token;
    this.dryRun = dryRun;
    this.stats = { created: 0, updated: 0, skipped: 0 };
  }

  async loadIndexes() {
    const [effects, actions, classes, races] = await Promise.all([
      fetchAll('/api/effects', 'effects'),
      fetchAll('/api/actions', 'actions'),
      fetchAll('/api/classes', 'classes'),
      fetchAll('/api/races', 'races'),
    ]);
    this.#index = new Map([
      ...buildIndex(effects),
      ...buildIndex(actions),
      ...buildIndex(classes),
      ...buildIndex(races),
    ]);
    this.effects = effects;
    this.actions = actions;
    this.classes = classes;
    this.races = races;
    return this;
  }

  find(cardNumberOrId) {
    return this.#index.get(cardNumberOrId) || null;
  }

  remember(entity) {
    if (entity?.id) this.#index.set(entity.id, entity);
    if (entity?.card_number) this.#index.set(entity.card_number, entity);
  }

  async upsertEffect({ cardNumber, name, description, effectType = 'passive', mechanics, rarity = 'common' }) {
    const existing = this.find(cardNumber);
    const payload = {
      name,
      description: description || '',
      rarity,
      effect_type: effectType,
      mechanics,
      card_number: cardNumber,
      author: 'Admin',
    };
    if (existing) {
      const updated = await apiRequest(this.token, 'PUT', `/api/effects/${existing.id}`, {
        ...payload,
        image_url: existing.image_url || '',
      }, { dryRun: this.dryRun });
      if (!this.dryRun) this.remember(updated);
      this.stats.updated++;
      return updated || existing;
    }
    const created = await apiRequest(this.token, 'POST', '/api/effects', payload, { dryRun: this.dryRun });
    if (!this.dryRun && created) this.remember(created);
    this.stats.created++;
    return created;
  }

  async upsertAction({
    cardNumber,
    name,
    description,
    actionType = 'class_feature',
    resource = 'action',
    resources,
    mechanics,
    rarity = 'common',
  }) {
    const existing = this.find(cardNumber);
    const resourceList = resources ?? [resource];
    const payload = {
      name,
      description: description || '',
      rarity,
      action_type: actionType,
      resource,
      resources: resourceList,
      mechanics,
      card_number: cardNumber,
      author: 'Admin',
    };
    if (existing) {
      const updated = await apiRequest(this.token, 'PUT', `/api/actions/${existing.id}`, {
        ...payload,
        image_url: existing.image_url || '',
      }, { dryRun: this.dryRun });
      if (!this.dryRun) this.remember(updated);
      this.stats.updated++;
      return updated || existing;
    }
    const created = await apiRequest(this.token, 'POST', '/api/actions', payload, { dryRun: this.dryRun });
    if (!this.dryRun && created) this.remember(created);
    this.stats.created++;
    return created;
  }

  async patchClass(cardNumber, patch) {
    const existing = this.find(cardNumber);
    if (!existing) throw new Error(`Class not found: ${cardNumber}`);
    const body = {
      name: existing.name,
      description: existing.description || '',
      hit_die: existing.hit_die,
      primary_abilities: existing.primary_abilities,
      saving_throws: existing.saving_throws,
      armor_training: existing.armor_training,
      weapon_proficiencies: existing.weapon_proficiencies,
      tool_proficiencies: existing.tool_proficiencies,
      skill_choices: existing.skill_choices,
      starting_equipment: existing.starting_equipment,
      level_progression: existing.level_progression,
      resources: existing.resources,
      ...patch,
    };
    const updated = await apiRequest(this.token, 'PUT', `/api/classes/${existing.id}`, body, { dryRun: this.dryRun });
    if (!this.dryRun && updated) this.remember(updated);
    this.stats.updated++;
    return updated || existing;
  }

  async upsertClass(spec) {
    const existing = this.find(spec.cardNumber);
    if (existing) {
      return this.patchClass(spec.cardNumber, spec);
    }
    const created = await apiRequest(this.token, 'POST', '/api/classes', {
      name: spec.name,
      description: spec.description || '',
      rarity: 'common',
      card_number: spec.cardNumber,
      hit_die: spec.hit_die,
      primary_abilities: spec.primary_abilities,
      saving_throws: spec.saving_throws,
      skill_choices: spec.skill_choices,
      level_progression: spec.level_progression || {},
      resources: spec.resources || null,
      author: 'Admin',
    }, { dryRun: this.dryRun });
    if (!this.dryRun && created) this.remember(created);
    this.stats.created++;
    return created;
  }

  /** Слить progression уровня (не затирая другие уровни). */
  async linkClassLevel(cardNumber, level, { effects = [], actions = [] }) {
    const existing = this.find(cardNumber);
    if (!existing) throw new Error(`Class not found: ${cardNumber}`);
    const prog = { ...(existing.level_progression || {}) };
    const prev = prog[String(level)] || {};
    prog[String(level)] = {
      effects: effects.length ? effects : (prev.effects || []),
      actions: actions.length ? actions : (prev.actions || []),
    };
    return this.patchClass(cardNumber, { level_progression: prog });
  }

  async patchRace(cardNumber, patch) {
    const existing = this.find(cardNumber);
    if (!existing) throw new Error(`Race not found: ${cardNumber}`);
    const body = {
      name: existing.name,
      description: existing.description || '',
      image_url: existing.image_url || '',
      rarity: existing.rarity || 'common',
      creature_type: existing.creature_type,
      size: existing.size,
      speed: existing.speed,
      extra_speeds: existing.extra_speeds,
      darkvision: existing.darkvision,
      traits: existing.traits,
      lineages: existing.lineages,
      related_effects: existing.related_effects,
      related_actions: existing.related_actions,
      level_progression: existing.level_progression,
      type: existing.type,
      author: existing.author || 'Admin',
      source: existing.source,
      tags: existing.tags,
      is_extended: existing.is_extended,
      ...patch,
    };
    const updated = await apiRequest(this.token, 'PUT', `/api/races/${existing.id}`, body, { dryRun: this.dryRun });
    if (!this.dryRun && updated) this.remember(updated);
    this.stats.updated++;
    return updated || existing;
  }

  /** Добавить id в related_effects / related_actions без дубликатов. */
  mergeRaceRefs(cardNumber, { effects = [], actions = [] } = {}) {
    const existing = this.find(cardNumber);
    if (!existing) throw new Error(`Race not found: ${cardNumber}`);
    const re = [...(existing.related_effects || [])];
    const ra = [...(existing.related_actions || [])];
    for (const id of effects) if (id && !re.includes(id)) re.push(id);
    for (const id of actions) if (id && !ra.includes(id)) ra.push(id);
    return this.patchRace(cardNumber, { related_effects: re, related_actions: ra });
  }
}

export async function createSeeder({ dryRun = process.env.DRY_RUN === '1' } = {}) {
  const token = dryRun ? null : await login();
  const seeder = new ContentSeeder({ token, dryRun });
  await seeder.loadIndexes();
  return seeder;
}
