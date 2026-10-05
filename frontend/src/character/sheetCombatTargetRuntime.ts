import {actionsApi, cardsApi, effectsApi, spellsApi} from '../api/client';
import {loadAssembly} from './assemble';
import {loadMasteryEffectsStrict} from '../utils/mastery';
import {createSheetCombatRuntime} from './sheetCombatRuntimeFactory';
import {measureClientPhase} from '../api/performanceTelemetry';
export * from './sheetCombatRuntimeFactory';
const runtime = createSheetCombatRuntime({get actionsApi() {return actionsApi;}, get cardsApi() {return cardsApi;}, get effectsApi() {return effectsApi;}, get spellsApi() {return spellsApi;}, get loadAssembly() {return loadAssembly;}, get loadMasteryEffectsStrict() {return loadMasteryEffectsStrict;}});
export const {resolveSheetCombatArmorClass, hydrateSheetCombatCards, collectSheetCombatActionInventory} = runtime;
// Browser adapter only: the shared factory and pinned worker bytes stay intact.
export const loadSheetCanonicalParticipant = (...args: Parameters<typeof runtime.loadSheetCanonicalParticipant>) =>
  measureClientPhase('sheet_canonical_participant', () => runtime.loadSheetCanonicalParticipant(...args));
export const loadSheetCombatParticipant = (...args: Parameters<typeof runtime.loadSheetCombatParticipant>) =>
  measureClientPhase('sheet_combat_participant', () => runtime.loadSheetCombatParticipant(...args));
