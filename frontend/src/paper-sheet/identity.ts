import type { AssembledCharacter } from '../character/assemble';
import { emptyDraft, type CharacterDraft } from '../character/types';
import { draftClassLevels, normalizedSubclassIds, totalClassLevel } from '../character/multiclass';
import { ABILITY_IDS } from '../character/rules/foundation';
import { calculateSheet, type PaperIdentityFeatures, type PaperSheetDocument, type SheetCalculation } from './model';
import { PAPER_ENTITY_TOKEN_PATTERN, parsePaperEntityToken } from './references';

export type PaperIdentityKind = 'background' | 'species' | 'subspecies' | 'class' | 'subclass';
export interface PaperIdentityOption {
  kind: PaperIdentityKind;
  id: string;
  name: string;
  parentId?: string;
}

const ID_KEYS = {
  background: 'backgroundId', species: 'speciesId', subspecies: 'subspeciesId', class: 'classId', subclass: 'subclassId',
} as const;

/** Written only after the converter matches a data-owned inline race lineage. */
export const PAPER_INLINE_LINEAGE_FIELD = 'identity.inlineLineageId';

export function paperInlineLineageId(doc: PaperSheetDocument): string | null {
  const draft = doc.progression?.draft;
  const baseline = doc.progression?.baseline?.fields;
  return draft?.lineageId && draft.raceId && doc.identity?.speciesId === draft.raceId && !doc.identity.subspeciesId
    && doc.fields[PAPER_INLINE_LINEAGE_FIELD] === draft.lineageId && baseline?.[PAPER_INLINE_LINEAGE_FIELD] === draft.lineageId
    && doc.fields.subspecies !== undefined && doc.fields.subspecies === baseline.subspecies
    ? draft.lineageId : null;
}

export function paperIdentityId(doc: PaperSheetDocument, kind: PaperIdentityKind): string | undefined {
  return doc.identity?.[ID_KEYS[kind]];
}

/** Text is always user-owned. Only an explicit catalog selection establishes identity. */
export function editPaperIdentityText(doc: PaperSheetDocument, kind: PaperIdentityKind, text: string): PaperSheetDocument {
  const identity = { ...doc.identity };
  const fields = { ...doc.fields, [kind]: text };
  if (kind === 'species' || kind === 'subspecies') delete fields[PAPER_INLINE_LINEAGE_FIELD];
  delete identity[ID_KEYS[kind]];
  if (kind === 'class') {
    if (identity.subclassId) fields.subclass = '';
    delete identity.subclassId;
  }
  if (kind === 'species') {
    if (identity.subspeciesId) fields.subspecies = '';
    delete identity.subspeciesId;
  }
  return { ...doc, identity, fields };
}

/** Parent membership comes from catalog data, never from names or ID conventions. */
export function selectPaperIdentity(doc: PaperSheetDocument, option: PaperIdentityOption): PaperSheetDocument {
  if (option.kind === 'subclass' && (!doc.identity?.classId || option.parentId !== doc.identity.classId)) return doc;
  if (option.kind === 'subspecies' && (!doc.identity?.speciesId || option.parentId !== doc.identity.speciesId)) return doc;
  const identity = { ...doc.identity, [ID_KEYS[option.kind]]: option.id };
  const fields = { ...doc.fields, [option.kind]: option.name };
  if (option.kind === 'subspecies' || (option.kind === 'species' && doc.identity?.speciesId !== option.id)) delete fields[PAPER_INLINE_LINEAGE_FIELD];
  if (option.kind === 'class' && doc.identity?.classId !== option.id) {
    if (identity.subclassId) fields.subclass = '';
    delete identity.subclassId;
  }
  if (option.kind === 'species' && doc.identity?.speciesId !== option.id) {
    if (identity.subspeciesId) fields.subspecies = '';
    delete identity.subspeciesId;
  }
  return { ...doc, identity, fields };
}

export function paperIdentityDisplayName(doc: PaperSheetDocument, kind: PaperIdentityKind): string {
  const name = doc.fields[kind] ?? '';
  return kind === 'species' && (doc.identity?.subspeciesId || paperInlineLineageId(doc)) && doc.fields.subspecies
    ? `${name} (${doc.fields.subspecies})` : name;
}

function identityLevel(doc: PaperSheetDocument, calculations: SheetCalculation): number | null {
  const level = calculations.values.level ?? Number(doc.fields.level);
  return !calculations.errors.level && Number.isInteger(level) && level >= 1 && level <= 20 ? level : null;
}

export function paperIdentitySourceKey(doc: PaperSheetDocument, calculations = calculateSheet(doc)): string {
  if (doc.progression) {
    const draft = paperIdentityDraft(doc, calculations);
    const mechanical = draft ? {
      ...draft, id: undefined, name: undefined, description: undefined, notes: undefined, avatarUrl: undefined,
    } : { invalid: true, identity: doc.identity, fields: doc.fields };
    const stable = JSON.stringify(mechanical, (_, value) => value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))) : value);
    // A display-cache key, not a signature or authorization token. Bound its size
    // while covering every choice instance and multiclass allocation.
    let first = 2166136261, second = 0x9e3779b9;
    for (let index = 0; index < stable.length; index++) {
      first = Math.imul(first ^ stable.charCodeAt(index), 16777619);
      second = Math.imul(second ^ stable.charCodeAt(index), 0x85ebca6b);
    }
    return `progression-v1:${stable.length}:${(first >>> 0).toString(16)}:${(second >>> 0).toString(16)}`;
  }
  return JSON.stringify([
    doc.identity?.backgroundId ?? '', doc.identity?.speciesId ?? '', doc.identity?.subspeciesId ?? '',
    doc.identity?.classId ?? '', doc.identity?.subclassId ?? '', identityLevel(doc, calculations),
  ]);
}

