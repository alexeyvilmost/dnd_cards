import { Link } from 'react-router-dom';

// Страница «не найдено» для любых опечаток в URL (иначе — белый экран).
const linkStyle: React.CSSProperties = {
  padding: '9px 18px', borderRadius: 8, border: '1px solid #6b5836',
  color: '#d8b978', textDecoration: 'none', fontSize: '0.95rem',
};

export default function NotFound() {
  return (
    <div
      style={{
        minHeight: '80vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 18,
        textAlign: 'center', padding: 24,
      }}
    >
      <h1 style={{ fontSize: '3.4rem', margin: 0, color: '#d8b978', fontFamily: 'Georgia, serif' }}>404</h1>
      <p style={{ fontSize: '1.15rem', color: '#a59886', margin: 0 }}>Такой страницы нет.</p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center', marginTop: 6 }}>
        <Link to="/" style={linkStyle}>На главную</Link>
        <Link to="/characters-forge" style={linkStyle}>Мои персонажи</Link>
      </div>
    </div>
  );
}
