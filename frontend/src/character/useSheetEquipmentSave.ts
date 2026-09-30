import { useCallback, useEffect, useRef, useState } from 'react';
import type { CharacterRuntimeCommandRequest, CharacterRuntimeCommandResponse } from './api';
import { commitSheetEquipmentRequest } from './sheetEquipmentCommit';
import type { ForgeCharacter } from './types';

export type SheetEquipmentOperation = { equip: string } | { unequip: string };

export const pendingEquipmentKey = (characterId: string) => `dnd:pending-equipment:v1:${characterId}`;

function readPending(key: string): CharacterRuntimeCommandRequest | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try { return JSON.parse(raw) as CharacterRuntimeCommandRequest; }
  catch { localStorage.removeItem(key); return null; }
}

/** Mounted once per character. Retries persist and resend the original transition,
 * never rerun its rules, random choices or resource payments. */
export function useSheetEquipmentSave(input: {
  characterId: string;
  disabled: boolean;
  prepare: (operation: SheetEquipmentOperation) => Promise<CharacterRuntimeCommandRequest>;
  commit: (request: CharacterRuntimeCommandRequest) => Promise<CharacterRuntimeCommandResponse>;
  loadCurrent: (characterId: string) => Promise<ForgeCharacter>;
  onUpdated: (character: ForgeCharacter) => void;
}) {
  const key = pendingEquipmentKey(input.characterId);
  const [pending, setPending] = useState(() => readPending(key));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(pending);
  const savingRef = useRef(false);
  const mounted = useRef(true);
  const latest = useRef(input);
  latest.current = input;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const save = useCallback(async (operation?: SheetEquipmentOperation) => {
    const current = latest.current;
    if (current.disabled || savingRef.current) return false;
    if (operation && pendingRef.current) {
      setError('Предыдущее изменение ещё не подтверждено. Повторите сохранение перед новым выбором.');
      return false;
    }
    if (!operation && !pendingRef.current) return false;
    savingRef.current = true;
    setSaving(true); setError(null);
    let definitelyRejected = false;
    let commandId: string | undefined;
    const clear = () => {
      // Another tab may have stored a different transition while this POST
      // was in flight. Its uncertain outcome does not belong to this receipt.
      const stored = readPending(key);
      const next = stored?.command_id === commandId ? null : stored;
      if (stored?.command_id === commandId) localStorage.removeItem(key);
      pendingRef.current = next;
      if (mounted.current) setPending(next);
    };
    try {
      let request = pendingRef.current;
      if (!request) {
        request = await current.prepare(operation!);
        localStorage.setItem(key, JSON.stringify(request));
        pendingRef.current = request;
        if (mounted.current) setPending(request);
      }
      const immutable = request;
      commandId = immutable.command_id;
      const result = await commitSheetEquipmentRequest({
        request: immutable,
        commit: () => current.commit(immutable),
        loadCurrent: current.loadCurrent,
        viewingCharacterId: current.characterId,
        onDefinitiveRejection: () => { definitelyRejected = true; clear(); },
      });
      clear();
      if (mounted.current) current.onUpdated(result.characters[current.characterId]);
      return true;
    } catch (cause) {
      if (definitelyRejected) {
        try {
          const character = await current.loadCurrent(current.characterId);
          if (mounted.current) current.onUpdated(character);
        } catch { /* Preserve the original command error. */ }
      }
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Не удалось сохранить экипировку');
      return false;
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  }, [key]);

  // A lost response must not leave a permanent UI lock after a reload. One
  // idempotent reconciliation attempt is sufficient; persistent failures retain
  // the request and the explicit retry control rather than loop indefinitely.
  const reconciled = useRef(false);
  useEffect(() => {
    if (input.disabled || reconciled.current) return;
    reconciled.current = true;
    if (pendingRef.current) void save();
  }, [input.disabled, save]);

  useEffect(() => {
    const online = () => { if (pendingRef.current) void save(); };
    window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  }, [save]);

  return { pending, saving, error, save };
}
