import type {ForgeCharacter} from '../character/types';
import type {SoloCombatState} from './types';

/** Portrait metadata is presentation only. Keep unchanged tokens/state by
 * identity so local hover and dialog renders cannot invalidate board caches. */
export function combatDisplayState(state:SoloCombatState|null,characters:Record<string,ForgeCharacter>,portraits:Record<string,string>):SoloCombatState|null{
  if(!state)return null;
  let tokens:SoloCombatState['tokens']|undefined;
  for(const [actorId,token] of Object.entries(state.tokens)){
    const tokenUrl=characters[actorId]?.avatar_url||(token.templateId&&portraits[token.templateId])||token.tokenUrl;
    if(tokenUrl===token.tokenUrl)continue;
    tokens??={...state.tokens};tokens[actorId]={...token,tokenUrl};
  }
  return tokens?{...state,tokens}:state;
}
