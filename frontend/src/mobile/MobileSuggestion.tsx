import { useEffect, useState } from 'react';
import { Smartphone, X } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import './mobile.css';

const DISMISSED_KEY = 'boh:mobile-suggestion-dismissed';

export default function MobileSuggestion() {
  const location = useLocation();
  const navigate = useNavigate();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (location.pathname.startsWith('/m')) {
      setVisible(false);
      return;
    }
    const narrow = window.matchMedia('(max-width: 1024px)').matches;
    const dismissed = localStorage.getItem(DISMISSED_KEY) === '1';
    setVisible(narrow && !dismissed);
  }, [location.pathname]);

  if (!visible) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, '1');
    setVisible(false);
  };

  return (
    <aside className="m-suggestion" aria-label="Предложение мобильной версии">
      <button type="button" className="m-suggestion-close" onClick={dismiss} aria-label="Не сейчас">
        <X size={18} />
      </button>
      <span className="m-suggestion-icon"><Smartphone size={22} /></span>
      <span className="m-suggestion-copy">
        <strong>Мобильный лист</strong>
        <span>Интерфейс для игры за столом</span>
      </span>
      <button
        type="button"
        className="m-button m-button--gold"
        onClick={() => navigate('/m/characters')}
      >
        Открыть
      </button>
    </aside>
  );
}
