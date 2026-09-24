import { ArrowLeft, ArrowRight, Backpack, BookOpen, Dices, Shield, Users } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { AuthPageFrame } from '../auth/AuthShell';
import './GuestSectionPage.css';

export type GuestSection = 'characters' | 'runs';

const sections = {
  characters: {
    eyebrow: 'ИНТЕРАКТИВНЫЕ ЛИСТЫ ПЕРСОНАЖЕЙ',
    title: 'Ваш герой.',
    accent: 'Ваша история.',
    description: 'От первого выбора класса до последнего заклинания. Создавайте персонажей и держите всё нужное для игры под рукой.',
    invitation: 'Войдите, чтобы открыть свои листы, или создайте аккаунт для первого героя.',
    image: '/images/home/interactive.jpg',
    Icon: Users,
    features: [
      { Icon: Users, title: 'Создайте героя', text: 'Выберите вид и класс, определите характеристики и способности.' },
      { Icon: BookOpen, title: 'Откройте свой лист', text: 'Характеристики, действия и заклинания собраны в одном месте.' },
      { Icon: Backpack, title: 'Соберитесь в путь', text: 'Подберите снаряжение и возвращайтесь к сохранённым персонажам.' },
    ],
  },
  runs: {
    eyebrow: 'ТАКТИЧЕСКИЕ ЗАБЕГИ',
    title: 'Впереди —',
    accent: 'неизвестное.',
    description: 'Соберите отряд и отправляйтесь навстречу испытаниям. Продумывайте каждый ход, находите добычу и выбирайте свой путь.',
    invitation: 'Войдите, чтобы начать забег или вернуться к своему приключению. Впервые здесь? Создайте аккаунт.',
    image: '/images/home/runs.jpg',
    Icon: Dices,
    features: [
      { Icon: Users, title: 'Герой или отряд', text: 'Отправляйтесь в путь с одним героем или группой до шести персонажей.' },
      { Icon: Shield, title: 'Каждый ход важен', text: 'Выбирайте позиции и способности в пошаговых сражениях.' },
      { Icon: Backpack, title: 'Трофеи и испытания', text: 'Находите снаряжение и готовьтесь к следующим встречам.' },
    ],
  },
};

/** Public introduction only: never loads characters, runs, or game authority. */
export default function GuestSectionPage({ section }: { section: GuestSection }) {
  const location = useLocation();
  const content = sections[section];
  const returnState = { from: { pathname: location.pathname, search: location.search, hash: location.hash } };
  const Icon = content.Icon;

  return <AuthPageFrame>
    <div className={`guest-section guest-section-${section}`}>
      <Link className="auth-back-link" to="/"><ArrowLeft size={15} aria-hidden="true" />На главную</Link>
      <section className="guest-section-hero" aria-labelledby="guest-section-heading">
        <img className="guest-section-art" src={content.image} alt="" />
        <div className="guest-section-copy">
          <Icon size={32} strokeWidth={1.3} aria-hidden="true" />
          <span className="auth-eyebrow">{content.eyebrow}</span>
          <h1 id="guest-section-heading">{content.title}<br /><em>{content.accent}</em></h1>
          <p className="guest-section-description">{content.description}</p>
          <p className="guest-section-invitation">{content.invitation}</p>
          <div className="guest-section-actions">
            <Link className="guest-section-primary" to="/login" state={returnState}>Войти<ArrowRight size={17} aria-hidden="true" /></Link>
            <Link to="/register" state={returnState}>Создать аккаунт</Link>
          </div>
        </div>
      </section>
      <ul className="guest-section-features" aria-label={section === 'characters' ? 'Возможности листов персонажей' : 'Что ждёт в забеге'}>
        {content.features.map(({ Icon: FeatureIcon, title, text }) => <li key={title}>
          <FeatureIcon size={22} strokeWidth={1.4} aria-hidden="true" />
          <div><h2>{title}</h2><p>{text}</p></div>
        </li>)}
      </ul>
      <p className="guest-section-browse">Пока выбираете приключение, загляните в <Link to="/library">библиотеку</Link> — она открыта всем.</p>
    </div>
  </AuthPageFrame>;
}
