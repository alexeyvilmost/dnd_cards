import type {ExecuteContext,EngineEvent} from '../mvp/contracts';
import {rollFormula} from './formula';
import {rollEvent} from './events';

type Dict=Record<string,unknown>;

/** Roll a declared value once, then reuse it for every automatic consequence.
 * Validation uses its own RNG; caller RNG is consumed only after payment checks.
 * Roll/save continuations require a stored binding context and are deliberately
 * rejected here instead of sampling the value again on resume. */
export function actionFormulaBindings(mechanics:Dict,ctx:ExecuteContext,validate=false):{context:ExecuteContext;events:EngineEvent[]} {
  if(mechanics.formula_bindings===undefined)return {context:ctx,events:[]};
  const bindings=mechanics.formula_bindings;
  if(!bindings||typeof bindings!=='object'||Array.isArray(bindings)
    ||!Array.isArray(mechanics.effects)||mechanics.effects.some(effect=>!effect||typeof effect!=='object'||effect.resolution!=='auto')){
    throw Error('Shared formula bindings require automatic effects');
  }
  const variables={...ctx.character.variables};
  const events:EngineEvent[]=[];
  for(const [key,expression] of Object.entries(bindings)){
    if(!/^[a-z][a-z0-9_]*$/u.test(key)||(typeof expression!=='string'&&typeof expression!=='number'))throw Error('Invalid shared formula binding');
    const result=rollFormula(String(expression),{
      abilityMods:ctx.character.abilityMods,profBonus:ctx.character.profBonus,selfLevel:ctx.character.level,
      classLevels:ctx.character.classLevels,spellcastingMod:ctx.character.spellcastingMod,variables,
    },{rng:validate?()=>0.5:ctx.rng});
    if(!Number.isFinite(result.total))throw Error('Shared formula must resolve to a finite number');
    variables[key]=result.total;
    if(!validate&&result.dice.length)events.push(rollEvent(ctx.actionName??'Общий бросок',{
      kind:'other',advantage:'none',dice:result.dice,modifiers:result.modifiers,total:result.total,text:result.text,
    }));
  }
  return {context:{...ctx,character:{...ctx.character,variables}},events};
}
