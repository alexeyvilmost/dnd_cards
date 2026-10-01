// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SoloCombatState } from '../solo-combat/types';
import type { RuleActionDefinition } from '../rules-core/domain';
import CombatHotbar from './CombatHotbar';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('../utils/resources', async (importOriginal) => ({
  ...await importOriginal<typeof import('../utils/resources')>(), useResourceOptions: () => [],
}));
vi.mock('../settings', () => ({ useSiteSettings: () => ({ entityDisplay: { actions: 'icon' } }) }));
vi.mock('./SheetResourceTile', () => ({
  sheetResourceTileOrder: () => 0,
  default: ({ resourceId, current, maximum, onSelect, selected }: { resourceId: string; current: number; maximum: number; onSelect: () => void; selected: boolean }) =>
    <button type="button" data-resource-id={resourceId} aria-pressed={selected} onClick={onSelect}>{current}/{maximum}</button>,
}));
vi.mock('./FreeuseSpellsTile', () => ({ default: ({freeuseSpells, onSelect, selected}: {freeuseSpells: unknown[]; onSelect: () => void; selected: boolean}) =>
  freeuseSpells.length ? <button type="button" aria-label="Бесплатные заклинания" aria-pressed={selected} onClick={onSelect}/> : null }));
vi.mock('./SheetActionLine', () => ({default: ({name, disabled, disabledTitle, onActivate}: {name: string; disabled?: boolean; disabledTitle?: string; onActivate: () => void}) =>
  <button type="button" aria-label={name} aria-disabled={disabled} aria-description={disabledTitle} onClick={disabled ? undefined : onActivate}>{name}</button>}));
vi.mock('../character/actorPassiveToggles', () => ({ actorPassiveToggles: () => [{
  id: 'policy:test', name: 'Пассивная политика', defaultEnabled: true,
}] }));
vi.mock('./SheetPassiveToggle', () => ({
  default: ({ toggle, enabled, onChange }: {
    toggle: { id: string; name: string }; enabled: boolean; onChange: (id: string, value: boolean) => void;
  }) => <button type="button" aria-pressed={enabled} onClick={() => onChange(toggle.id, !enabled)}>{toggle.name}</button>,
}));

function state(): SoloCombatState {
  const actions = ['action', 'bonus_action', 'reaction'].map(resource => ({
    id: `basic-${resource}`, name: `Basic ${resource}`, kind: 'nonSpell', sourceEntityIds: [`entity-${resource}`],
    mechanics: {activation: {mode: resource === 'reaction' ? 'reaction' : 'active', cost: [{resource}]}},
  })) as RuleActionDefinition[];
  return {
    characterId: 'hero', playerActionIds: actions.map(action => action.id), catalogActions: actions, tokens: { hero: {} },
    actionPresentation: Object.fromEntries(actions.map(action => [action.id, {actionRef: {id: action.id, name: action.name, type: 'basic'}}])),
    movementRemainingFt: { hero: 30 },
    world: { grapples: {}, objects: {}, actors: { hero: {
      id: 'hero', name: 'Герой', kind: 'playerCharacter', ac: 12,
      character: { level: 1, profBonus: 2, abilityScores: { str: 10 },
        abilityMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
        baseSpeed: 30, characterSpeed: 30 },
      runtime: { hp: { current: 12, max: 20, temp: 3 }, resources: { action: 1 },
        maxResources: { action: 1 }, inventory: [], equipment: {}, activeEffects: [], firedThisTurn: [] },
      passives: [], capabilities: { actionIds: [] }, lifecycle: { status: 'alive' },
    } } },
  } as unknown as SoloCombatState;
}

const callbacks = () => ({ onAction: vi.fn(), onMove: vi.fn(), onConditionAction: vi.fn(),
  onEndTurn: vi.fn(), onSheet: vi.fn(), onPassiveToggle: vi.fn() });

