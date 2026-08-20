import { autoBuildAt, type BuildContent } from './autoBuild';
import type { CharacterDraft } from '../character/types';
import type { Background, CharacterClass, Feat, Race } from '../types';
import type { MiniMvpForgeManifest } from './miniMvpForgeSheetFixtureGenerator';

export interface MiniMvpFightingStyleRoot {
  styleCardNumber: string;
  draft: CharacterDraft;
}

export interface MiniMvpFightingStyleFixture {
  schemaVersion: 1;
  strategy: 'one-fighter-per-style-v1';
  base: {
    classCardNumber: 'CLASS-warrior';
    raceCardNumber: 'RACE-0003';
    backgroundCardNumber: 'BG-0012';
    originFeatCardNumber: 'FEAT-0005';
  };
  coverage: { fightingStyles: string[] };
  roots: MiniMvpFightingStyleRoot[];
}

function exact<T extends { card_number: string }>(
  catalog: readonly T[],
  cardNumber: string,
  label: string,
): T {
  const matches = catalog.filter((entity) => entity.card_number === cardNumber);
  if (matches.length !== 1) {
    throw new Error(`${label}: expected one ${cardNumber}, got ${matches.length}`);
  }
  return matches[0];
}

function manifestCardNumbers(manifest: MiniMvpForgeManifest, collection: string): string[] {
  const entries = manifest.collections[collection];
  if (!Array.isArray(entries)) throw new Error(`mini-MVP manifest is missing ${collection}`);
  return entries.map((entry) => {
    const cardNumber = entry.selector.cardNumber;
    if (!cardNumber) throw new Error(`${entry.key}: cardNumber is required`);
    return cardNumber;
  });
}

/**
 * Creates ten real Fighter drafts, selecting every mini-MVP Fighting Style once.
 * The result is consumed both by a live assembler test and by the production
 * browser certificate, so the checked-in draft cannot drift away from live data.
 */
export async function buildMiniMvpFightingStyleFixture(
  manifest: MiniMvpForgeManifest,
  content: BuildContent,
): Promise<MiniMvpFightingStyleFixture> {
  const klass = exact<CharacterClass>(content.classes, 'CLASS-warrior', 'Fighter');
  const race = exact<Race>(content.races, 'RACE-0003', 'Dwarf');
  const background = exact<Background>(content.backgrounds, 'BG-0012', 'Soldier');
  const originFeat = exact<Feat>(content.feats, 'FEAT-0005', 'Tough');
  const styleCardNumbers = manifestCardNumbers(manifest, 'fightingStyles');
  const styles = styleCardNumbers.map((cardNumber) => (
    exact<Feat>(content.feats, cardNumber, `Fighting Style ${cardNumber}`)
  ));
  const roots: MiniMvpFightingStyleRoot[] = [];

  for (const style of styles) {
    const result = await autoBuildAt({
      classId: klass.id,
      raceId: race.id,
      backgroundId: background.id,
      featIds: [originFeat.id],
      replaceBackgroundFeat: true,
      preferredChoiceOptionIds: [style.id],
      level: 1,
    }, content);
    const failures = [
      ...result.unresolvedNonSpell.map((issue) => `non-spell: ${issue}`),
      ...result.unresolvedSpell.map((issue) => `spell: ${issue}`),
      ...result.issues.map((issue) => `completion: ${issue}`),
    ];
    const selectedStyles = result.assembled.feats
      .filter((feat) => feat.category === 'fighting_style');
    if (selectedStyles.length !== 1 || selectedStyles[0].id !== style.id) {
      failures.push(`selected styles: ${selectedStyles.map((feat) => feat.card_number).join(', ')}`);
    }
    if (failures.length > 0) {
      throw new Error(`${style.card_number}: ${failures.join('; ')}`);
    }
    result.draft.name = `Mini-MVP · ${style.card_number}`;
    result.draft.classEquipmentOption = 'a';
    result.draft.equipmentOption = 'a';
    roots.push({ styleCardNumber: style.card_number, draft: result.draft });
  }

  return {
    schemaVersion: 1,
    strategy: 'one-fighter-per-style-v1',
    base: {
      classCardNumber: 'CLASS-warrior',
      raceCardNumber: 'RACE-0003',
      backgroundCardNumber: 'BG-0012',
      originFeatCardNumber: 'FEAT-0005',
    },
    coverage: { fightingStyles: styleCardNumbers },
    roots,
  };
}
