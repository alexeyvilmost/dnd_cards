import { racesApi, classesApi, backgroundsApi, featsApi, effectsApi, actionsApi, spellsApi, resourcesApi, variablesApi } from '../api/client';
import {createRegistry} from '../engine/registry';
import {createApiResolver} from '../engine/apiResolver';
import {createAssemblyRuntime} from './assemblyFactory';
import {createAssemblyMemo} from './assemblyMemo';
import {readPersistedAuthToken} from '../api/authSession';
export * from './assemblyFactory';

// API reads own identity, invalidation and freshness. A second permanent slug
// cache here would hide their updates and retain previous-owner declarations.
const runtime = createAssemblyRuntime({get racesApi() {return racesApi;}, get classesApi() {return classesApi;}, get backgroundsApi() {return backgroundsApi;}, get featsApi() {return featsApi;}, get effectsApi() {return effectsApi;}, get actionsApi() {return actionsApi;}, get spellsApi() {return spellsApi;}, get resourcesApi() {return resourcesApi;}, get variablesApi() {return variablesApi;}, entityRegistry: createRegistry(createApiResolver(), {cache: false}), memoizeAssembly: createAssemblyMemo(readPersistedAuthToken)});
export const {
  multiclassSpellSlotCounts,
  gatherFeatureRefs,
  bundleDependencyKey,
  assemble,
  loadBundle,
  collectEffectGrantRefs,
  collectFeatChoiceRefs,
  expandEffectGrants,
  expandItemGrantedEffects,
  loadAssembly
} = runtime;
