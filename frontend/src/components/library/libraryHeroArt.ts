import { LIBRARY_CATALOG, type LibrarySection } from './libraryCatalog';

// Individual decorative illustrations are supplied by main. The catalog is
// the sole list of section IDs, so a section cannot silently miss an art path.
export const libraryHeroArt = Object.fromEntries(
  LIBRARY_CATALOG.map(({ id }) => [id, `/images/library/${id}.jpg`]),
) as Record<LibrarySection, string>;
