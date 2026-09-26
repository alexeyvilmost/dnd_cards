import { useState, type FormEvent } from 'react';
import { KeyRound, ShieldCheck, UserRound } from 'lucide-react';
import { authApi } from '../api/authApi';
import { useAuth } from '../contexts/AuthContext';
import { useContentPermissions } from '../hooks/useContentPermissions';
import './AccountPage.css';

export default function AccountPage() {
  const { user, refreshProfile } = useAuth();
  const { admin } = useContentPermissions();
  const [name, setName] = useState(user?.display_name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [busy, setBusy] = useState<'profile' | 'password' | 'admin' | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const submit = async (section: 'profile' | 'password' | 'admin', work: () => Promise<void>) => {
    setBusy(section); setNotice(''); setError('');
    try { await work(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось сохранить изменения'); }
    finally { setBusy(null); }
  };
  const onProfile = (event: FormEvent) => {
    event.preventDefault();
    void submit('profile', async () => {
      await authApi.updateProfile({ display_name: name, email });
      await refreshProfile();
      setNotice('Данные аккаунта сохранены.');
    });
  };
  const onPassword = (event: FormEvent) => {
    event.preventDefault();
    void submit('password', async () => {
      await authApi.changePassword(currentPassword, newPassword);
      setCurrentPassword(''); setNewPassword('');
      setNotice('Пароль аккаунта изменён.');
    });
  };
  const onAdmin = (event: FormEvent) => {
    event.preventDefault();
    void submit('admin', async () => {
      await authApi.elevateAdmin(adminPassword);
      setAdminPassword('');
      await refreshProfile();
      setNotice('Права администратора включены.');
    });
  };

  return <main className="account-page">
    <header className="site-page-head"><span className="account-page__eyebrow">Bag of Holding · Аккаунт</span><h1 className="site-heading">Ваш профиль</h1><p className="site-muted">Личные данные и права доступа к библиотеке.</p></header>
    {error && <p role="alert" className="account-page__error">{error}</p>}
    {notice && <p role="status" className="account-page__notice">{notice}</p>}
    <div className="account-page__grid">
      <section className="site-surface account-page__panel">
        <h2><UserRound size={19} /> Данные аккаунта</h2>
        <dl><div><dt>Логин</dt><dd>{user?.username}</dd></div><div><dt>ID аккаунта</dt><dd className="account-page__id">{user?.id}</dd></div><div><dt>Создан</dt><dd>{user?.created_at ? new Date(user.created_at).toLocaleDateString('ru-RU') : '—'}</dd></div></dl>
        <form onSubmit={onProfile}>
          <label>Отображаемое имя<input className="site-control" value={name} onChange={e => setName(e.target.value)} required maxLength={100} autoComplete="name" /></label>
          <label>Почта<input className="site-control" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" /></label>
          <button className="site-button site-button-primary" disabled={busy !== null}>Сохранить профиль</button>
        </form>
      </section>
      <div className="account-page__stack">
        <section className="site-surface account-page__panel"><h2><KeyRound size={19} /> Пароль аккаунта</h2><p className="site-muted">Для изменения нужен текущий пароль. Если вы входите через Google или Яндекс, оставьте этот раздел без изменений.</p>
          <form onSubmit={onPassword}>
            <label>Текущий пароль<input className="site-control" type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} autoComplete="current-password" required /></label>
            <label>Новый пароль<input className="site-control" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} minLength={12} maxLength={128} autoComplete="new-password" required /></label>
            <button className="site-button" disabled={busy !== null}>Изменить пароль</button>
          </form>
        </section>
        <section className="site-surface account-page__panel"><h2><ShieldCheck size={19} /> Права доступа</h2><p className="site-muted">Статус: <strong>{admin ? 'Администратор' : 'Пользователь'}</strong></p>
          {!admin && <form onSubmit={onAdmin}><label>Пароль администратора<input className="site-control" type="password" value={adminPassword} onChange={e => setAdminPassword(e.target.value)} autoComplete="off" required /></label><button className="site-button" disabled={busy !== null}>Подтвердить права администратора</button></form>}
        </section>
      </div>
    </div>
  </main>;
}
