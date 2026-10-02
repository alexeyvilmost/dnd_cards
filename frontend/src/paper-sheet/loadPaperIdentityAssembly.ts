import { actionsApi, backgroundsApi, classesApi, effectsApi, featsApi, racesApi, resourcesApi, spellsApi, variablesApi } from '../api/client';
import { createAssemblyRuntime } from '../character/assemblyFactory';
import type { CharacterDraft } from '../character/types';
import { createRegistry } from '../engine/registry';

/**
 * The canonical assembler tolerates missing library records for interactive use.
 * A persisted paper snapshot must never replace complete data with a partial
 * response, so this request-scoped adapter records failures around the exact same
 * assembler and resolver operations. It owns no progression or mechanics rules.
 */
function checkedPaperRuntime() {
  const failures: unknown[] = [];
  const checked = <Args extends unknown[], Result>(load: (...args: Args) => Promise<Result>) => async (...args: Args): Promise<Result> => {
    try {
      const result = await load(...args);
      if (result == null) throw new Error('Пустой ответ каталога.');
      return result;
    }
    catch (cause) { failures.push(cause); throw cause; }
  };
  const getEffect = checked(effectsApi.getEffect);
  const getAction = checked(actionsApi.getAction);
  const getFeat = checked(featsApi.getFeat);
  const getSpell = checked(spellsApi.getSpell);
  const runtime = createAssemblyRuntime({
    racesApi: { getRace: checked(racesApi.getRace) },
    classesApi: { getClass: checked(classesApi.getClass) },
    backgroundsApi: { getBackground: checked(backgroundsApi.getBackground) },
    featsApi: { getFeat },
    effectsApi: { getEffect, getEffects: checked(effectsApi.getEffects) },
    actionsApi: { getAction },
    spellsApi: { getSpell },
    resourcesApi: { getResource: checked(resourcesApi.getResource) },
    variablesApi: { getVariables: checked(variablesApi.getVariables) },
    entityRegistry: createRegistry({
      resolveEffect: id => getEffect(id).catch(() => null),
      resolveAction: id => getAction(id).catch(() => null),
      resolveFeat: id => getFeat(id).catch(() => null),
      resolveSpell: id => getSpell(id).catch(() => null),
    }),
  });
  const assertComplete = () => {
    if (failures.length) throw new Error('Не все записи каталога загрузились. Сохранённые особенности не изменены.');
  };
  return { runtime, assertComplete };
}

export async function loadPaperIdentityAssembly(draft: CharacterDraft) {
  const { runtime, assertComplete } = checkedPaperRuntime();
  const assembly = await runtime.loadAssembly(draft);
  assertComplete();
  return assembly;
}

/** Reject even swallowed recursive item-reference failures before persisting a conversion. */
export async function loadPaperItemGrantedEffects(
  items: Parameters<ReturnType<typeof createAssemblyRuntime>['expandItemGrantedEffects']>[0],
  draft: CharacterDraft,
) {
  const { runtime, assertComplete } = checkedPaperRuntime();
  const effects = await runtime.expandItemGrantedEffects(items, draft);
  assertComplete();
  return effects;
}
