import { useCallback, useMemo, useState } from 'react';
import { charactersV3Api } from '../character/api';
import type { AssembledCharacter } from '../character/assemble';
import type { CharacterDraft, ForgeCharacter } from '../character/types';
import type { CharacterRuleState, RuleConflict } from '../character/rules/types';
import { canResolveSkillConflict } from '../character/resolveConflict';
import {
  isWeaponMasteryChoice,
  type PendingChoice,
} from '../mechanics/collectChoices';
import type { Card } from '../types';
import SheetChoicesPanel from './SheetChoicesPanel';
import SheetConflictResolveDialog from './SheetConflictResolveDialog';
import SheetIssuesFab, {
  SheetLongRestDialog,
  type SheetIssueItem,
  useIssuesFabState,
} from './SheetIssuesFab';
import SheetWeaponMasteryDialog from './SheetWeaponMasteryDialog';

interface Props {
  character: ForgeCharacter;
  draft: CharacterDraft;
  assembled: AssembledCharacter;
  ruleState: CharacterRuleState;
  choices: PendingChoice[];
  resolved: Record<string, string[]>;
  conflicts: CharacterRuleState['conflicts'];
  onUpdated: (c: ForgeCharacter) => void;
  /** Карты инвентаря/экипировки — для приоритета видов в диалоге искусности. */
  equipCards?: Map<string, Card>;
  /** Сигнал «открыть диалог долгого отдыха» (счётчик/флаг с родителя). */
  longRestOpen: boolean;
  onLongRestClose: () => void;
}

/**
 * Выборы «в игре» на листе: искусность — в отдельном диалоге,
 * незавершённые выборы/ошибки — через FAB слева снизу.
 */
export default function SheetInPlayController({
  character,
  draft,
  assembled,
  ruleState,
  choices,
  resolved,
  conflicts,
  onUpdated,
  equipCards,
  longRestOpen,
  onLongRestClose,
}: Props) {
  const masteryChoices = useMemo(() => choices.filter(isWeaponMasteryChoice), [choices]);
  const otherChoices = useMemo(() => choices.filter((c) => !isWeaponMasteryChoice(c)), [choices]);

  const [masteryOpen, setMasteryOpen] = useState(false);
  const [conflictToResolve, setConflictToResolve] = useState<RuleConflict | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const incomplete = useMemo(
    () => choices.filter((c) => (resolved[c.id] || []).length < c.count),
    [choices, resolved],
  );

  const hasIssues = incomplete.length > 0 || conflicts.length > 0;
  const [issuesOpen, setIssuesOpen] = useIssuesFabState(hasIssues);

  const openMastery = useCallback(() => {
    setIssuesOpen(false);
    setMasteryOpen(true);
  }, [setIssuesOpen]);

  const openConflict = useCallback((c: RuleConflict) => {
    setIssuesOpen(false);
    setConflictToResolve(c);
  }, [setIssuesOpen]);

  const issueItems = useMemo((): SheetIssueItem[] => {
    const items: SheetIssueItem[] = [];
    for (const c of conflicts) {
      const resolvable = canResolveSkillConflict(c, draft, assembled, ruleState);
      items.push({
        id: `conflict:${c.code}:${c.value ?? ''}:${c.source?.id ?? ''}:${c.existingSource?.id ?? ''}`,
        title: 'Конфликт правил',
        detail: c.message,
        severity: c.severity === 'warning' ? 'warning' : 'error',
        actionLabel: resolvable ? 'Выбрать другой навык' : undefined,
        onAction: resolvable ? () => openConflict(c) : undefined,
      });
    }
    for (const pc of incomplete) {
      const picked = (resolved[pc.id] || []).length;
      if (isWeaponMasteryChoice(pc)) {
        items.push({
          id: `choice:${pc.id}`,
          title: 'Не выбрано мастерство оружия',
          detail: `${pc.prompt} · выбрано ${picked} из ${pc.count}`,
          actionLabel: 'Выбрать мастерство оружия',
          onAction: openMastery,
          severity: 'choice',
        });
      } else {
        items.push({
          id: `choice:${pc.id}`,
          title: pc.prompt,
          detail: `Выбрано ${picked} из ${pc.count} · ${pc.origin.name}`,
          severity: 'choice',
        });
      }
    }
    return items;
  }, [conflicts, incomplete, resolved, openMastery, openConflict, draft, assembled, ruleState]);

  const setResolved = async (choiceId: string, vals: string[]) => {
    setBusy(true);
    setError(null);
    try {
      const prev = (character.turn_state?.inPlayChoices as Record<string, string[]> | undefined) || {};
      const turn_state = { ...(character.turn_state || {}), inPlayChoices: { ...prev, [choiceId]: vals } };
      const updated = await charactersV3Api.patchRuntime(character.id, { turn_state });
      onUpdated(updated);
    } catch (e) {
      console.error('in-play choice', e);
      setError('Не удалось сохранить выбор');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {otherChoices.length > 0 && (
        <SheetChoicesPanel
          character={character}
          choices={otherChoices}
          resolved={resolved}
          onUpdated={onUpdated}
        />
      )}

      <SheetIssuesFab
        open={issuesOpen}
        onOpenChange={setIssuesOpen}
        items={issueItems}
      />

      {masteryOpen && masteryChoices.length > 0 && (
        <SheetWeaponMasteryDialog
          choices={masteryChoices}
          resolved={resolved}
          character={character}
          equipCards={equipCards}
          busy={busy}
          error={error}
          onChange={setResolved}
          onClose={() => setMasteryOpen(false)}
        />
      )}

      {conflictToResolve && (
        <SheetConflictResolveDialog
          conflict={conflictToResolve}
          character={character}
          draft={draft}
          assembled={assembled}
          ruleState={ruleState}
          onUpdated={onUpdated}
          onClose={() => setConflictToResolve(null)}
        />
      )}

      <SheetLongRestDialog
        open={longRestOpen}
        onClose={onLongRestClose}
        hasWeaponMastery={masteryChoices.length > 0}
        onOpenWeaponMastery={openMastery}
      />
    </>
  );
}
