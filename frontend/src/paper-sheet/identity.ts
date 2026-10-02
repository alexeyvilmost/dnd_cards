import type { AssembledCharacter } from '../character/assemble';
import { emptyDraft, type CharacterDraft } from '../character/types';
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

export function paperIdentityId(doc: PaperSheetDocument, kind: PaperIdentityKind): string | undefined {
  return doc.identity?.[ID_KEYS[kind]];
}

/** Text is always user-owned. Only an explicit catalog selection establishes identity. */
export function editPaperIdentityText(doc: PaperSheetDocument, kind: PaperIdentityKind, text: string): PaperSheetDocument {
  const identity = { ...doc.identity };
  const fields = { ...doc.fields, [kind]: text };
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
  return kind === 'species' && doc.identity?.subspeciesId && doc.fields.subspecies
    ? `${name} (${doc.fields.subspecies})` : name;
}

function identityLevel(doc: PaperSheetDocument, calculations: SheetCalculation): number | null {
  const level = calculations.values.level ?? Number(doc.fields.level);
  return !calculations.errors.level && Number.isInteger(level) && level >= 1 && level <= 20 ? level : null;
}

export function paperIdentitySourceKey(doc: PaperSheetDocument, calculations = calculateSheet(doc)): string {
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
export function projectPaperIdentityFeatures(assembly: AssembledCharacter, key: string): PaperIdentityFeatures {
  const seen = new Set<string>();
  const abilities: PaperIdentityFeatures['abilities'] = [];
  const append = (type: 'effect' | 'action', entity: { id: string; name: string }, origin: { kind: string }) => {
    if (origin.kind !== 'race' && origin.kind !== 'class') return;
    const reference = `${type}:${entity.id}`;
    if (seen.has(reference)) return;
    seen.add(reference);
    abilities.push({ type, id: entity.id, name: entity.name });
  };
  for (const { effect, origin } of assembly.effects) append('effect', effect, origin);
  for (const { action, origin } of assembly.actions) append('action', action, origin);
  const originFeat = assembly.background?.origin_feat;
  const traits: PaperIdentityFeatures['traits'] = assembly.feats
    .filter(feat => originFeat && (feat.id === originFeat || feat.card_number === originFeat))
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
