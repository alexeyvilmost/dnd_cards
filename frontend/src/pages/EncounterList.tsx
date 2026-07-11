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
    <div style={{ maxWidth: 640, margin: '0 auto', color: '#e8e0d0' }}>
      <h1 style={{ fontSize: 26, fontWeight: 700, color: '#d8b978' }}>Онлайн-бои</h1>
      <p style={{ color: '#a99f8b', fontSize: 14 }}>
        Общий стол боя в реальном времени: изменения видны всем участникам на разных устройствах без обновления страницы.
      </p>
      <div style={{ display: 'flex', gap: 8, margin: '12px 0 20px' }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Название боя"
          style={{ flex: 1, padding: '8px 10px', borderRadius: 6, border: '1px solid #6b5836', background: '#1c1813', color: '#e8e0d0' }} />
        <button onClick={create} disabled={busy}
          style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #8a7320', background: '#2b2520', color: '#e8e0d0', cursor: 'pointer' }}>
          Создать бой
        </button>
      </div>
      {encs === null ? <p style={{ color: '#a99f8b' }}>Загрузка…</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {encs.map((e) => (
            <Link key={e.id} to={`/encounter/${e.id}`} style={{
              display: 'flex', justifyContent: 'space-between', padding: '10px 12px', borderRadius: 8,
              border: '1px solid #3a332a', background: '#1c1813', color: '#e8e0d0', textDecoration: 'none',
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
