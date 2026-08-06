import type { ActionWorldInput } from '../rules-core/domain';
import type {
  WorldObjectKind,
  WorldObjectSize,
  WorldObjectState,
  WorldObjectFacts,
} from '../rules-core/worldObjects';
import type { SheetCanonicalRuntime } from './sheetCanonicalWorld';
import {
  requireSheetWorldSpellPolicy,
  isSheetNoPendingPrimitive,
  sheetPrimitiveType,
  sheetPrimitiveWorldForm,
  type SheetPrimitiveWorldForm,
  type ValidSheetWorldSpellPolicy,
} from './sheetPrimitiveUi';
import type { RuleActionDefinition } from '../rules-core/domain';
import type {
  DancingLightsWorldPolicy,
  DruidcraftWorldPolicy,
  LightWorldPolicy,
  MendingWorldPolicy,
  MinorIllusionWorldPolicy,
  PrestidigitationWorldPolicy,
  PurifyFoodDrinkWorldPolicy,
} from '../rules-core/worldSpellPolicies';

export type SheetScenarioObjectProfile =
  | 'plain'
  | 'broken'
  | 'plant'
  | 'flame'
  | 'food'
  | 'drink';

export interface SheetWorldFactsDraft {
  factsSource: WorldObjectFacts['factsSource'];
  boardRevision: string;
  distanceFt: string;
  lineOfSight: boolean;
  touched: boolean;
  inArea: boolean;
  entirelyInArea: boolean;
  volumeCubicFt: string;
}

export interface SheetWorldInputFormDraft {
  objectId: string;
  selectedObjectIds: string[];
  createObject: boolean;
  newObjectId: string;
  newObjectName: string;
  newObjectKind: WorldObjectKind;
  newObjectSize: WorldObjectSize;
  newObjectProfile: SheetScenarioObjectProfile;
  breakDimensionFt: string;
  foodMagical: boolean;
  facts: SheetWorldFactsDraft;
  option: string;
  operation: string;
  description: string;
  form: string;
  imageCubeSideFt: string;
  sensoryCubeSideFt: string;
  placementDistancesFt: string;
  placementsWithinSeparation: boolean;
  sphereCenterDistanceFt: string;
  creationSize: WorldObjectSize;
  creationFitsInHand: boolean;
}

export interface SheetWorldInputFormIssue {
  fieldId: string;
  message: string;
}

export interface SheetWorldInputFormResult {
  worldInput: ActionWorldInput;
  scenarioObjects: WorldObjectState[];
}

export interface SheetWorldInputFormContext {
  runtime: SheetCanonicalRuntime;
  action: RuleActionDefinition;
  form: SheetPrimitiveWorldForm;
  parsed: ValidSheetWorldSpellPolicy;
}

