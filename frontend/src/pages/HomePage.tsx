import { ArrowUpRight, BookOpen, Dices, Users } from 'lucide-react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import Layout from '../components/Layout';
import './HomePage.css';

// Preserve links to the former root catalog without redirecting a plain home URL.
const catalogParams = new Set(['type', 'q', 'search', 'card', 'rarity', 'rarities', 'properties', 'tag', 'tag_id', 'page', 'source', 'category',
  'effect', 'template', 'slot', 'armor', 'resource', 'sort', 'view', 'spellLevel', 'spellClass', 'spellSubclass', 'spellSchool',
  'concentration', 'ritual', 'featCategory', 'repeatable', 'featAbility', 'backgroundAbility', 'backgroundSkill']);

export default function HomePage() {
  const location = useLocation();
  if ([...new URLSearchParams(location.search).keys()].some(key => catalogParams.has(key))) {
    return <Navigate replace to={`/library${location.search}${location.hash}`} />;
  }
  return <Layout landing><div className="home-hub">
    <div className="home-intro"><span className="home-eyebrow">ВАША СЛЕДУЮЩАЯ ИСТОРИЯ</span>
      <h1>Всё для приключения.<br /><em>В одной сумке.</em></h1>
      <p>Найдите нужное заклинание, создайте героя<br className="home-desktop-break" /> и отправляйтесь навстречу неизвестному.</p>
      <span className="home-seal" aria-hidden="true"><Dices strokeWidth={1} /></span>
    </div>
    <div className="home-tiles">
      <section className="home-tile home-tile-library" aria-labelledby="home-library-title">
        <img className="home-tile-art" src="/images/home/library.jpg" alt="" loading="eager" />
        <div className="home-tile-shade" />
        <div className="home-tile-content"><span className="home-tile-kicker"><BookOpen size={17} /> ЗНАНИЯ И СОКРОВИЩА</span>
          <h2 id="home-library-title"><Link to="/library">Библиотека <ArrowUpRight /></Link></h2>
          <p>Всё, что может встретиться за игровым столом.</p>
          <div className="home-catalog-links">
            {[
              ['Предметы', '/library'], ['Заклинания', '/library?type=spells'],
              ['Черты', '/library?type=feats'], ['Виды', '/library?type=races'],
              ['Классы', '/library?type=classes'], ['Монстры', '/monsters'],
            ].map(([label, path]) => <Link key={path} to={path}>{label}<ArrowUpRight size={13} /></Link>)}
          </div>
        </div>
      </section>
      <section className="home-tile home-tile-interactive" aria-labelledby="home-characters-title">
        <img className="home-tile-art" src="/images/home/interactive.jpg" alt="" loading="lazy" />
        <div className="home-tile-shade" /><span className="home-tile-arrow"><ArrowUpRight /></span>
        <div className="home-tile-content"><span className="home-tile-kicker"><Users size={17} /> ГЕРОЙ В ДЕТАЛЯХ</span>
          <h2 id="home-characters-title"><Link to="/characters-forge">Персонажи <ArrowUpRight /></Link></h2><p>Интерактивные и бумажные листы,<br />герои забегов и готовые шаблоны.</p>
          <div className="home-catalog-links">
            <Link to="/characters-forge">Стандартные</Link><Link to="/characters-forge?tab=paper">Бумажные</Link>
            <Link to="/characters-forge?tab=runs">Забеги</Link><Link to="/characters-forge?tab=templates">Шаблоны</Link>
          </div>
        </div>
      </section>
      <Link to="/roguelike" className="home-tile home-tile-runs">
        <img className="home-tile-art" src="/images/home/runs.jpg" alt="" loading="lazy" />
        <div className="home-tile-shade" /><span className="home-tile-arrow"><ArrowUpRight /></span>
        <div className="home-tile-content"><span className="home-tile-kicker"><Dices size={17} /> ИСПЫТАЙТЕ СВОЮ УДАЧУ</span>
          <h2>Забеги</h2><p>Тактические бои, добыча и новые испытания.<br />Один герой или целый отряд.</p>
          <span className="home-tile-footnote">1–6 персонажей · Пошаговые сражения</span>
        </div>
      </Link>
    </div>
    <footer className="home-footer"><span>Bag of Holding</span><span>Хорошие истории начинаются с броска кубика.</span><Dices size={20} aria-hidden="true" /></footer>
  </div></Layout>;
}
