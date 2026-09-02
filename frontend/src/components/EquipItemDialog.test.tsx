import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Card } from '../types';
import EquipItemDialog from './EquipItemDialog';

describe('EquipItemDialog mechanic clarity', () => {
  it('shows the structured weapon profile in the sheet dialog', () => {
    const card = {
      id: 'club', name: 'Дубинка', rarity: 'common', type: 'weapon',
      mechanics: { weapon_profile: {
        proficiency_category: 'simple',
        damage_lines: [{ dice: '1d4', damage_type: 'bludgeoning' }],
        attack_modes: [{ kind: 'melee', reach_ft: 5 }],
        properties: ['light'],
      } },
    } as unknown as Card;
    const html = renderToStaticMarkup(<EquipItemDialog
      card={card} mode="inventory" onEquip={vi.fn()} onUnequip={vi.fn()}
      onRemove={vi.fn()} onToggleAttune={vi.fn()} onClose={vi.fn()}
    />);
    expect(html).toContain('Механика');
    expect(html).toContain('Оружие: простое');
    expect(html).toContain('Свойства: лёгкое');
  });
});
