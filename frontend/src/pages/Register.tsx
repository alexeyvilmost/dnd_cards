import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Eye, EyeOff, User, Mail, Lock, UserCheck } from 'lucide-react';
import { authenticatedReturnPath } from '../authReturnPath';
import { OAuthButtons } from '../auth/OAuthButtons';
import { safeAuthPath } from '../auth/oauth';
import { AuthShell } from '../auth/AuthShell';

const Register: React.FC = () => {
  const [formData, setFormData] = useState({ username: '', email: '', password: '', confirmPassword: '', display_name: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const returnPath = safeAuthPath(authenticatedReturnPath(location.state));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    if (formData.password !== formData.confirmPassword) {
      setError('Пароли не совпадают');
      setIsLoading(false);
      return;
    }
    if (formData.password.length < 6) {
      setError('Пароль должен содержать минимум 6 символов');
      setIsLoading(false);
      return;
    }
    try {
      await register({ username: formData.username, email: formData.email, password: formData.password, display_name: formData.display_name });
      navigate(returnPath, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка регистрации');
    } finally {
      setIsLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  return <AuthShell mode="register">
    <div className="auth-oauth"><OAuthButtons returnPath={returnPath} disabled={isLoading} /></div>
    <form onSubmit={handleSubmit} className="auth-form" aria-labelledby="auth-form-heading" aria-describedby={error ? 'register-error' : undefined}>
      {error && <p id="register-error" role="alert" className="auth-message auth-message-error">{error}</p>}
      <div className="auth-field">
        <label htmlFor="username">Имя пользователя</label>
        <div className="auth-input-wrap">
          <User className="auth-input-icon" aria-hidden="true" />
          <input id="username" name="username" type="text" autoComplete="username" required minLength={3} maxLength={50} value={formData.username} onChange={handleChange} placeholder="Введите имя пользователя" />
        </div>
      </div>
      <div className="auth-field">
        <label htmlFor="email">Email</label>
        <div className="auth-input-wrap">
          <Mail className="auth-input-icon" aria-hidden="true" />
          <input id="email" name="email" type="email" autoComplete="email" required value={formData.email} onChange={handleChange} placeholder="Введите email" />
        </div>
      </div>
      <div className="auth-field">
        <label htmlFor="display_name">Отображаемое имя</label>
        <div className="auth-input-wrap">
          <UserCheck className="auth-input-icon" aria-hidden="true" />
          <input id="display_name" name="display_name" type="text" autoComplete="nickname" required minLength={1} maxLength={100} value={formData.display_name} onChange={handleChange} placeholder="Как к вам обращаться" />
        </div>
      </div>
      <div className="auth-field">
        <label htmlFor="password">Пароль</label>
        <div className="auth-input-wrap">
          <Lock className="auth-input-icon" aria-hidden="true" />
          <input id="password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" required minLength={6} value={formData.password} onChange={handleChange} className="auth-password" placeholder="Придумайте пароль" aria-describedby="password-hint" />
          <button type="button" className="auth-password-toggle" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'} aria-pressed={showPassword} aria-controls="password">
            {showPassword ? <EyeOff size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}
          </button>
        </div>
        <p id="password-hint" className="auth-field-hint">Не менее 6 символов.</p>
      </div>
      <div className="auth-field">
        <label htmlFor="confirmPassword">Подтвердите пароль</label>
        <div className="auth-input-wrap">
          <Lock className="auth-input-icon" aria-hidden="true" />
          <input id="confirmPassword" name="confirmPassword" type={showConfirmPassword ? 'text' : 'password'} autoComplete="new-password" required value={formData.confirmPassword} onChange={handleChange} className="auth-password" placeholder="Повторите пароль" />
          <button type="button" className="auth-password-toggle" onClick={() => setShowConfirmPassword(!showConfirmPassword)} aria-label={showConfirmPassword ? 'Скрыть подтверждение пароля' : 'Показать подтверждение пароля'} aria-pressed={showConfirmPassword} aria-controls="confirmPassword">
            {showConfirmPassword ? <EyeOff size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}
          </button>
        </div>
      </div>
      <button type="submit" disabled={isLoading} className="auth-submit" aria-busy={isLoading}>
        {isLoading ? 'Регистрация…' : 'Зарегистрироваться'}
      </button>
    </form>
    <p className="auth-switch">Уже есть аккаунт?{' '}<Link to="/login" state={location.state}>Войти</Link></p>
  </AuthShell>;
};

export default Register;
