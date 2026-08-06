/**
 * Source-reference corrections shared by the canonical compiler and character
 * builder. They remove records that are attached to the wrong L1 owner in the
 * immutable source snapshot; executable replacements remain owned by the
 * versioned micro-MVP overlay.
 */
export function excludesMicroMvpL1SourceEffect(input: {
  characterLevel: number;
  raceCardNumber?: string;
  classCardNumber?: string;
  effectCardNumber?: string;
}): boolean {
  if (input.characterLevel !== 1) return false;
  if (input.raceCardNumber === 'RACE-0002' && input.effectCardNumber === 'RE-elf-3') {
    return true;
  }
  if (input.raceCardNumber === 'RACE-0008' && input.effectCardNumber === 'RE-dragonborn-4') {
    return true;
  }
  return input.classCardNumber === 'CLASS-warlock'
    && input.effectCardNumber === 'EFF-pact-boon';
}
