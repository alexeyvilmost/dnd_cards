import historical from '../pinnedFighter.fixture.json';
import cards from '../../../../officials/canon/prod-snapshot/cards.json';
import {withContainerCatalog} from '../../../worker/fixtures/container-catalog.mjs';

// Current worker tests need the complete declared container closure. Keep the
// historical fixture byte-for-byte intact for old executable replay evidence.
export default withContainerCatalog(historical,cards);
