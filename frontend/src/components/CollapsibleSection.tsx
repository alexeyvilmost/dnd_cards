import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

interface Props {
  title: string;
  wide?: boolean;
  hook?: boolean;
  defaultOpen?: boolean;
  headerExtra?: ReactNode;
  className?: string;
  children?: ReactNode;
}

export default function CollapsibleSection({
  title,
  wide,
  hook,
  defaultOpen = true,
  headerExtra,
  className,
  children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section
      className={[
        'cs-card',
        wide ? 'cs-card--wide' : '',
        hook ? 'cs-card--hook' : '',
        !open ? 'cs-card--collapsed' : '',
        className ?? '',
      ].filter(Boolean).join(' ')}
    >
      <div className="cs-card-h cs-card-h--toggle">
        <button
          type="button"
          className="cs-card-toggle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <ChevronDown size={14} className={`cs-chevron${open ? ' open' : ''}`} />
          <span>{title}</span>
        </button>
        {headerExtra}
        {hook && <span className="cs-soon">скоро</span>}
      </div>
      {open && children != null && <div className="cs-card-body">{children}</div>}
    </section>
  );
}
