import { useCallback, useMemo, useState } from 'react';
import { charactersV3Api } from '../character/api';
import type { ForgeCharacter } from '../character/types';
import type { CharacterRuleState } from '../character/rules/types';
import {
  isWeaponMasteryChoice,
  type PendingChoice,
} from '../mechanics/collectChoices';
import SheetChoicesPanel from './SheetChoicesPanel';
import SheetIssuesFab, {
  SheetLongRestDialog,
  type SheetIssueItem,
  useIssuesFabState,
} from './SheetIssuesFab';
import SheetWeaponMasteryDialog from './SheetWeaponMasteryDialog';

interface Props {
  character: ForgeCharacter;
  choices: PendingChoice[];
  resolved: Record<string, string[]>;
  conflicts: CharacterRuleState['conflicts'];
  onUpdated: (c: ForgeCharacter) => void;
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
  choices,
  resolved,
  conflicts,
  onUpdated,
  longRestOpen,
  onLongRestClose,
}: Props) {
  const masteryChoices = useMemo(() => choices.filter(isWeaponMasteryChoice), [choices]);
  const otherChoices = useMemo(() => choices.filter((c) => !isWeaponMasteryChoice(c)), [choices]);

  const [masteryOpen, setMasteryOpen] = useState(false);
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

  const issueItems = useMemo((): SheetIssueItem[] => {
    const items: SheetIssueItem[] = [];
    for (const c of conflicts) {
      items.push({
        id: `conflict:${c.message}`,
        title: 'Конфликт правил',
        detail: c.message,
        severity: 'error',
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
  }, [conflicts, incomplete, resolved, openMastery]);

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
          busy={busy}
          error={error}
          onChange={setResolved}
          onClose={() => setMasteryOpen(false)}
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
