import { useCallback } from 'react';
import { actionsApi, effectsApi } from '../api/client';

/**
 * Единые загрузчики эффектов/действий для конструкторов класса/расы/черты.
 * - loadEffects/loadActions — список для выбора (первые 200);
 * - resolveEffects/resolveActions — догрузка имён для уже привязанных id вне окна limit:200
 *   (иначе в редакторе показываются голые UUID).
 */
export function useEffectActionLoaders() {
  const loadEffects = useCallback(async () => {
    const res = await effectsApi.getEffects({ limit: 200 });
    return res.effects.map((e) => ({ id: e.id, name: e.name, card_number: e.card_number, repeatable: e.repeatable }));
  }, []);

  const loadActions = useCallback(async () => {
    const res = await actionsApi.getActions({ limit: 200 });
    return res.actions.map((a) => ({ id: a.id, name: a.name, card_number: a.card_number }));
  }, []);

  const resolveEffects = useCallback(async (ids: string[]) => {
    const got = await Promise.all(ids.map((id) => effectsApi.getEffect(id).then((e) => ({ id: e.id, name: e.name, card_number: e.card_number })).catch(() => null)));
    return got.filter((x): x is NonNullable<typeof x> => x != null);
  }, []);

  const resolveActions = useCallback(async (ids: string[]) => {
    const got = await Promise.all(ids.map((id) => actionsApi.getAction(id).then((a) => ({ id: a.id, name: a.name, card_number: a.card_number })).catch(() => null)));
    return got.filter((x): x is NonNullable<typeof x> => x != null);
  }, []);

  return { loadEffects, loadActions, resolveEffects, resolveActions };
}
