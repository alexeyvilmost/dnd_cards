import type {LibraryContentType} from '../../utils/libraryUrlParams';
import {ENTITY_FILTERS, type LibraryEntityFilters as Values} from './entityFilterDefinitions';
export default function LibraryEntityFilters({type,values,onChange}: {type: LibraryContentType; values: Values; onChange: (values: Values)=>void}) {
  return <>{(ENTITY_FILTERS[type] ?? []).map(filter => <label key={filter.key} className="block text-sm font-medium text-gray-700">{filter.label}
    <select className="input-field mt-2" aria-label={filter.label} value={values[filter.key] ?? ''} onChange={event=>onChange({...values,[filter.key]:event.target.value})}>
      <option value="">Все</option>{filter.options.map(([id,label])=><option key={id} value={id}>{label}</option>)}
    </select>
  </label>)}</>;
}
