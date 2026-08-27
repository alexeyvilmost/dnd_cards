import { autoBuildAt, type BuildContent } from './autoBuild';
import type { CharacterDraft } from '../character/types';
import type { Background, Card, CharacterClass, Feat, Race } from '../types';
import { assertClassEquipmentReferenceClosure } from './classEquipmentReferenceIntegrity';
export {
  ClassEquipmentReferenceIntegrityError,
  assertClassEquipmentReferenceClosure,
} from './classEquipmentReferenceIntegrity';

type ManifestEntry = {
  key: string;
  selector: { cardNumber?: string };
  expected?: {
    variantSelectors?: Array<{ cardNumber: string; label: string }>;
  };
};

export interface MiniMvpForgeManifest {
  collections: Record<string, ManifestEntry[]>;
}

export interface MiniMvpForgeSheetRoot {
  classCardNumber: string;
  raceCardNumber: string;
  lineageCardNumber?: string;
  backgroundCardNumber: string;
  featCardNumber: string;
  draft: CharacterDraft;
}

export interface MiniMvpForgeSheetFixture {
  schemaVersion: 2;
  strategy: 'cyclic-covering-set-with-lineages-v2';
  coverage: {
    classes: string[];
    species: string[];
    lineages: string[];
    backgrounds: string[];
    originFeats: string[];
  };
  roots: MiniMvpForgeSheetRoot[];
}

export type MiniMvpForgeBuildContent = BuildContent & { cards: Card[] };

function resolveManifest<T extends { card_number: string }>(
  manifest: MiniMvpForgeManifest,
  collection: string,
  catalog: readonly T[],
): T[] {
  const entries = manifest.collections[collection];
  if (!Array.isArray(entries)) throw new Error(`mini-MVP manifest is missing ${collection}`);
  return entries.map((entry) => {
    const cardNumber = entry.selector.cardNumber;
    const matches = catalog.filter((entity) => entity.card_number === cardNumber);
    if (matches.length !== 1) {
      throw new Error(`${entry.key}: expected one ${cardNumber ?? '<missing>'}, got ${matches.length}`);
    }
    return matches[0];
  });
}

function cardNumbers(values: ReadonlyArray<{ card_number: string }>): string[] {
  return values.map((value) => value.card_number);
}

/**
 * Builds a compact covering set with the same assembler and completion gate as
 * CharacterForge.  Sixteen roots cover every mini-MVP class, species,
 * background and origin feat at least once without a 19,200-row cartesian run.
 */
export async function buildMiniMvpForgeSheetFixture(
  manifest: MiniMvpForgeManifest,
  content: MiniMvpForgeBuildContent,
): Promise<MiniMvpForgeSheetFixture> {
  assertClassEquipmentReferenceClosure(content.classes, content.cards);
  const classes = resolveManifest<CharacterClass>(manifest, 'classes', content.classes);
  const species = resolveManifest<Race>(manifest, 'species', content.races);
  const backgrounds = resolveManifest<Background>(manifest, 'backgrounds', content.backgrounds);
  const originFeats = resolveManifest<Feat>(manifest, 'originFeats', content.feats);
  const lineagesByRace = new Map<string, Race[]>();
  for (const entry of manifest.collections.species) {
    const parent = species.find((race) => race.card_number === entry.selector.cardNumber);
    if (!parent) throw new Error(`${entry.key}: parent species disappeared`);
    const variants = (entry.expected?.variantSelectors ?? []).map((selector) => {
      const matches = content.races.filter((race) => race.card_number === selector.cardNumber);
      if (matches.length !== 1) {
        throw new Error(`${entry.key}: expected one ${selector.cardNumber}, got ${matches.length}`);
      }
      if (matches[0].parent_race_id !== parent.id) {
        throw new Error(`${selector.cardNumber}: lineage parent differs from ${parent.card_number}`);
      }
      return matches[0];
    });
    lineagesByRace.set(parent.card_number, variants);
  }
  const roots: MiniMvpForgeSheetRoot[] = [];

  const buildRoot = async (
    klass: CharacterClass,
    race: Race,
    background: Background,
    feat: Feat,
    lineage?: Race,
  ) => {
    const result = await autoBuildAt({
      classId: klass.id,
      raceId: race.id,
      lineageId: lineage?.id ?? null,
      backgroundId: background.id,
      featIds: [feat.id],
      replaceBackgroundFeat: true,
      level: 1,
    }, content);
    const failures = [
      ...result.unresolvedNonSpell.map((issue) => `non-spell: ${issue}`),
      ...result.unresolvedSpell.map((issue) => `spell: ${issue}`),
      ...result.issues.map((issue) => `completion: ${issue}`),
    ];
    if (failures.length > 0) {
      throw new Error(
        `${klass.card_number}/${background.card_number}/${lineage?.card_number ?? race.card_number}: ${failures.join('; ')}`,
      );
    }
    result.draft.name = `Mini-MVP · ${klass.card_number} · ${background.card_number}`;
    result.draft.classEquipmentOption = 'a';
    result.draft.equipmentOption = 'a';
    roots.push({
      classCardNumber: klass.card_number,
      raceCardNumber: race.card_number,
      ...(lineage ? { lineageCardNumber: lineage.card_number } : {}),
      backgroundCardNumber: background.card_number,
      featCardNumber: feat.card_number,
      draft: result.draft,
    });
  };

  for (let index = 0; index < backgrounds.length; index += 1) {
    const klass = classes[index % classes.length];
    const race = species[index % species.length];
    const background = backgrounds[index];
    const feat = originFeats[index % originFeats.length];
    const variants = lineagesByRace.get(race.card_number) ?? [];
    await buildRoot(klass, race, background, feat, variants[index % Math.max(variants.length, 1)]);
  }

  const coveredLineages = new Set(roots.flatMap((root) => (
    root.lineageCardNumber ? [root.lineageCardNumber] : []
  )));
  const allLineages = species.flatMap((race) => lineagesByRace.get(race.card_number) ?? []);
  for (const [offset, lineage] of allLineages.entries()) {
    if (coveredLineages.has(lineage.card_number)) continue;
    const parent = species.find((race) => race.id === lineage.parent_race_id);
    if (!parent) throw new Error(`${lineage.card_number}: parent species is absent from the manifest`);
    const index = backgrounds.length + offset;
    await buildRoot(
      classes[index % classes.length],
      parent,
      backgrounds[index % backgrounds.length],
      originFeats[index % originFeats.length],
      lineage,
    );
  }

  return {
    schemaVersion: 2,
    strategy: 'cyclic-covering-set-with-lineages-v2',
    coverage: {
      classes: cardNumbers(classes),
      species: cardNumbers(species),
      lineages: cardNumbers(allLineages),
      backgrounds: cardNumbers(backgrounds),
      originFeats: cardNumbers(originFeats),
    },
    roots,
  };
}
