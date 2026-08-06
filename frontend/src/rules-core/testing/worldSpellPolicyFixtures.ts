import type { JsonObject } from '../domain';
import type { ManagedWorldSpellPrimitiveType } from '../worldSpellPolicies';

const BLOCKERS = {
  stone: { threshold_inches: 12, comparison: 'gte' },
  common_metal: { threshold_inches: 1, comparison: 'gte' },
  lead: { threshold_inches: 0, comparison: 'gt' },
  wood: { threshold_inches: 12, comparison: 'gte' },
  dirt: { threshold_inches: 12, comparison: 'gte' },
  other: null,
} as const;

const DECLARATIONS: Record<ManagedWorldSpellPrimitiveType, {
  targeting: JsonObject;
  primitive: JsonObject;
}> = {
  light_world_object: {
    targeting: {
      domain: 'world', actor_targets: false, range_ft: 0, allowed_relations: [],
      requires_line_of_sight: false, requires_touch: true, shape: 'single',
    },
    primitive: {
      type: 'light_world_object',
      policy: {
        max_object_size: 'large', exclude_carried_by_other: true,
        bright_radius_ft: 20, dim_additional_radius_ft: 20,
        duration_rounds: 600, max_active_per_source: 1,
      },
    },
  },
  burning_hands_objects: {
    targeting: {
      domain: 'mixed', actor_targets: true, range_ft: 15,
      allowed_relations: ['self', 'ally', 'enemy', 'neutral'],
      requires_line_of_sight: false, shape: 'area', max_targets: 8,
      area: { kind: 'cone', size_ft: 15 },
    },
    primitive: {
      type: 'burning_hands_objects',
      policy: { require_in_area: true, require_flammable: true, exclude_carried: true },
    },
  },
  detect_magic_world_sensing: {
    targeting: {
      domain: 'actor', actor_targets: false, range_ft: 0, allowed_relations: ['self'],
      requires_line_of_sight: false, shape: 'self',
      area: { kind: 'emanation', radius_ft: 30 },
    },
    primitive: {
      type: 'detect_magic_world_sensing',
      policy: {
        blockers: BLOCKERS, aura_requires_line_of_sight: true, reveal_spell_school_only: true,
      },
    },
  },
  minor_illusion_world_object: {
    targeting: {
      domain: 'world', actor_targets: false, range_ft: 30, allowed_relations: [],
      requires_line_of_sight: false, shape: 'single',
    },
    primitive: {
      type: 'minor_illusion_world_object',
      policy: {
        image_max_cube_side_ft: 5, duration_rounds: 10, max_active_per_source: 1,
        study_ability: 'int', study_skill: 'investigation',
      },
    },
  },
  dancing_lights_world: {
    targeting: {
      domain: 'world', actor_targets: false, range_ft: 120, allowed_relations: [],
      requires_line_of_sight: false, shape: 'multiple', max_targets: 1,
    },
    primitive: {
      type: 'dancing_lights_world',
      policy: {
        min_individual_lights: 1, max_individual_lights: 4,
        combined_form_object_count: 1, required_separation_ft: 20,
        max_move_ft: 60, dim_radius_ft: 10, duration_rounds: 10,
      },
    },
  },
  druidcraft_world: {
    targeting: {
      domain: 'world', actor_targets: false, range_ft: 30, allowed_relations: [],
      requires_line_of_sight: false, shape: 'single',
    },
    primitive: {
      type: 'druidcraft_world',
      policy: { sensory_cube_side_ft: 5, weather_duration_rounds: 1 },
    },
  },
  mending_world: {
    targeting: {
      domain: 'world', actor_targets: false, range_ft: 0, allowed_relations: [],
      requires_line_of_sight: false, requires_touch: true, shape: 'single',
    },
    primitive: { type: 'mending_world', policy: { max_break_dimension_ft: 1 } },
  },
  detect_poison_disease_world: {
    targeting: {
      domain: 'actor', actor_targets: false, range_ft: 0, allowed_relations: ['self'],
      requires_line_of_sight: false, shape: 'self',
      area: { kind: 'emanation', radius_ft: 30 },
    },
    primitive: { type: 'detect_poison_disease_world', policy: { blockers: BLOCKERS } },
  },
  purify_food_drink_world: {
    targeting: {
      domain: 'world', actor_targets: false, range_ft: 10, allowed_relations: [],
      requires_line_of_sight: false, shape: 'area', max_targets: 1,
      area: { kind: 'sphere', radius_ft: 5 },
    },
    primitive: {
      type: 'purify_food_drink_world',
      policy: { require_in_area: true, exclude_magical: true },
    },
  },
  prestidigitation_world: {
    targeting: {
      domain: 'world', actor_targets: false, range_ft: 10, allowed_relations: [],
      requires_line_of_sight: false, shape: 'single',
    },
    primitive: {
      type: 'prestidigitation_world',
      policy: {
        max_volume_cubic_ft: 1, max_active_effects: 3,
        attachment_duration_rounds: 600, creation_source_turn_endings: 2,
      },
    },
  },
  magic_missile: {
    targeting: {
      domain: 'actor', actor_targets: true, range_ft: 120,
      allowed_relations: ['self', 'ally', 'enemy', 'neutral'],
      requires_line_of_sight: true, requires_sight: true,
      shape: 'multiple', max_targets: 11,
    },
    primitive: {
      type: 'magic_missile',
      policy: {
        base_slot_level: 1, max_slot_level: 9, base_dart_count: 3,
        darts_per_slot_above: 1, allocation_choice_id: 'magic_missile_dart_targets',
        simultaneous: true,
        per_dart_effect: {
          resolution: 'auto', who: 'target',
          result: [{ kind: 'damage', dice: '1d4 + 1', type: 'force' }],
        },
      },
    },
  },
};

export function managedWorldSpellMechanics(
  primitiveType: ManagedWorldSpellPrimitiveType,
): { targeting: JsonObject; primitive: JsonObject } {
  return JSON.parse(JSON.stringify(DECLARATIONS[primitiveType])) as {
    targeting: JsonObject;
    primitive: JsonObject;
  };
}
