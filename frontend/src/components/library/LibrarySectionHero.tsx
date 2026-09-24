import type { CSSProperties, ReactNode } from 'react';
import { LIBRARY_CATALOG, type LibrarySection } from './libraryCatalog';
import { libraryHeroArt } from './libraryHeroArt';
import './LibraryChrome.css';

// Art is decorative: the heading/action retain all meaning if an asset is absent.
export default function LibrarySectionHero({ type, heading, subtitle, action }: {
  type: LibrarySection;
  heading?: string;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return <header className="library-section-hero" data-library-section={type}
    style={{ '--library-hero-art': `url("${libraryHeroArt[type]}")` } as CSSProperties}>
    <div className="library-section-hero__copy">
      <h1 className="library-section-hero__heading">{heading ?? LIBRARY_CATALOG.find(item => item.id === type)?.label}</h1>
      {subtitle && <p className="library-section-hero__subtitle">{subtitle}</p>}
    </div>
    {action && <div className="library-section-hero__action">{action}</div>}
  </header>;
}