export function paperIdentityDraft(doc: PaperSheetDocument, calculations = calculateSheet(doc)): CharacterDraft | null {
  const level = identityLevel(doc, calculations);
  if (level === null) return null;
  const identity = doc.identity;
  const classId = identity?.classId ?? null;
  const subclassId = classId ? identity?.subclassId ?? null : null;
  if (doc.progression) {
    const draft = structuredClone(doc.progression.draft);
    delete draft.id;
    let levels = draftClassLevels(draft);
    const subclasses = normalizedSubclassIds(draft.subclassIds, draft.classId, draft.subclassId);
    if (draft.classId !== classId) {
      const previousPrimaryLevels = draft.classId ? levels[draft.classId] ?? 0 : 0;
      if (draft.classId) { delete levels[draft.classId]; delete subclasses[draft.classId]; }
      if (classId) levels[classId] = (levels[classId] ?? 0) + previousPrimaryLevels;
    }
    if (classId) {
      levels[classId] = (levels[classId] ?? 0) + level - totalClassLevel(levels);
      if (levels[classId] < 1 || levels[classId] > 20) return null;
      if (subclassId) subclasses[classId] = subclassId;
      else delete subclasses[classId];
    } else {
      // Free text cannot silently reattach the former primary class as a
      // secondary class. The complete original draft stays in metadata.
      levels = {};
      for (const key of Object.keys(subclasses)) delete subclasses[key];
    }
    const baseCalculations = calculateSheet(doc);
    for (const ability of ABILITY_IDS) {
      const raw = doc.fields[ability];
      const baseline = doc.progression.baseline?.fields?.[ability];
      if (raw === undefined || raw === baseline) continue;
      const score = baseCalculations.values[ability];
      if (baseCalculations.errors[ability] || !Number.isInteger(score) || score < 0 || score > 30) return null;
      const generated = baseline === undefined || !baseline.trim() ? undefined : Number(baseline);
      // Paper scores include permanent grants. Apply the user's delta to the
      // forge base instead of applying ASI twice; equipment never enters here.
      const next = generated !== undefined && Number.isFinite(generated)
        ? (draft.abilities[ability] ?? 10) + score - generated : score;
      if (!Number.isInteger(next) || next < 0 || next > 30) return null;
      draft.abilities[ability] = next;
    }
    return {
      ...draft, name: doc.fields.name ?? draft.name, level,
      raceId: identity?.speciesId ?? null, lineageId: identity?.speciesId ? identity.subspeciesId ?? paperInlineLineageId(doc) : null,
      classId, classLevels: levels, subclassId, subclassIds: subclasses, backgroundId: identity?.backgroundId ?? null,
    };
  }
  return {
    ...emptyDraft(), name: doc.fields.name ?? '', level,
    raceId: identity?.speciesId ?? null,
    lineageId: identity?.speciesId ? identity.subspeciesId ?? null : null,
    classId, classLevels: classId ? { [classId]: level } : {},
    subclassId, subclassIds: classId && subclassId ? { [classId]: subclassId } : {},
    backgroundId: identity?.backgroundId ?? null,
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  };
}

/** loadAssembly already resolves progression and activation requirements. This is presentation only. */
export function projectPaperIdentityFeatures(assembly: AssembledCharacter, key: string, includeBuildSelections = false): PaperIdentityFeatures {
  const seen = new Set<string>();
  const abilities: PaperIdentityFeatures['abilities'] = [];
  const append = (type: 'effect' | 'action', entity: { id: string; name: string }, origin: { kind: string }) => {
    if (!includeBuildSelections && origin.kind !== 'race' && origin.kind !== 'class') return;
    const reference = `${type}:${entity.id}`;
    if (seen.has(reference)) return;
    seen.add(reference);
    abilities.push({ type, id: entity.id, name: entity.name });
  };
  for (const { effect, origin } of assembly.effects) append('effect', effect, origin);
  for (const { action, origin } of assembly.actions) append('action', action, origin);
  const originFeat = assembly.background?.origin_feat;
  const traits: PaperIdentityFeatures['traits'] = assembly.feats
    .filter(feat => includeBuildSelections || originFeat && (feat.id === originFeat || feat.card_number === originFeat))
    .filter((feat, index, all) => all.findIndex(candidate => candidate.id === feat.id) === index)
    .map(feat => ({ type: 'feat', id: feat.id, name: feat.name }));
  return { key, abilities, traits };
}

export function currentPaperIdentityFeatures(doc: PaperSheetDocument, calculations = calculateSheet(doc)): PaperIdentityFeatures | undefined {
  return doc.identityFeatures?.key === paperIdentitySourceKey(doc, calculations) ? doc.identityFeatures : undefined;
}

export function paperIdentityEntries(doc: PaperSheetDocument, section: 'features' | 'traits', calculations = calculateSheet(doc)) {
  const snapshot = currentPaperIdentityFeatures(doc, calculations);
  if (!snapshot) return [];
  const explicit = new Set([...(doc.sections[section]?.text ?? '').matchAll(PAPER_ENTITY_TOKEN_PATTERN)].flatMap(match => {
    const entity = parsePaperEntityToken(match[0]);
    return entity ? [`${entity.type}:${entity.id}`] : [];
  }));
  return (section === 'features' ? snapshot.abilities : snapshot.traits).filter(entity => !explicit.has(`${entity.type}:${entity.id}`));
}
