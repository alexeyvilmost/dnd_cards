import { useEffect, useMemo, useState } from 'react';
import { Check, Replace, X } from 'lucide-react';
import type { AssembledCharacter } from '../character/assemble';
import {
  applySkillConflictReplacement,
  availableReplacementSkills,
  conflictPartyPools,
  findConflictReplaceSlots,
  type ConflictReplaceSlot,
} from '../character/resolveConflict';
import { buildSavePayload } from '../character/forgeHelpers';
import { charactersV3Api } from '../character/api';
import type { CharacterDraft, ForgeCharacter } from '../character/types';
import { resolveCharacterRules } from '../character/rules/resolveCharacterRules';
import type { CharacterRuleState, RuleConflict } from '../character/rules/types';
import { SKILLS, labelOf } from '../mechanics/registries';
import SheetEntityRow from './SheetEntityRow';

interface Props {
  conflict: RuleConflict;
  character: ForgeCharacter;
  draft: CharacterDraft;
  assembled: AssembledCharacter;
  ruleState: CharacterRuleState;
  onUpdated: (c: ForgeCharacter) => void;
  onClose: () => void;
}

/**
 * Диалог разрешения дубля навыка: заменить выбор одного из источников
 * на навык из пулов участников конфликта, которым персонаж ещё не владеет.
 */
export default function SheetConflictResolveDialog({
  conflict, character, draft, assembled, ruleState, onUpdated, onClose,
}: Props) {
  const slots = useMemo(
    () => findConflictReplaceSlots(conflict, draft, assembled, ruleState),
    [conflict, draft, assembled, ruleState],
  );
  const partyPools = useMemo(
    () => conflictPartyPools(conflict, draft, assembled),
    [conflict, draft, assembled],
  );
  const [activeSlotId, setActiveSlotId] = useState(slots[0]?.choiceId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slots.some((s) => s.choiceId === activeSlotId)) {
      setActiveSlotId(slots[0]?.choiceId ?? '');
    }
  }, [slots, activeSlotId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const activeSlot: ConflictReplaceSlot | undefined =
    slots.find((s) => s.choiceId === activeSlotId) ?? slots[0];

  const options = useMemo(
    () => (activeSlot ? availableReplacementSkills(activeSlot, partyPools, ruleState) : []),
    [activeSlot, partyPools, ruleState],
  );

  const conflictLabel = conflict.value ? labelOf(SKILLS, conflict.value) : conflict.value;

  const pick = async (skillId: string) => {
    if (!activeSlot || busy) return;
    setBusy(true);
    setError(null);
    try {
      const nextDraft = applySkillConflictReplacement(draft, activeSlot, skillId, ruleState);
      const nextRules = resolveCharacterRules({ draft: nextDraft, assembled });
      const payload = buildSavePayload(nextDraft, assembled, nextRules, character.current_hp);
      const updated = await charactersV3Api.update(character.id, payload);
      // Клиентский снимок поверх ответа: навыки класса живут в resolved_choices + rule_state,
      // и лист пересчитывает владения из драфта — гарантируем, что замена сразу видна.
      onUpdated({
        ...updated,
        resolved_choices: payload.resolved_choices ?? updated.resolved_choices,
        rule_state: nextRules,
        skill_proficiencies: nextRules.proficiencies.skills,
        skill_expertise: nextRules.expertise.skills,
      });
      onClose();
    } catch (e) {
      console.error('resolve conflict', e);
      setError('Не удалось сохранить замену навыка');
    } finally {
      setBusy(false);
    }
  };

  if (!activeSlot) return null;

  const partyHint = partyPools
    .map((p) => p.sourceName)
    .filter((n, i, arr) => arr.indexOf(n) === i)
    .join(' / ');

  return (
    <div className="sheet-equip-overlay" onClick={onClose}>
      <div
        className="sheet-settings-dialog sheet-conflict-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Разрешить конфликт навыка"
      >
        <button type="button" className="sheet-equip-close" onClick={onClose} title="Закрыть (Esc)">
          <X size={18} />
        </button>

        <h2 className="sheet-settings-title">
          <Replace size={17} style={{ verticalAlign: '-3px', marginRight: 6 }} />
          Разрешить конфликт
        </h2>
        <p className="sheet-settings-hint">{conflict.message}</p>
        <p className="sheet-mastery-prompt">
          Выберите другой навык вместо «{conflictLabel}» для источника «{activeSlot.sourceName}».
          {partyHint && (
            <span className="origin"> · доступны {partyHint}</span>
          )}
        </p>

        {slots.length > 1 && (
          <div className="sheet-mastery-tabs">
            {slots.map((slot) => (
              <button
                key={slot.choiceId}
                type="button"
                className={`sheet-mastery-tab${slot.choiceId === activeSlot.choiceId ? ' is-on' : ''}`}
                onClick={() => setActiveSlotId(slot.choiceId)}
              >
                {slot.sourceName}
              </button>
            ))}
          </div>
        )}

        {error && <p className="issues">{error}</p>}

        <div className={`sheet-mastery-body${busy ? ' is-busy' : ''}`}>
          {options.length > 0 ? (
            <div className="sheet-mastery-grid">
              {options.map((opt) => (
                <SheetEntityRow
                  key={opt.id}
                  name={opt.label}
                  detail={opt.from.length ? `доступно: ${opt.from.join(', ')}` : undefined}
                  onClick={() => pick(opt.id)}
                  right={<Check size={16} className="sheet-mastery-check" style={{ opacity: 0.35 }} />}
                />
              ))}
            </div>
          ) : (
            <p className="sheet-settings-hint">
              Нет свободных навыков в списках этих источников.
            </p>
          )}
        </div>

        <div className="sheet-equip-actions">
          <button type="button" className="forge-btn sheet-equip-primary" onClick={onClose} disabled={busy}>
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}
