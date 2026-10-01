import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it, vi} from 'vitest';
import type {ReactNode} from 'react';
import type {ResourceDefinition} from '../types';
import ResourcePreview, {resourceRechargeLabel} from './ResourcePreview';
import SheetResourceTile from './SheetResourceTile';
import {buildResourceRecharge,buildResourceRecovery} from '../engine/resources';
import {parseResourceRestRecovery} from '../engine/actionUses';

vi.mock('./HoverCard', () => ({default: ({children, content}: {children: ReactNode; content: ReactNode}) => <>{children}{content}</>}));
const resource = (id: string, category = 'class_resource'): ResourceDefinition => ({id, resource_id: id, name: 'Ресурс', category});

describe('resource availability in the shared canonical preview', () => {
  it.each([{id:'different-class-pool',amount:1},{id:'other-class-pool',amount:3}])(
    'uses the existing class recovery declaration for $id instead of absent or stale catalog metadata',({id,amount})=>{
      const declarations={[id]:{per:'short_rest',count:4,recovery:{short_rest:{mode:'fixed',amount},long_rest:{mode:'full'}}}};
      const resourceContext={resourceRecharge:buildResourceRecharge(declarations),resourceRecovery:buildResourceRecovery(declarations)};
      const option={id,label:'Классовый запас',category:'class_resource',recharge:'never'};
      const before=JSON.stringify({declarations,option,resourceContext});
      const html=renderToStaticMarkup(<SheetResourceTile resourceId={id} option={option} current={0} maximum={4}
        resourceContext={resourceContext}/>);
      expect(html).toContain(`Короткий отдых: +${amount}; долгий отдых: все`);
      expect(html).not.toContain('Не восстанавливается');
      expect(html).toContain('Осталось: 0 из 4');
      expect(JSON.stringify({declarations,option,resourceContext})).toBe(before);
    });
  it('presents the validated dice recovery policy without calculating or rolling it',()=>{
    const recovery=parseResourceRestRecovery({short_rest:{mode:'none'},long_rest:{mode:'dice',dice:'2d6'}})!;
    const html=renderToStaticMarkup(<ResourcePreview resource={resource('different-item-pool','item_resource')}
      recovery={recovery} availability={{current:2,maximum:6}} disableHover/>);
    expect(html).toContain('Короткий отдых: нет; долгий отдых: +2к6');
    expect(html).toContain('Осталось: 2 из 6');
  });
  it('omits unknown recovery while retaining explicitly authored never recovery',()=>{
    const html=renderToStaticMarkup(<ResourcePreview resource={resource('unknown-cadence')} disableHover/>);
    expect(html).not.toContain('Восстановление:');
    expect(html).not.toContain('Не восстанавливается');
    expect(resourceRechargeLabel(undefined)).toBe('Не указано');
    const declared=renderToStaticMarkup(<ResourcePreview resource={{...resource('finite-cadence'),recharge:'never'}} disableHover/>);
    expect(declared).toContain('Не восстанавливается');
  });
  it('does not fall back to metadata cadence for an explicitly invalid runtime recovery',()=>{
    const html=renderToStaticMarkup(<ResourcePreview resource={{...resource('invalid-recovery'),recharge:'long_rest'}}
      recovery={null} disableHover/>);
    expect(html).toContain('Восстановление не настроено');
    expect(html).not.toContain('Короткий отдых:');
    expect(html).not.toContain('Длинный отдых');
  });
  it.each([{id: 'rage', current: 0, maximum: 3}, {id: 'unrelated-energy', current: 4, maximum: 7}])(
    'shows current/maximum for $id, including zero remaining', data => {
      const html = renderToStaticMarkup(<ResourcePreview resource={resource(data.id)} availability={data} disableHover/>);
      expect(html).toContain(`aria-label="Осталось: ${data.current} из ${data.maximum}"`);
    });
  it.each([resource('arbitrary-action-cost', 'action_cost'), resource('freeuse-spells'), resource('freeuse-arbitrary-spell')])(
    'does not add an availability row for action costs and free-cast aggregates: $resource_id', definition => {
      const html = renderToStaticMarkup(<ResourcePreview resource={definition} availability={{current: 0, maximum: 4}} disableHover/>);
      expect(html).not.toContain('Осталось:');
    });
  it('passes live counts from the shared sheet/combat tile and uses data category for action exclusions', () => {
    const classResource = renderToStaticMarkup(<SheetResourceTile resourceId="channel_divinity" current={1} maximum={2}/>);
    expect(classResource).toContain('aria-label="Осталось: 1 из 2"');
    const action = renderToStaticMarkup(<SheetResourceTile resourceId="action" current={0} maximum={1}/>);
    expect(action).not.toContain('Осталось:');
    expect(action).toContain('res-tile--spent');
  });
  it('dims a spent custom image even when a separate spent artwork is available', () => {
    const html = renderToStaticMarkup(<SheetResourceTile resourceId="arbitrary-energy" current={0} maximum={3}
      option={{id: 'arbitrary-energy', label: 'Энергия', category: 'class_resource', imageUrl: '/available.png', imageUrlSpent: '/spent-red.png'}}/>);
    expect(html).toContain('src="/spent-red.png"');
    expect(html).toContain('class="res-tile-icon res-tile-icon--dim"');
  });
});
