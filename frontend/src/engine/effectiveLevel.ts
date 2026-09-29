import type {CharacterContext} from '../mvp/contracts';
type Dict=Record<string,unknown>;
/** Total-level bonuses never fabricate class levels, Hit Dice, or selections. */
export function effectiveLevel(character:CharacterContext,payloads:readonly Dict[]):{level:number;proficiencyDelta:number}{
 let level=character.level;
 for(const payload of payloads){
  if(payload.kind!=='effective_level')continue;
  if(!Number.isSafeInteger(payload.amount)||Number(payload.amount)<1)throw Error('Effective level amount must be a positive integer');
  level+=Number(payload.amount);
 }
 return {level,proficiencyDelta:Math.floor((level-1)/4)-Math.floor((character.level-1)/4)};
}
