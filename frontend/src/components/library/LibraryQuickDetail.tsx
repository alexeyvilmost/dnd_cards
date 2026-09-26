import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';

export default function LibraryQuickDetail({ name, editTo, pageTo, onClose, children }: {
  name: string; editTo: string; pageTo: string; onClose: () => void; children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(<div className="library-quick-detail" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-label={name} className="library-quick-detail__panel">
      <button type="button" className="library-quick-detail__close" aria-label="Закрыть" onClick={onClose}><X size={21} /></button>
      {children}
      <footer><Link to={pageTo} onClick={onClose} className="site-button">На полную страницу</Link><Link to={editTo} onClick={onClose} className="site-button site-button-primary">Изменить</Link></footer>
    </section>
  </div>, document.body);
}
