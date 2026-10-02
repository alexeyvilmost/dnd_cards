import { useEffect, useRef, useState } from 'react';
import { ChevronRight, ScrollText } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { charactersV3Api } from '../character/api';
import { useAuth } from '../contexts/AuthContext';
import { paperDocumentApi, paperDocumentError } from '../paper-sheet/documentApi';
import { exportInteractiveCharacterToPaper } from '../paper-sheet/characterConversion';
import './PaperExportButton.css';

/** Export a fresh server snapshot into an independent, editable document. */
export default function PaperExportButton({ characterId, mobile = false }: { characterId: string; mobile?: boolean }) {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const busy = useRef(false);
  const activeRequest = useRef(0);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    busy.current = false; setExporting(false); setError('');
    return () => { activeRequest.current += 1; };
  }, [characterId]);
  const exportPaper = async () => {
    if (busy.current) return;
    busy.current = true; setExporting(true); setError('');
    const request = ++activeRequest.current;
    try {
      const character = await charactersV3Api.get(characterId);
      if (request !== activeRequest.current) return;
      const document = await exportInteractiveCharacterToPaper(character);
      if (request !== activeRequest.current) return;
      const saved = await paperDocumentApi.create(document, !isAuthenticated);
      if (request === activeRequest.current) navigate(`/paper-sheet/${saved.id}`);
    } catch (cause) { if (request === activeRequest.current) setError(paperDocumentError(cause)); }
    finally { if (request === activeRequest.current) { busy.current = false; setExporting(false); } }
  };
  return <div className={`paper-export-control${mobile ? ' paper-export-control--mobile' : ''}`}>
    <button type="button" className={mobile ? 'm-settings-row' : 'sheet-header-btn'} disabled={exporting} onClick={() => { void exportPaper(); }}
      aria-label="Экспортировать в бумажный лист" aria-description="Создаёт отдельную копию текущего персонажа с его снаряжением и выбором способностей.">
      <ScrollText size={mobile ? 19 : 16} aria-hidden="true" />{mobile
        ? <><span><strong>{exporting ? 'Переносим…' : 'В бумажный лист'}</strong><small>Отдельная копия со снаряжением и способностями</small></span><ChevronRight size={18} aria-hidden="true" /></>
        : <span className="sheet-header-btn-label">{exporting ? 'Переносим…' : 'В бумажный лист'}</span>}
    </button>
    {error && <span className="paper-export-error" role="alert">{error}</span>}
  </div>;
}