function numberValue(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function defaultProfile(form: SheetPrimitiveWorldForm): SheetScenarioObjectProfile {
  if (form === 'mending') return 'broken';
  if (form === 'purify_food_drink') return 'food';
  if (form === 'druidcraft') return 'plant';
  return 'plain';
}

export function sheetWorldInputFormContext(input: {
  runtime: SheetCanonicalRuntime;
  action: RuleActionDefinition;
}): SheetWorldInputFormContext | null {
  const primitive = sheetPrimitiveType(input.action.mechanics);
  if (!primitive || !isSheetNoPendingPrimitive(primitive)) return null;
  const form = sheetPrimitiveWorldForm(primitive);
  if (!form) return null;
  return {
    runtime: input.runtime,
    action: input.action,
    form,
    parsed: requireSheetWorldSpellPolicy(input.action),
  };
}

export function initialSheetWorldInputDraft(
  context: SheetWorldInputFormContext,
  newObjectId: string,
): SheetWorldInputFormDraft {
  const objectIds = Object.keys(context.runtime.world.objects).sort();
  const firstObject = objectIds[0] ?? '';
  let imageCubeSideFt = '';
  let sensoryCubeSideFt = '';
  let placementDistancesFt = '0';
  let sphereCenterDistanceFt = '0';
  let breakDimensionFt = '';
  switch (context.parsed.primitiveType) {
    case 'minor_illusion_world_object':
      imageCubeSideFt = String((context.parsed.policy as MinorIllusionWorldPolicy).imageMaxCubeSideFt);
      break;
    case 'dancing_lights_world': {
      const policy = context.parsed.policy as DancingLightsWorldPolicy;
      placementDistancesFt = Array.from(
        { length: policy.minIndividualLights },
        () => '0',
      ).join(', ');
      break;
    }
    case 'druidcraft_world':
      sensoryCubeSideFt = String((context.parsed.policy as DruidcraftWorldPolicy).sensoryCubeSideFt);
      break;
    case 'mending_world':
      breakDimensionFt = String((context.parsed.policy as MendingWorldPolicy).maxBreakDimensionFt);
      break;
    case 'purify_food_drink_world':
      sphereCenterDistanceFt = '0';
      break;
    default:
      break;
  }
  return {
    objectId: firstObject,
    selectedObjectIds: firstObject ? [firstObject] : [],
    createObject: objectIds.length === 0,
    newObjectId,
    newObjectName: '',
    newObjectKind: 'item',
    newObjectSize: 'tiny',
    newObjectProfile: defaultProfile(context.form),
    breakDimensionFt,
    foodMagical: false,
    facts: {
      factsSource: 'scenario',
      boardRevision: '0',
      distanceFt: '0',
      lineOfSight: true,
      touched: context.parsed.targeting.requiresTouch,
      inArea: context.form === 'purify_food_drink',
      entirelyInArea: false,
      volumeCubicFt: '',
    },
    option: context.form === 'druidcraft'
      ? 'weather_sensor'
      : context.form === 'prestidigitation'
        ? 'sensory_effect'
        : '',
    operation: 'light',
    description: '',
    form: context.form === 'minor_illusion'
      ? 'sound'
      : context.form === 'dancing_lights'
        ? 'individual'
        : '',
    imageCubeSideFt,
    sensoryCubeSideFt,
    placementDistancesFt,
    placementsWithinSeparation: true,
    sphereCenterDistanceFt,
    creationSize: 'tiny',
    creationFitsInHand: true,
  };
}

function factsFromDraft(
  context: SheetWorldInputFormContext,
  draft: SheetWorldInputFormDraft,
  issues: SheetWorldInputFormIssue[],
): WorldObjectFacts | null {
  const boardRevision = numberValue(draft.facts.boardRevision);
  if (boardRevision === null || !Number.isInteger(boardRevision) || boardRevision < 0) {
    issues.push({ fieldId: 'sheet-world-board-revision', message: 'Укажите целую ревизию доски не меньше 0.' });
  }
  const distanceFt = numberValue(draft.facts.distanceFt);
  if (distanceFt === null || distanceFt < 0 || distanceFt > context.parsed.targeting.rangeFt) {
    issues.push({
      fieldId: 'sheet-world-distance',
      message: `Дистанция должна быть от 0 до ${context.parsed.targeting.rangeFt} футов.`,
    });
  }
  if (context.parsed.targeting.requiresLineOfSight && !draft.facts.lineOfSight) {
    issues.push({ fieldId: 'sheet-world-line-of-sight', message: 'Для этого действия требуется линия обзора.' });
  }
  if (context.parsed.targeting.requiresTouch && !draft.facts.touched) {
    issues.push({ fieldId: 'sheet-world-touched', message: 'Для этого действия требуется подтверждённое касание.' });
  }
  if (context.parsed.primitiveType === 'purify_food_drink_world'
    && (context.parsed.policy as PurifyFoodDrinkWorldPolicy).requireInArea
    && !draft.facts.inArea) {
    issues.push({ fieldId: 'sheet-world-in-area', message: 'Объекты должны явно находиться в области заклинания.' });
  }
  const volumeCubicFt = draft.facts.volumeCubicFt.trim()
    ? numberValue(draft.facts.volumeCubicFt)
    : null;
  if (volumeCubicFt !== null && volumeCubicFt <= 0) {
    issues.push({ fieldId: 'sheet-world-volume', message: 'Объём должен быть положительным числом.' });
  }
  if (context.parsed.primitiveType === 'prestidigitation_world'
    && volumeCubicFt !== null
    && volumeCubicFt > (context.parsed.policy as PrestidigitationWorldPolicy).maxVolumeCubicFt) {
    issues.push({
      fieldId: 'sheet-world-volume',
      message: `Объём превышает предел ${
        (context.parsed.policy as PrestidigitationWorldPolicy).maxVolumeCubicFt
      } куб. футов.`,
    });
  }
  if (issues.length || boardRevision === null || distanceFt === null) return null;
  return {
    factsSource: draft.facts.factsSource,
    boardRevision,
    distanceFt,
    lineOfSight: draft.facts.lineOfSight,
    touched: draft.facts.touched,
    inArea: draft.facts.inArea,
    entirelyInArea: draft.facts.entirelyInArea,
    ...(volumeCubicFt === null ? {} : { volumeCubicFt }),
  };
}

function scenarioObject(
  context: SheetWorldInputFormContext,
  draft: SheetWorldInputFormDraft,
  issues: SheetWorldInputFormIssue[],
): WorldObjectState | null {
  if (!draft.createObject) return null;
  if (!draft.newObjectId.trim()) {
    issues.push({ fieldId: 'sheet-world-new-object-name', message: 'Новый объект не получил идентификатор.' });
  }
  if (!draft.newObjectName.trim()) {
    issues.push({ fieldId: 'sheet-world-new-object-name', message: 'Назовите новый объект сценария.' });
  }
  const object: WorldObjectState = {
    id: draft.newObjectId,
    name: draft.newObjectName.trim(),
    kind: draft.newObjectKind,
    size: draft.newObjectSize,
  };
  if (draft.newObjectProfile === 'broken') {
    const dimension = numberValue(draft.breakDimensionFt);
    const maximum = context.parsed.primitiveType === 'mending_world'
      ? (context.parsed.policy as MendingWorldPolicy).maxBreakDimensionFt
      : Number.POSITIVE_INFINITY;
    if (dimension === null || dimension <= 0 || dimension > maximum) {
      issues.push({
        fieldId: 'sheet-world-break-dimension',
        message: `Размер повреждения должен быть от 0 до ${maximum} футов.`,
      });
    } else {
      object.breakOrTear = { maxDimensionFt: dimension, repaired: false };
    }
  } else if (draft.newObjectProfile === 'plant') {
    object.plant = { kind: 'flower', bloomed: false };
  } else if (draft.newObjectProfile === 'flame') {
    object.flame = { kind: 'candle', lit: false };
  } else if (draft.newObjectProfile === 'food' || draft.newObjectProfile === 'drink') {
    object.foodOrDrink = {
      kind: draft.newObjectProfile,
      magical: draft.foodMagical,
      poisoned: true,
      rotten: true,
    };
  }
  return object;
}

/** Whether the currently selected variant reads or creates a durable world object. */
export function sheetWorldInputNeedsObject(
  form: SheetPrimitiveWorldForm,
  draft: Pick<SheetWorldInputFormDraft, 'option'>,
): boolean {
  if (form === 'target_object' || form === 'mending' || form === 'purify_food_drink') return true;
  if (form === 'druidcraft') return draft.option === 'bloom' || draft.option === 'fire_play';
  if (form === 'prestidigitation') {
    return ['fire_play', 'clean_or_soil', 'minor_sensation', 'magic_mark'].includes(draft.option);
  }
  return false;
}

function selectedObjectId(
  draft: SheetWorldInputFormDraft,
  created: WorldObjectState | null,
  issues: SheetWorldInputFormIssue[],
): string {
  const id = created?.id ?? draft.objectId;
  if (!id) issues.push({ fieldId: 'sheet-world-object', message: 'Выберите или создайте объект.' });
  return id;
}

const WORLD_SIZE_ORDER: WorldObjectSize[] = [
  'tiny', 'small', 'medium', 'large', 'huge', 'gargantuan',
];

function selectedObject(
  context: SheetWorldInputFormContext,
  created: WorldObjectState | null,
  objectId: string,
  issues: SheetWorldInputFormIssue[],
): WorldObjectState | null {
  const value = created?.id === objectId
    ? created
    : context.runtime.world.objects[objectId];
  if (!value && objectId) {
    issues.push({
      fieldId: 'sheet-world-object',
      message: 'Выбранный объект отсутствует в текущей версии мира.',
    });
  }
  return value ?? null;
}

function nonBlankDescription(
  draft: SheetWorldInputFormDraft,
  issues: SheetWorldInputFormIssue[],
): string {
  const value = draft.description.trim();
  if (!value) issues.push({ fieldId: 'sheet-world-description', message: 'Добавьте явное описание результата.' });
  return value;
}

export function buildSheetWorldInput(
  context: SheetWorldInputFormContext,
  draft: SheetWorldInputFormDraft,
): { result: SheetWorldInputFormResult | null; issues: SheetWorldInputFormIssue[] } {
  const issues: SheetWorldInputFormIssue[] = [];
  const facts = factsFromDraft(context, draft, issues);
  const created = sheetWorldInputNeedsObject(context.form, draft)
    ? scenarioObject(context, draft, issues)
    : null;
  const scenarioObjects = created ? [created] : [];
  let worldInput: ActionWorldInput | null = null;

  if (context.form === 'target_object' || context.form === 'mending') {
    const objectId = selectedObjectId(draft, created, issues);
    const object = selectedObject(context, created, objectId, issues);
    if (context.parsed.primitiveType === 'light_world_object' && object) {
      const policy = context.parsed.policy as LightWorldPolicy;
      if (WORLD_SIZE_ORDER.indexOf(object.size) > WORLD_SIZE_ORDER.indexOf(policy.maxObjectSize)) {
        issues.push({
          fieldId: draft.createObject ? 'sheet-world-new-object-size' : 'sheet-world-object',
          message: `Размер объекта не может превышать ${policy.maxObjectSize}.`,
        });
      }
      if (policy.excludeCarriedByOther
        && object.carriedByActorId
        && object.carriedByActorId !== context.runtime.actorId) {
        issues.push({
          fieldId: 'sheet-world-object',
          message: 'Нельзя выбрать предмет, который несёт другое существо.',
        });
      }
    }
    if (context.form === 'mending' && object
      && (!object.breakOrTear || object.breakOrTear.repaired)) {
      issues.push({
        fieldId: 'sheet-world-object',
        message: 'Для Починки нужен явно описанный незалатанный разрыв или поломка.',
      });
    } else if (context.form === 'mending' && object?.breakOrTear
      && object.breakOrTear.maxDimensionFt
        > (context.parsed.policy as MendingWorldPolicy).maxBreakDimensionFt) {
      issues.push({
        fieldId: 'sheet-world-object',
        message: `Повреждение превышает предел ${(context.parsed.policy as MendingWorldPolicy).maxBreakDimensionFt} футов.`,
      });
    }
    if (facts && objectId && object && !issues.length) {
      worldInput = context.form === 'target_object'
        ? { type: 'target_object', objectId, facts }
        : { type: 'mending', objectId, facts };
    }
  } else if (context.form === 'minor_illusion') {
    const description = nonBlankDescription(draft, issues);
    if (draft.form !== 'sound' && draft.form !== 'image') {
      issues.push({ fieldId: 'sheet-world-form', message: 'Выберите звук или изображение.' });
    }
    let imageCubeSideFt: number | undefined;
    if (draft.form === 'image') {
      const side = numberValue(draft.imageCubeSideFt);
      const maximum = (context.parsed.policy as MinorIllusionWorldPolicy).imageMaxCubeSideFt;
      if (side === null || side <= 0 || side > maximum) {
        issues.push({ fieldId: 'sheet-world-image-size', message: `Сторона куба должна быть до ${maximum} футов.` });
      } else imageCubeSideFt = side;
    }
    if (facts && !issues.length && (draft.form === 'sound' || draft.form === 'image')) {
      worldInput = {
        type: 'minor_illusion',
        form: draft.form,
        description,
        ...(imageCubeSideFt === undefined ? {} : { imageCubeSideFt }),
        facts,
      };
    }
  } else if (context.form === 'dancing_lights') {
    const policy = context.parsed.policy as DancingLightsWorldPolicy;
    const distances = draft.placementDistancesFt.split(',').map((part) => Number(part.trim()));
    const requiredCount = draft.form === 'medium_humanoid'
      ? policy.combinedFormObjectCount
      : null;
    if ((draft.form !== 'individual' && draft.form !== 'medium_humanoid')
      || distances.some((distance) => !Number.isFinite(distance) || distance < 0
        || distance > context.parsed.targeting.rangeFt)
      || (requiredCount !== null && distances.length !== requiredCount)
      || (requiredCount === null && (
        distances.length < policy.minIndividualLights
        || distances.length > policy.maxIndividualLights
      ))) {
      issues.push({
        fieldId: 'sheet-world-placements',
        message: `Укажите ${policy.minIndividualLights}–${policy.maxIndividualLights} допустимых дистанций через запятую.`,
      });
    } else if (facts) {
      worldInput = {
        type: 'dancing_lights',
        form: draft.form,
        placements: distances.map((distanceFromCasterFt) => ({
          distanceFromCasterFt,
          withinRequiredSeparation: draft.placementsWithinSeparation,
        })),
        facts,
      };
    }
  } else if (context.form === 'druidcraft') {
    const description = draft.description.trim();
    if (!facts) {
      worldInput = null;
    } else if (draft.option === 'weather_sensor') {
      if (!description) issues.push({ fieldId: 'sheet-world-description', message: 'Запишите прогноз погоды.' });
      else worldInput = { type: 'druidcraft', option: { kind: 'weather_sensor', prediction: description, facts } };
    } else if (draft.option === 'sensory_effect') {
      if (!description) issues.push({ fieldId: 'sheet-world-description', message: 'Опишите сенсорный эффект.' });
      const cube = numberValue(draft.sensoryCubeSideFt);
      const maximum = (context.parsed.policy as DruidcraftWorldPolicy).sensoryCubeSideFt;
      if (cube === null || cube <= 0 || cube > maximum) {
        issues.push({ fieldId: 'sheet-world-sensory-size', message: `Сторона куба должна быть до ${maximum} футов.` });
      } else if (description) {
        worldInput = { type: 'druidcraft', option: { kind: 'sensory_effect', description, cubeSideFt: cube, facts } };
      }
    } else if (draft.option === 'bloom' || draft.option === 'fire_play') {
      const objectId = selectedObjectId(draft, created, issues);
      if (objectId) worldInput = draft.option === 'bloom'
        ? { type: 'druidcraft', option: { kind: 'bloom', objectId, facts } }
        : {
          type: 'druidcraft',
          option: {
            kind: 'fire_play', objectId,
            operation: draft.operation === 'snuff' ? 'snuff' : 'light',
            facts,
          },
        };
    } else issues.push({ fieldId: 'sheet-world-option', message: 'Выберите вариант Искусства друидов.' });
  } else if (context.form === 'prestidigitation') {
    const description = draft.description.trim();
    if (!facts) {
      worldInput = null;
    } else if (draft.option === 'sensory_effect') {
      if (!description) issues.push({ fieldId: 'sheet-world-description', message: 'Опишите сенсорный эффект.' });
      else worldInput = { type: 'prestidigitation', option: { kind: 'sensory_effect', description, facts } };
    } else if (draft.option === 'minor_creation') {
      if (!description) issues.push({ fieldId: 'sheet-world-description', message: 'Опишите создаваемую безделушку.' });
      else worldInput = {
        type: 'prestidigitation',
        option: {
          kind: 'minor_creation', description, size: draft.creationSize,
          fitsInHand: draft.creationFitsInHand, facts,
        },
      };
    } else {
      const objectId = selectedObjectId(draft, created, issues);
      if (draft.option === 'fire_play' && objectId) {
        worldInput = { type: 'prestidigitation', option: {
          kind: 'fire_play', objectId,
          operation: draft.operation === 'snuff' ? 'snuff' : 'light', facts,
        } };
      } else if (draft.option === 'clean_or_soil' && objectId) {
        worldInput = { type: 'prestidigitation', option: {
          kind: 'clean_or_soil', objectId,
          operation: draft.operation === 'soil' ? 'soil' : 'clean', facts,
        } };
      } else if ((draft.option === 'minor_sensation' || draft.option === 'magic_mark') && objectId) {
        if (!description) issues.push({ fieldId: 'sheet-world-description', message: 'Опишите ощущение или метку.' });
        else worldInput = { type: 'prestidigitation', option: {
          kind: draft.option, objectId, description, facts,
        } };
      } else if (!['fire_play', 'clean_or_soil', 'minor_sensation', 'magic_mark'].includes(draft.option)) {
        issues.push({ fieldId: 'sheet-world-option', message: 'Выберите вариант Фокуса.' });
      }
    }
  } else if (context.form === 'purify_food_drink') {
    const selected = new Set(draft.selectedObjectIds);
    if (created) selected.add(created.id);
    if (!selected.size) issues.push({ fieldId: 'sheet-world-area-objects', message: 'Выберите хотя бы один объект в сфере.' });
    const purifyPolicy = context.parsed.policy as PurifyFoodDrinkWorldPolicy;
    for (const id of selected) {
      const object = selectedObject(context, created, id, issues);
      if (!object) continue;
      if (!object.foodOrDrink) {
        issues.push({ fieldId: 'sheet-world-area-objects', message: `${object.name}: это не еда и не напиток.` });
      } else if (purifyPolicy.excludeMagical && object.foodOrDrink.magical) {
        issues.push({ fieldId: 'sheet-world-area-objects', message: `${object.name}: магическая пища не очищается этим заклинанием.` });
      }
    }
    const center = numberValue(draft.sphereCenterDistanceFt);
    if (center === null || center < 0 || center > context.parsed.targeting.rangeFt) {
      issues.push({
        fieldId: 'sheet-world-sphere-center',
        message: `Центр сферы должен быть в пределах ${context.parsed.targeting.rangeFt} футов.`,
      });
    }
    if (facts && center !== null && !issues.length) {
      worldInput = {
        type: 'purify_food_drink',
        sphereCenterDistanceFt: center,
        factsByObject: Object.fromEntries([...selected].sort().map((id) => [id, facts])),
      };
    }
  }

  return {
    result: !issues.length && worldInput ? { worldInput, scenarioObjects } : null,
    issues,
  };
}

export function sheetWorldFactsPreview(draft: SheetWorldInputFormDraft): Record<string, unknown> {
  const previewNumber = (value: string): number | string => numberValue(value) ?? value;
  return {
    factsSource: draft.facts.factsSource,
    boardRevision: previewNumber(draft.facts.boardRevision),
    distanceFt: previewNumber(draft.facts.distanceFt),
    lineOfSight: draft.facts.lineOfSight,
    touched: draft.facts.touched,
    inArea: draft.facts.inArea,
    entirelyInArea: draft.facts.entirelyInArea,
    ...(draft.facts.volumeCubicFt
      ? { volumeCubicFt: previewNumber(draft.facts.volumeCubicFt) }
      : {}),
  };
}
