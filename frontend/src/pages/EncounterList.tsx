/** Список онлайн-боёв + создание нового. Открытие боя — общий realtime-стол (/encounter/:id). */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { encountersApi } from '../battle/encountersApi';
import type { Encounter } from '../battle/encounterTypes';

export default function EncounterList() {
  const [encs, setEncs] = useState<Encounter[] | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  useEffect(() => { encountersApi.list().then(setEncs).catch(() => setEncs([])); }, []);

  const create = async () => {
    setBusy(true);
    try {
      const enc = await encountersApi.create(name.trim() || 'Новый бой');
      navigate(`/encounter/${enc.id}`);
    } finally { setBusy(false); }
  };

  return (
    <div className="site-surface" style={{ maxWidth: 820, margin: '0 auto', padding: 28 }}>
      <h1 className="site-heading" style={{ fontSize: 32 }}>Онлайн-бои</h1>
      <p style={{ color: '#a99f8b', fontSize: 14 }}>
        Общий стол боя в реальном времени: изменения видны всем участникам на разных устройствах без обновления страницы.
      </p>
      <div style={{ display: 'flex', gap: 8, margin: '12px 0 20px' }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Название боя"
          className="site-control" style={{ flex: 1, minWidth: 0, padding: '8px 10px' }} />
        <button onClick={create} disabled={busy} className="site-button site-button-primary">
          Создать бой
        </button>
      </div>
      {encs === null ? <p style={{ color: '#a99f8b' }}>Загрузка…</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {encs.map((e) => (
            <Link key={e.id} to={`/encounter/${e.id}`} style={{
              display: 'flex', justifyContent: 'space-between', padding: '10px 12px', borderRadius: 8,
              border: '1px solid var(--site-line)', background: 'var(--site-bg)', color: 'var(--site-text)', textDecoration: 'none',
            }}>
              <span>{e.name}</span>
              <span style={{ color: '#a99f8b', fontSize: 13 }}>{(e.state?.combatants?.length ?? 0)} участн. · раунд {e.state?.round ?? 1}</span>
            </Link>
          ))}
          {encs.length === 0 && <p style={{ color: '#a99f8b' }}>Боёв пока нет — создайте первый.</p>}
        </div>
      )}
    </div>
  );
}
