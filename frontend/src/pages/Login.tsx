import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Eye, EyeOff, User, Lock } from 'lucide-react';
import { authenticatedReturnPath } from '../authReturnPath';
import { OAuthButtons } from '../auth/OAuthButtons';
import { safeAuthPath } from '../auth/oauth';
import { AuthShell } from '../auth/AuthShell';

const Login: React.FC = () => {
  const [formData, setFormData] = useState({ username: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { login, oauthError, oauthReturnPath, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const returnPath = safeAuthPath(authenticatedReturnPath(location.state));

  useEffect(() => {
    if (oauthReturnPath !== null) navigate(safeAuthPath(oauthReturnPath), { replace: true });
  }, [oauthReturnPath, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      await login(formData);
      navigate(returnPath, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка входа');
    } finally {
      setIsLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  return <AuthShell mode="login">
    <div className="auth-oauth"><OAuthButtons returnPath={returnPath} disabled={isLoading || authLoading} /></div>
    {oauthError && <p role="alert" className="auth-message auth-message-error">{oauthError}</p>}
    {authLoading && <p role="status" className="auth-message">Проверяем вход…</p>}
    <form onSubmit={handleSubmit} className="auth-form" aria-labelledby="auth-form-heading" aria-describedby={error ? 'login-error' : undefined}>
      {error && <p id="login-error" role="alert" className="auth-message auth-message-error">{error}</p>}
      <div className="auth-field">
        <label htmlFor="username">Имя пользователя</label>
        <div className="auth-input-wrap">
          <User className="auth-input-icon" aria-hidden="true" />
          <input id="username" name="username" type="text" autoComplete="username" required value={formData.username} onChange={handleChange} placeholder="Введите имя пользователя" />
        </div>
      </div>
      <div className="auth-field">
        <label htmlFor="password">Пароль</label>
        <div className="auth-input-wrap">
          <Lock className="auth-input-icon" aria-hidden="true" />
          <input id="password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required value={formData.password} onChange={handleChange} className="auth-password" placeholder="Введите пароль" />
          <button type="button" className="auth-password-toggle" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'} aria-pressed={showPassword} aria-controls="password">
            {showPassword ? <EyeOff size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}
          </button>
        </div>
      </div>
      <button type="submit" disabled={isLoading || authLoading} className="auth-submit" aria-busy={isLoading}>
        {isLoading ? 'Вход…' : 'Войти'}
      </button>
    </form>
    <p className="auth-switch">Нет аккаунта?{' '}<Link to="/register" state={location.state}>Зарегистрироваться</Link></p>
  </AuthShell>;
};

export default Login;
