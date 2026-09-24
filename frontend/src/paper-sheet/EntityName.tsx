import HoverCard from '../components/HoverCard';
import EntityRefPreview from '../components/EntityRefPreview';
import { useEntityDetail } from '../contexts/entityDetail';
import type { PaperLibraryEntity } from './references';

export function EntityName({ entity }: { entity: PaperLibraryEntity }) {
  const { openEntity } = useEntityDetail();
  return <HoverCard className="ps-entity-reference" content={<EntityRefPreview type={entity.type} id={entity.id} />}>
    <button type="button" className="ps-entity-name" aria-label={`Открыть карточку: ${entity.name}`} onClick={event => {
      event.stopPropagation();
      openEntity(entity.type, entity.id);
    }}><strong>{entity.name}</strong></button>
  </HoverCard>;
}
