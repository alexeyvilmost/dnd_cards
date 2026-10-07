import {loadHistoricalCatalogSources} from '../historical-catalog-source.mjs';
export async function authoredBootstrapIdentitySource(){const p=await loadHistoricalCatalogSources();return {entities:p.identityUnion,fixtureHash:p.manifestHash,sources:p.manifest.datasets};}
