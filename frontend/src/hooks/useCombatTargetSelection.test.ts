// @vitest-environment jsdom
import {act, createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {describe, expect, it, vi} from 'vitest';
import {hasManualTargetSlots, useCombatTargetSelection} from './useCombatTargetSelection';
import type {RuleActionDefinition} from '../rules-core/domain';

vi.mock('../contexts/ChoiceDialogContext', () => ({useChoiceDialog:()=>({request:vi.fn()})}));
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;

describe('manual actor targeting UI', () => {
  it.each([
    {domain:'world',shape:'area',area:{kind:'sphere',radius_ft:20}},
    {actor_targets:false,shape:'area',area:{kind:'cube',size_ft:15}},
    {shape:'self'},
  ])('does not parse an actor-target contract for %j', targeting => {
    const action={id:'world-area',mechanics:{targeting},targeting:{minTargets:0,maxTargets:0,allowedRelations:[]}} as unknown as RuleActionDefinition;
    expect(hasManualTargetSlots(action)).toBe(false);
  });
  it('retains multiple and single actor target contracts', () => {
    const action={id:'actor-action',mechanics:{targeting:{shape:'single'}},targeting:{minTargets:1,maxTargets:3,allowedRelations:['enemy'],rangeFt:60,requiresLineOfSight:true}} as unknown as RuleActionDefinition;
    expect(hasManualTargetSlots(action)).toBe(true);
    expect(hasManualTargetSlots({...action,targeting:{...action.targeting!,maxTargets:1}})).toBe(false);
  });

  it('clears all targeting modes and draft choices without applying or paying for an action', async () => {
    const node=document.createElement('div'),root=createRoot(node),applyIntent=Object.assign(vi.fn(), {upgrade:async()=>{}}),setError=vi.fn();
    let selection!:ReturnType<typeof useCombatTargetSelection>;
    function Probe() {
      selection=useCombatTargetSelection({state:null,busy:false,playerTurn:true,activeControlledActorId:'hero',activeDancingLightsGroup:undefined,
        presentationBlockedRef:{current:false},combatPassiveEnabled:{},applyIntent,requestSpellCastLevel:async()=>({}),setError});
      return null;
    }
    try {
      await act(async()=>root.render(createElement(Probe)));
      await act(async()=>{
        selection.setSelectedActionId('spell');selection.setSecondaryActionId('secondary');selection.setSelectedMovementTargetId('enemy');
        selection.setSelectedActionChoices({spell_cast_level:['2']});selection.setSelectedMultiTargetIds(['enemy']);
        selection.setSelectedMissileDarts({enemy:2});selection.setMovementMode(true);selection.setDancingLightsMoveGroupId('lights');
      });
      await act(async()=>selection.cancelSelection());
      expect(selection).toMatchObject({selectedActionId:null,secondaryActionId:null,selectedMovementTargetId:null,
        selectedActionChoices:{},selectedMultiTargetIds:[],selectedMissileDarts:{},movementMode:false,dancingLightsMoveGroupId:null});
      expect(applyIntent).not.toHaveBeenCalled();
      expect(setError).toHaveBeenLastCalledWith(null);
    } finally {await act(async()=>root.unmount());}
  });
});
