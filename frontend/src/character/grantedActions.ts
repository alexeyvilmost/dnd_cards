import { useEffect, useMemo, useState } from 'react';
import { actionsApi } from '../api/client';
import { instanceFeatureId } from '../mechanics/choiceKey';
import type { Card } from '../types';
import type { AssembledCharacter } from './assemble';
import {
  collectGrantActionSlugs,
  type GrantedAction,
  type SheetAction,
} from './actionSheet';

export interface GrantedActionItemMechanics {
  card: Card;
  mechanics: Record<string, unknown>;
}

export interface GrantedActionRequest {
  slug: string;
  sourceLabel: string;
  group: SheetAction['group'];
}

const NO_RESOLVED_CHOICES: Readonly<Record<string, readonly string[]>> = {};

function grantGateLevel(
  origin: AssembledCharacter['effects'][number]['origin'],
  characterLevel: number,
): number {
  if (origin.kind !== 'class') return characterLevel;
  return origin.owningClassLevel ?? characterLevel;
}

/**
 * One source of truth for every surface that needs granted action cards. The
 * action panel, resource synchronizer, and rest controls must resolve exactly
 * the same refs or a limited action can appear without owning/recharging its
 * `uses_<action>` pool.
 */
export function collectGrantedActionRequests(
  assembled: AssembledCharacter,
  characterLevel: number,
  resolvedChoices: Readonly<Record<string, readonly string[]>>,
  itemMechanics: readonly GrantedActionItemMechanics[] = [],
): GrantedActionRequest[] {
  const requests: GrantedActionRequest[] = [];
  const seen = new Set<string>();
  const collect = (
    mechanics: Record<string, unknown> | null | undefined,
    sourceLabel: string,
    group: SheetAction['group'],
    choiceContext?: Parameters<typeof collectGrantActionSlugs>[2],
  ) => {
    for (const slug of collectGrantActionSlugs(mechanics, characterLevel, choiceContext)) {
      if (seen.has(slug)) continue;
      seen.add(slug);
      requests.push({ slug, sourceLabel, group });
    }
  };

  for (const item of itemMechanics) {
    collect(item.mechanics, item.card.name, 'item');
  }
  for (const { effect, origin } of assembled.effects) {
    for (const slug of collectGrantActionSlugs(
      effect.mechanics as Record<string, unknown> | null | undefined,
      grantGateLevel(origin, characterLevel),
      {
        resolvedChoices,
        origin: {
          ...origin,
          featureId: instanceFeatureId(effect.id, origin.instanceKey),
          featureName: effect.name,
        },
      },
    )) {
      if (seen.has(slug)) continue;
      seen.add(slug);
      requests.push({
        slug,
        sourceLabel: effect.name,
        group: origin.kind === 'race' ? 'race' : 'class',
      });
    }
  }
  return requests;
}

export function useGrantedActions({
  assembled,
  characterLevel,
  resolvedChoices,
  itemMechanics = [],
  disabled = false,
}: {
  assembled: AssembledCharacter;
  characterLevel: number;
  resolvedChoices?: Readonly<Record<string, readonly string[]>> | null;
  itemMechanics?: readonly GrantedActionItemMechanics[];
  disabled?: boolean;
}): GrantedAction[] {
  const requests = useMemo(
    () => disabled
      ? []
      : collectGrantedActionRequests(
        assembled,
        characterLevel,
        resolvedChoices ?? NO_RESOLVED_CHOICES,
        itemMechanics,
      ),
    [assembled, characterLevel, resolvedChoices, itemMechanics, disabled],
  );
  const [actions, setActions] = useState<GrantedAction[]>([]);

  useEffect(() => {
    if (!requests.length) {
      setActions((current) => (current.length ? [] : current));
      return;
    }
    let stale = false;
    Promise.all(requests.map((request): Promise<GrantedAction | null> => (
      actionsApi.getAction(request.slug)
        .then((action) => ({
          action,
          sourceLabel: request.sourceLabel,
          group: request.group,
        }))
        .catch(() => null)
    ))).then((loaded) => {
      if (!stale) setActions(loaded.filter((action): action is GrantedAction => action !== null));
    }).catch(() => {
      if (!stale) setActions((current) => (current.length ? [] : current));
    });
    return () => { stale = true; };
  }, [requests]);

  return actions;
}
