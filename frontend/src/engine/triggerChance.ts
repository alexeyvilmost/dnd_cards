import type {EngineEvent} from '../mvp/contracts';
import {drawDie} from './random';
type Dict=Record<string,unknown>;
export function validateTriggerChance(value:unknown):value is {die:number;equals:number[]}{
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const chance=value as Dict;
  return Number.isInteger(chance.die)&&Number(chance.die)>=2&&Number(chance.die)<=1000
    &&Array.isArray(chance.equals)&&chance.equals.length>0&&chance.equals.every(face=>Number.isInteger(face)&&Number(face)>=1&&Number(face)<=Number(chance.die));
}
export function triggerChance(value:unknown,name:string,rng:()=>number):{success:boolean;events:EngineEvent[]}{
  if(value===undefined)return {success:true,events:[]};
  if(!validateTriggerChance(value))throw Error('Invalid event chance');
  const result=drawDie(rng,value.die);
  return {success:value.equals.includes(result),events:[{type:'roll',label:name,roll:{kind:'other',advantage:'none',
    dice:[{sides:value.die,result}],modifiers:[],total:result,text:`${name}: 1d${value.die} = ${result}`}}]};
}
