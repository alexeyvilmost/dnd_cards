import LibraryTagFilter from '../LibraryTagFilter';
import './LibraryChrome.css';

// Keep the canonical stable-ID tag picker. Only its in-page controls receive
// library chrome; nested entity dialogs and previews are not restyled.
export default function LibraryTagControl(props: { value: string; onChange: (value: string) => void }) {
  return <div className="library-chrome-tag-control"><LibraryTagFilter {...props} /></div>;
}
