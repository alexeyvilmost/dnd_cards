import type { ActionWorldInput } from '../rules-core/domain';
import type { WorldObjectFacts } from '../rules-core/worldObjects';

export type CombatBoardWorldFacts = Pick<
  WorldObjectFacts,
  'factsSource' | 'boardRevision' | 'distanceFt' | 'lineOfSight'
>;

const mergeFacts = (
  original: WorldObjectFacts,
  board: CombatBoardWorldFacts,
): WorldObjectFacts => ({ ...original, ...board });

/** Replace scenario-authored spatial facts with the clicked tactical-cell facts,
 * while retaining option-specific facts such as touch, volume, and area membership. */
export function bindCombatWorldInputFacts(
  input: ActionWorldInput,
  board: CombatBoardWorldFacts,
): ActionWorldInput {
  switch (input.type) {
    case 'target_object':
    case 'mending':
    case 'minor_illusion':
    case 'dancing_lights':
      return { ...input, facts: mergeFacts(input.facts, board) };
    case 'area_objects':
    case 'purify_food_drink':
      return {
        ...input,
        factsByObject: Object.fromEntries(Object.entries(input.factsByObject).map(([id, facts]) => (
          [id, mergeFacts(facts, board)]
        ))),
      };
    case 'druidcraft':
      return {
        ...input,
        option: { ...input.option, facts: mergeFacts(input.option.facts, board) },
      };
    case 'prestidigitation':
      return {
        ...input,
        option: { ...input.option, facts: mergeFacts(input.option.facts, board) },
      };
  }
}
