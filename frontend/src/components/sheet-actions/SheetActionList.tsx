import {useSiteSettings} from '../../settings';
import type {SheetAction} from '../../character/actionSheet';
import type {CharacterContext, RuntimeState} from '../../mvp/contracts';
import type {SheetCanonicalRuntime} from '../../character/sheetCanonicalWorld';
import {projectActionSurgeCost, projectQuickenedSpellCost} from '../../engine/actionSurge';
import {isSpellActionPrepared} from '../../rules-core/spellcastingAccess';
import {weaponAttackPreview} from '../../engine/weapon';
import {getSpellLevelLabel} from '../../types';
import SheetActionGroups, {sheetActionGroups} from '../SheetActionGroups';
import SheetActionLine from '../SheetActionLine';
import {sheetTriggerOnlyReason, sheetSpellActionsForPresentation, sheetActionDisplayName, actionDetail} from './actionModel';

export interface SheetActionListProps {
  actions: readonly SheetAction[];
  allActions: readonly SheetAction[];
  spellsOnly: boolean;
  actionsAsIcons: boolean;
  runtime: RuntimeState;
  ctx: CharacterContext;
  passives: Record<string, unknown>[];
  canonicalBuild: {runtime: SheetCanonicalRuntime | null; error: Error | null};
  disabledInfo: (action: SheetAction) => {disabled: boolean; reason?: string};
  spellcasting?: {saveDC?: number; attack?: number} | null;
  panelDisabledReason?: string;
  disableHoverPreviews?: boolean;
  onInspectAction?: (action: SheetAction, apply: () => void, disabledReason?: string) => void;
  runAction: (action: SheetAction) => void | Promise<void>;
}

/** Shared canonical row/icon presentation. Desktop sheet, mobile inspection and
 * encounter sheet surfaces all pass the same availability and command handlers. */
export default function SheetActionList({actions, allActions, spellsOnly, actionsAsIcons,
  runtime, ctx, passives, canonicalBuild, disabledInfo, spellcasting,
  panelDisabledReason, disableHoverPreviews, onInspectAction, runAction}: SheetActionListProps) {
  const spellIsPrepared = (action: SheetAction): boolean => {
    if (!action.spellRef) return true;
    const canonical = canonicalBuild.runtime;
    if (!canonical) return false;
    const access = canonical.world.actors[canonical.actorId]?.spellcastingAccess;
    if (!access) return false;
    const sourceActions = canonical.actionsFor?.(action) ?? [];
    return sourceActions.some((candidate) => isSpellActionPrepared(access, candidate.id));
  };

  const {hideUnavailableActions} = useSiteSettings();
  const availability = (action: SheetAction) => {
    if (action.spellRef && canonicalBuild.runtime && !canonicalBuild.error && !spellIsPrepared(action)) {
      return {disabled: true, reason: 'Заклинание не подготовлено'};
    }
    const reason = sheetTriggerOnlyReason(action.mechanics);
    return reason ? {disabled: true, reason} : disabledInfo(action);
  };
  const visible = (action: SheetAction) => !hideUnavailableActions || !availability(action).disabled;

  const actionBlockActions = actions.filter((action) => {
    const projectedMechanics = projectQuickenedSpellCost(
      projectActionSurgeCost(
        action.mechanics,
        runtime,
        action.spellRef ? 'spell' : 'nonspell',
      ),
      runtime,
      action.spellRef ? 'spell' : 'nonspell',
    );
    const activation = projectedMechanics.activation as Record<string, unknown> | undefined;
    // Reactions remain actor capabilities for canonical combat, but are never
    // manually activatable entries in the ordinary Action block.
    if (activation?.mode === 'reaction') return false;
    return (action.group !== 'spell' || spellIsPrepared(action)) && visible(action);
  });

  const allGroups = sheetActionGroups(actionBlockActions);
  // Режим «только заклинания»: группировка по кругам (тот же SheetActionLine и то же
  // поведение по клику/наведению, что и в блоке «Действия»).
  const spellLevelGroups: { key: string; label: string; items: SheetAction[] }[] = (() => {
    const m = new Map<number, SheetAction[]>();
    for (const a of sheetSpellActionsForPresentation(allActions).filter(visible)) {
      const lvl = a.spellRef?.level ?? a.level ?? 0;
      if (!m.has(lvl)) m.set(lvl, []);
      m.get(lvl)!.push(a);
    }
    return [...m.entries()].sort((x, y) => x[0] - y[0]).map(([lvl, items]) => ({ key: `lvl-${lvl}`, label: getSpellLevelLabel(lvl), items }));
  })();
  const groups = spellsOnly ? spellLevelGroups : allGroups;


  return (
      <SheetActionGroups groups={groups} icons={actionsAsIcons} bySpellLevel={spellsOnly} renderAction={(action) => {
              // Loading/build failures are not preparation failures. Preserve
              // their real reason in the hover card until canonical access is
              // available; only then can an actor-owned grant be called
              // unprepared.
              const { disabled, reason } = availability(action);
              const weaponPreview = weaponAttackPreview(action.mechanics, ctx, runtime.equipment, runtime, passives) ?? undefined;
              return (
                <div key={action.id} data-action-id={action.id} style={actionsAsIcons ? { display: 'contents' } : undefined}>
                <SheetActionLine
                  name={sheetActionDisplayName(action)}
                  imageUrl={action.imageUrl}
                  sourceLabel={action.sourceLabel ?? (action.group === 'basic' ? 'Базовое действие' : undefined)}
                  description={action.group === 'basic' ? action.description ?? action.name : undefined}
                  detail={actionDetail(action)}
                  level={action.level}
                  variant={actionsAsIcons ? 'icon' : 'row'}
                  actionRef={action.actionRef}
                  itemRef={action.itemRef}
                  runtime={runtime}
                  effectRef={action.effectRef}
                  spellRef={action.spellRef}
                  spellcasting={spellcasting
                    ? { saveDC: spellcasting.saveDC, attack: spellcasting.attack }
                    : undefined}
                  weaponAttackPreview={weaponPreview}
                  disabled={disabled}
                  disabledTitle={reason ?? 'Недостаточно ресурсов'}
                  inlineDisabledReason={!panelDisabledReason}
                  disableHover={disableHoverPreviews}
                  inspectMode={!!onInspectAction}
                  onActivate={() => onInspectAction
                    ? onInspectAction(action, () => { void runAction(action); }, disabled ? (reason ?? 'Недостаточно ресурсов') : undefined)
                    : runAction(action)}
                />
                </div>
              );
      }}/>
  );
}
