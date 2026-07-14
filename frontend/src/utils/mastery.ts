/**
 * Искусность оружия (Weapon Mastery, PHB 2024) — общий доступ к эффектам-мастерствам.
 *
 * Список мастерств — ДАННЫЕ: эффекты с type='Эффект мастерства' (EFFECT-0248..0255).
 * Никакого хардкода восьми свойств: добавили эффект с этим типом — он сам появился и в
 * конструкторе предмета, и в превью (парадигма №1).
 *
 * card.mastery хранит id такого эффекта; движок (engine/mastery.ts) исполняет его механику.
 */
import { useEffect, useState } from 'react';
import { effectsApi } from '../api/client';
import type { PassiveEffect } from '../types';

/** Маркер эффекта-мастерства в базе — единственный надёжный ключ выборки (имена — прилагательные). */
export const MASTERY_EFFECT_TYPE = 'Эффект мастерства';

let cache: PassiveEffect[] | null = null;
let inflight: Promise<PassiveEffect[]> | null = null;

/** Загрузить эффекты-мастерства (кэш на сессию — список статичный и маленький). */
export function loadMasteryEffects(): Promise<PassiveEffect[]> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = effectsApi.getEffects({ type: MASTERY_EFFECT_TYPE, limit: 100 })
      .then((r) => {
        // Бэкенд может игнорировать фильтр type — подстраховываемся клиентским отбором.
        cache = (r.effects || []).filter((e) => e.type === MASTERY_EFFECT_TYPE);
        return cache;
      })
      .catch(() => { inflight = null; return []; });
  }
  return inflight;
}

/** Эффекты-мастерства для селектов/превью. [] пока грузятся или если бэкенд недоступен. */
export function useMasteryEffects(): PassiveEffect[] {
  const [list, setList] = useState<PassiveEffect[]>(cache ?? []);
  useEffect(() => {
    let stale = false;
    loadMasteryEffects().then((l) => { if (!stale) setList(l); });
    return () => { stale = true; };
  }, []);
  return list;
}

/** Мастерство по id (card.mastery). undefined — не задано/не найдено. */
export function findMastery(list: PassiveEffect[], id?: string | null): PassiveEffect | undefined {
  if (!id) return undefined;
  return list.find((e) => e.id === id || e.card_number === id);
}
