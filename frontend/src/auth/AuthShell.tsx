import type { ReactNode } from 'react';
import { ArrowLeft, Compass } from 'lucide-react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout';
import './AuthShell.css';

/** Owns one shared site header. Authenticated gate children keep their own layout. */
export function AuthPageFrame({ children }: { children: ReactNode }) {
  return <div className="auth-page"><Layout landing>{children}</Layout></div>;
}

const copy = {
  login: {
    eyebrow: 'ВАША ИСТОРИЯ ПРОДОЛЖАЕТСЯ',
    title: 'С возвращением.',
    accent: 'Герои уже ждут.',
    description: 'Вернитесь к своим персонажам, сохранённым листам и приключениям.',
    formTitle: 'Войти в аккаунт',
    formDescription: 'Всё для следующей главы — в вашей сумке.',
  },
  register: {
    eyebrow: 'ПЕРВАЯ СТРАНИЦА ПРИКЛЮЧЕНИЯ',
    title: 'Каждой истории',
    accent: 'нужен герой.',
    description: 'Создайте аккаунт, чтобы сохранять персонажей и возвращаться к своим приключениям.',
    formTitle: 'Создать аккаунт',
    formDescription: 'Начните свою историю в Bag of Holding.',
  },
};

export function AuthShell({ mode, children }: { mode: keyof typeof copy; children: ReactNode }) {
  const content = copy[mode];
  return <AuthPageFrame>
    <div className={`auth-shell auth-shell-${mode}`}>
      <div className="auth-shell-story">
        <img src="/images/home/interactive.jpg" alt="" className="auth-shell-art" />
        <div className="auth-shell-story-copy">
          <Compass size={30} strokeWidth={1.2} aria-hidden="true" />
          <span className="auth-eyebrow">{content.eyebrow}</span>
          <h1>{content.title}<br /><em>{content.accent}</em></h1>
          <p>{content.description}</p>
        </div>
      </div>
      <section className="auth-shell-panel" aria-labelledby="auth-form-heading">
        <Link className="auth-back-link" to="/"><ArrowLeft size={15} aria-hidden="true" />На главную</Link>
        <h2 id="auth-form-heading">{content.formTitle}</h2>
        <p className="auth-form-intro">{content.formDescription}</p>
        {children}
      </section>
    </div>
  </AuthPageFrame>;
}
