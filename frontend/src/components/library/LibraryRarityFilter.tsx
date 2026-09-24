import { RARITY_OPTIONS } from '../../types';
import { rarityValues } from './libraryNavigation';

export default function LibraryRarityFilter({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const selected = rarityValues(value);
  return <fieldset className="library-rarities">
    <legend>Редкость</legend>
    <label><input type="checkbox" checked={!selected.length} onChange={() => onChange('')} />Все редкости</label>
    {RARITY_OPTIONS.map(option => <label key={option.value}>
      <input type="checkbox" checked={selected.includes(option.value)} onChange={event => onChange(
        (event.target.checked ? [...selected, option.value] : selected.filter(v => v !== option.value)).join(','),
      )} />{option.label}
    </label>)}
  </fieldset>;
}
