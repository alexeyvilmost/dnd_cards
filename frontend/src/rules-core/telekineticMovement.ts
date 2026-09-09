import type {WorldObjectState} from './worldObjects';

/** Only concrete loose objects qualify; ownership alone is not physical possession. */
export function isLooseTelekineticObject(object: WorldObjectState | undefined): object is WorldObjectState {
  return Boolean(object && object.kind !== 'spell_effect' && object.unattended === true
    && object.secured !== true && !object.heldByActorId && !object.carriedByActorId
    && ['tiny', 'small', 'medium', 'large'].includes(object.size));
}
