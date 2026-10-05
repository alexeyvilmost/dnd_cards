import type {PendingD20Interrupt, PendingTriggeredAction, SoloCombatState} from '../types';

export type DurableContinuationKey = Extract<keyof SoloCombatState, `pending${string}` | 'playerMovement' | 'monsterMovement' | 'monsterAttackSequence'>;
/** A new persisted continuation must acquire a replay case before this compiles. */
export const durableContinuationFields = {
  pendingAdditionalMovement:true,playerMovement:true,pendingReachEntry:true,pendingMovementStep:true,
  monsterAttackSequence:true,monsterMovement:true,pendingMonsterOnHitGrapple:true,pendingCombatAreaTriggers:true,
  pendingCombatAreaTurnContinuation:true,pendingTriggeredAction:true,pendingTurnStartGrappleDamage:true,
  pendingInterception:true,pendingInterceptionTrigger:true,pendingD20Interrupt:true,pendingRollInfluenceResume:true,
  pendingDeathSave:true,pendingAlertSwapActorIds:true,
} satisfies Record<DurableContinuationKey,true>;
export const durableD20Operations={impose_disadvantage:true,subtract_die:true,roll_influence:true,roll_choice:true} satisfies Record<PendingD20Interrupt['operation'],true>;
export const durableD20Timings={before_roll:true,after_roll_before_outcome:true,after_outcome:true} satisfies Record<PendingD20Interrupt['timing'],true>;
export const durableTriggeredEvents={commanded_attack:true,enemy_melee_miss:true,hit:true,miss:true,sneak_attack_hit:true,opportunity_attack:true,reach_entry:true,action_resolved:true,crit:true} satisfies Record<PendingTriggeredAction['event'],true>;
export const durableDeathSavePhases={rolled:true,resolved:true} satisfies Record<NonNullable<SoloCombatState['pendingDeathSave']>['phase'],true>;
