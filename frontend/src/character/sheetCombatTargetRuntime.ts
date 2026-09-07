import {actionsApi, cardsApi, effectsApi} from '../api/client';
import {loadAssembly} from './assemble';
import {loadMasteryEffectsStrict} from '../utils/mastery';
import {createSheetCombatRuntime} from './sheetCombatRuntimeFactory';
export * from './sheetCombatRuntimeFactory';
const runtime = createSheetCombatRuntime({get actionsApi() {return actionsApi;}, get cardsApi() {return cardsApi;}, get effectsApi() {return effectsApi;}, get loadAssembly() {return loadAssembly;}, get loadMasteryEffectsStrict() {return loadMasteryEffectsStrict;}});
export const {resolveSheetCombatArmorClass, hydrateSheetCombatCards, collectSheetCombatActionInventory, loadSheetCombatParticipant} = runtime;
