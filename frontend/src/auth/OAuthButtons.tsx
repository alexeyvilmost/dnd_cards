import { useEffect, useId, useState } from 'react';
import { authApi } from '../api/authApi';
import { startOAuth, type OAuthProviderID, type OAuthProviderStatus } from './oauth';

export function OAuthButtons({ returnPath, disabled = false }: { returnPath: string; disabled?: boolean }) {
  const [providers, setProviders] = useState<OAuthProviderStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const description = useId();
  useEffect(() => {
    let active = true;
    void authApi.oauthProviders().then((result) => {
      if (active) setProviders(result.providers);
    }).catch(() => {
      if (active) setError('Не удалось проверить доступность входа через Google и Яндекс.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const start = async (id: OAuthProviderID) => {
    setBusy(true);
    setError('');
    try { await startOAuth(id, returnPath); } catch {
      setBusy(false);
      setError('Не удалось начать вход. Разрешите хранение данных сайта и попробуйте снова.');
    }
  };

  return <div className="mb-6 space-y-3" aria-label="Вход через внешний аккаунт">
    <p className="text-sm text-gray-200 text-center">Войти или создать аккаунт</p>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {(['google', 'yandex'] as const).map((id) => {
        const provider = providers.find((entry) => entry.id === id);
        return <button key={id} type="button" onClick={() => void start(id)}
          disabled={disabled || busy || loading || !provider?.enabled}
          aria-describedby={description}
          className="flex items-center justify-center gap-2 rounded-lg border border-white/30 bg-white text-gray-900 px-4 py-3 font-medium hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed">
          <span aria-hidden="true" className={id === 'yandex' ? 'text-red-600 font-bold' : 'text-blue-600 font-bold'}>{id === 'google' ? 'G' : 'Я'}</span>
          {id === 'google' ? 'Google' : 'Яндекс'}
        </button>;
      })}
    </div>
    <p id={description} className="text-xs text-gray-300 text-center" aria-live="polite">
      {loading ? 'Проверяем способы входа…' : busy ? 'Переходим к входу…'
        : error || (providers.some((p) => !p.enabled) || providers.length < 2
          ? 'Недоступные способы входа пока не настроены или временно отключены.'
          : 'Если аккаунта ещё нет, он будет создан автоматически.')}
    </p>
    <div className="text-center text-sm text-gray-400">или с помощью пароля</div>
  </div>;
}