describe('compact combat hotbar controls', () => {
  let root: Root, container: HTMLDivElement;
  beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

  it('opens canonical passive toggles from the utility panel while actions remain visible, without tabs', async () => {
    const handlers = callbacks();
    await act(async () => root.render(<CombatHotbar state={state()} actorId="hero" selectedActionId={null}
      movementMode={false} disabled={false} passiveEnabled={{ 'policy:test': false }} {...handlers} />));
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    const tools = container.querySelector('.combat-hotbar__tools')!;
    expect(tools.querySelectorAll('button')).toHaveLength(3);
    await act(async () => tools.querySelector<HTMLButtonElement>('[aria-label="Пассивы"]')!.focus());
    expect(document.body.querySelector('.entity-preview-enter')).not.toBeNull();
    await act(async () => tools.querySelector<HTMLButtonElement>('[aria-label="Пассивы"]')!.click());
    expect(document.body.querySelector('.entity-preview-enter')).toBeNull();
    const dialog = document.body.querySelector('[role="dialog"][aria-label="Пассивы"]')!;
    const toggle = [...dialog.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Пассивная политика')!;
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    await act(async () => toggle.click());
    expect(handlers.onPassiveToggle).toHaveBeenCalledExactlyOnceWith('policy:test', true);
    expect(container.querySelector('[aria-label="Действия персонажа"]')).not.toBeNull();
    await act(async () => document.body.querySelector<HTMLButtonElement>('[aria-label="Закрыть пассивы"]')!.click());
    expect(document.body.querySelector('[role="dialog"][aria-label="Пассивы"]')).toBeNull();
  });

  it('shows projected HP and portrait while resource and movement availability remain authoritative', async () => {
    const canonical = state();
    const display = state();
    display.world.actors.hero.name = 'Герой до удара';
    display.world.actors.hero.runtime.hp = { current: 18, max: 20, temp: 5 };
    display.world.actors.hero.runtime.resources.action = 0;
    display.movementRemainingFt.hero = 0;
    const handlers = callbacks();
    await act(async () => root.render(<CombatHotbar state={canonical} displayState={display} actorId="hero"
      selectedActionId={null} movementMode={false} disabled={false} {...handlers} />));
    expect(container.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('18');
    expect(container.querySelector('.combat-hotbar__hp')?.textContent).toBe('18 / 20');
    expect(container.querySelector('.combat-hotbar__temp-hp')?.textContent).toBe('Врем. хиты +5');
    expect(container.querySelector('.combat-hotbar__portrait')?.getAttribute('aria-label')).toBe('Герой до удара');
    expect(container.querySelector('[data-resource-id="action"]')?.textContent).toBe('1/1');
    const movement = container.querySelector<HTMLButtonElement>('[aria-label="Движение: 30 фт."]')!;
    expect(movement.querySelector('.combat-hotbar__movement-remaining')?.textContent).toBe('30');
    expect(movement.disabled).toBe(false);
    expect(container.querySelector('.combat-hotbar__resources [aria-label="Движение: 30 фт."]')).toBeNull();
    await act(async () => { movement.click(); container.querySelector<HTMLButtonElement>('[aria-label="Открыть лист персонажа"]')!.click(); });
    expect(handlers.onMove).toHaveBeenCalledOnce();
    expect(handlers.onSheet).toHaveBeenCalledOnce();
    expect(container.textContent).not.toContain('Лист');
  });
  it('separates turn resources, character resources and movement controls, hiding an empty middle group', async () => {
    const canonical = state();
    canonical.world.actors.hero.runtime.resources = {action: 1, bonus_action: 0, reaction: 1};
    canonical.world.actors.hero.runtime.maxResources = {action: 1, bonus_action: 1, reaction: 1, movement: 30};
    await act(async () => root.render(<CombatHotbar state={canonical} actorId="hero" selectedActionId={null}
      movementMode={false} disabled={false} {...callbacks()}/>));
    const turn = container.querySelector('[aria-label="Ресурсы хода"]')!;
    expect([...turn.querySelectorAll('[data-resource-id]')].map(node => node.getAttribute('data-resource-id')))
      .toEqual(['action', 'bonus_action', 'reaction']);
    expect(container.querySelector('[aria-label="Ресурсы персонажа"]')).toBeNull();
    expect(container.querySelector('[data-resource-id="movement"]')).toBeNull();
    const withExtra = structuredClone(canonical);
    Object.assign(withExtra.world.actors.hero.runtime.maxResources, {spell_slot_1: 2, hit_dice_d8: 3, 'uses_item-a': 4});
    const chargeAction = {id:'item-charge', name:'Заряд амулета', kind:'nonSpell', sourceEntityIds:['amulet'],
      mechanics:{activation:{mode:'active',cost:[{resource:'uses_item-a'}]}, requires_item_source:'amulet'}} as RuleActionDefinition;
    withExtra.catalogActions.push(chargeAction);
    withExtra.playerActionIds.push(chargeAction.id);
    withExtra.world.actors.hero.runtime.inventory=[{cardId:'amulet',qty:1}];
    await act(async () => root.render(<CombatHotbar state={withExtra} actorId="hero" selectedActionId={null}
      movementMode={false} disabled={false} {...callbacks()}/>));
    const extra = container.querySelector('[aria-label="Ресурсы персонажа"]')!;
    expect(extra.querySelectorAll('[data-resource-id]')).toHaveLength(1);
    expect(extra.querySelector('[data-resource-id="hit_dice_d8"]')).toBeNull();
    expect(extra.querySelector('[data-resource-id="spell_slot_1"]')).toBeNull();
    expect(extra.querySelector('[data-resource-id="action"]')).toBeNull();
    expect(container.querySelector('[aria-label="Управление полем"]')?.querySelectorAll('button')).toHaveLength(3);
  });
  it.each(['Пассивы', 'Движение: 30 фт.', 'Рюкзак'])('opens a canonical explanatory hover preview for %s without HTML titles', async name => {
    await act(async () => root.render(<CombatHotbar state={state()} actorId="hero" selectedActionId={null}
      movementMode={false} disabled={false} {...callbacks()}/>));
    const button = container.querySelector<HTMLButtonElement>(`[aria-label="${name}"]`)!;
    await act(async () => button.focus());
    const preview = document.body.querySelector('.entity-preview-enter .sp-tip');
    expect(preview).not.toBeNull();
    expect(preview?.textContent).toContain(name === 'Пассивы' ? 'Открывает переключаемые пассивы' : name === 'Рюкзак' ? 'Показывает все действия, предоставляемые предметами' : 'Оставшееся передвижение: 30 фт.');
    expect(button.getAttribute('title')).toBeNull();
  });

  it('groups the base hotbar, uses flat resource/item views, and keeps spent triggered spells inspectable', async () => {
    const canonical = state(), actor = canonical.world.actors.hero;
    const first = {id:'spell-one', name:'Первое заклинание попадания', kind:'spell', spell:{level:1}, sourceEntityIds:['spell-entity-one'],
      mechanics:{activation:{mode:'triggered', trigger:{event:'hit'}, cost:[{resource:'bonus_action'},{resource:'spell_slot',level:1}]}}} as RuleActionDefinition;
    const second = {...first, id:'spell-two', name:'Второе заклинание попадания', sourceEntityIds:['spell-entity-two']} as RuleActionDefinition;
    const variant = {...first, id:'variant-only', mechanics:{...first.mechanics,variant_of_spell_id:'spell-one'}} as RuleActionDefinition;
    const feature = {id:'species-action',name:'Способность вида',kind:'nonSpell',sourceEntityIds:['species'],mechanics:{activation:{mode:'active',cost:[]}}} as RuleActionDefinition;
    const item = {id:'item-action',name:'Действие амулета',kind:'nonSpell',sourceEntityIds:['amulet'],mechanics:{requires_item_source:'amulet',activation:{mode:'active',cost:[{resource:'charge'}]}}} as RuleActionDefinition;
    canonical.catalogActions.push(first,second,variant,feature,item);
    canonical.playerActionIds.push(first.id,second.id,variant.id,feature.id,item.id);
    actor.runtime.inventory=[{cardId:'amulet',qty:1}];
    Object.assign(actor.runtime.maxResources,{spell_slot_1:2,'freeuse-one':1,charge:1,unused:2});
    Object.assign(actor.runtime.resources,{spell_slot_1:0,'freeuse-one':0,charge:0});
    actor.spellcastingAccess={grants:[first,second,variant].map(action=>({actionId:action.id,grantId:action.id,sourceId:'class-source',access:'always_prepared',level:1,slotResource:'spell_slot_1',...(action.id===first.id?{freeUseResource:'freeuse-one'}:{})})),preparedSources:{}};
    const handlers=callbacks();
    await act(async()=>root.render(<CombatHotbar state={canonical} actorId="hero" selectedActionId={null} movementMode={false} disabled={false} {...handlers}/>));
    const groups=()=>[...container.querySelectorAll('[data-action-group]')].map(node=>node.getAttribute('data-action-group'));
    const ids=()=>[...container.querySelectorAll('[data-action-id]')].map(node=>node.getAttribute('data-action-id'));
    expect(groups()).toEqual(['basic','features','spells','items']);
    expect(ids()).not.toContain(variant.id);
    expect(container.querySelector('[data-resource-id="unused"]')).toBeNull();
    await act(async()=>container.querySelector<HTMLButtonElement>('[aria-label="Бесплатные заклинания"]')!.click());
    expect(groups()).toEqual(['filtered']);expect(ids()).toEqual([first.id]);
    const smite=container.querySelector<HTMLButtonElement>(`[aria-label="${first.name}"]`)!;
    expect(smite.getAttribute('aria-disabled')).toBe('true');expect(smite.getAttribute('aria-description')).toContain('после подходящего события');
    await act(async()=>smite.click());expect(handlers.onAction).not.toHaveBeenCalled();
    await act(async()=>container.querySelector<HTMLButtonElement>('[data-resource-id="spell_slot_1"]')!.click());
    expect(ids()).toEqual([first.id,second.id]);
    expect(container.querySelector('[aria-label="Бесплатные заклинания"]')?.getAttribute('aria-pressed')).toBe('false');
    await act(async()=>container.querySelector<HTMLButtonElement>('[aria-label="Рюкзак"]')!.click());
    expect(ids()).toEqual([item.id]);expect(groups()).toEqual(['filtered']);
    expect(container.querySelector('[data-resource-id="spell_slot_1"]')?.getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelector(`[aria-label="${item.name}"]`)?.getAttribute('aria-disabled')).toBe('true');
    await act(async()=>container.querySelector<HTMLButtonElement>('[aria-label="Рюкзак"]')!.click());
    expect(groups()).toEqual(['basic','features','spells','items']);
  });

  it('removes the last consumed item from the grouped, backpack and resource views using authoritative inventory',async()=>{
    const canonical=state(), actor=canonical.world.actors.hero;
    const drink={id:'drink',name:'Выпить настой',kind:'nonSpell',sourceEntityIds:['vial'],mechanics:{damage_source_kind:'item',activation:{mode:'active',cost:[{resource:'action'},{resource:'item',card_id:'vial'}]}}} as RuleActionDefinition;
    const grant={id:'charm-action',name:'Способность талисмана',kind:'nonSpell',sourceEntityIds:['charm-action-ref'],mechanics:{requires_any_item_source:['charm'],activation:{mode:'active',cost:[{resource:'uses_charm'}]}}} as RuleActionDefinition;
    actor.character.knownCards=[{id:'vial',card_number:'item-vial'}, {id:'charm',card_number:'item-charm',requires_attunement:true}] as never;
    actor.character.equippedCards=[actor.character.knownCards![1]];
    actor.runtime.inventory=[{cardId:'vial',qty:2,containerId:'bag'}];actor.runtime.equipment={ring:'charm'};
    Object.assign(actor.runtime.resources,{action:0,uses_charm:0});Object.assign(actor.runtime.maxResources,{uses_charm:2});
    canonical.catalogActions.push(drink,grant);canonical.playerActionIds.push(drink.id,grant.id);
    const frozen=JSON.stringify({catalog:canonical.catalogActions,known:actor.character.knownCards});
    const handlers=callbacks(), original=structuredClone(canonical);
    const render=async(snapshot:SoloCombatState)=>act(async()=>root.render(<CombatHotbar state={snapshot} displayState={original} actorId="hero" selectedActionId={null} movementMode={false} disabled={false} {...handlers}/>));
    const ids=()=>[...container.querySelectorAll('[data-action-id]')].map(node=>node.getAttribute('data-action-id'));
    await render(canonical);
    expect(ids()).toContain(drink.id);expect(ids()).toContain(grant.id);
    expect(container.querySelector(`[aria-label="${drink.name}"]`)?.getAttribute('aria-disabled')).toBe('true');
    expect(container.querySelector(`[aria-label="${grant.name}"]`)?.getAttribute('aria-disabled')).toBe('true');
    await act(async()=>container.querySelector<HTMLButtonElement>('[aria-label="Рюкзак"]')!.click());
    expect(ids()).toEqual([drink.id,grant.id]);
    const remaining=structuredClone(canonical);remaining.world.actors.hero.runtime.inventory[0].qty=1;
    await render(remaining);expect(ids()).toEqual([drink.id,grant.id]);
    const consumed=structuredClone(remaining);consumed.world.actors.hero.runtime.inventory[0].qty=0;
    await render(consumed);expect(ids()).toEqual([grant.id]);
    await act(async()=>container.querySelector<HTMLButtonElement>('[data-resource-id="uses_charm"]')!.click());
    expect(ids()).toEqual([grant.id]);
    const lost=structuredClone(consumed);lost.world.actors.hero.runtime.equipment.ring=null;
    await render(lost);expect(ids()).not.toContain(drink.id);expect(ids()).not.toContain(grant.id);
    expect(container.querySelector('[data-resource-id="uses_charm"]')).toBeNull();
    await act(async()=>container.querySelector<HTMLButtonElement>('[aria-label="Рюкзак"]')!.click());
    expect(ids()).toEqual([]);expect(container.textContent).toContain('Нет действий предметов');
    expect(JSON.stringify({catalog:lost.catalogActions,known:lost.world.actors.hero.character.knownCards})).toBe(frozen);
    expect(handlers.onAction).not.toHaveBeenCalled();
  });
});
