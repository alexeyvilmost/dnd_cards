import React, { useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { BookOpen, Dices, LogOut, User, Users, ChevronDown, Menu, X, MoreHorizontal, ScrollText, type LucideIcon } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { WORKSPACE_EXPANDED_KEY, WorkspaceNavigationContext } from './WorkspaceNavigation';
import './WorkspaceNavigation.css';

interface LayoutProps {
  children: React.ReactNode;
  landing?: boolean;
  workspace?: boolean;
}

type SubItem = { label: string; path?: string; onClick?: () => void };
type NavItem = { label: string; icon: LucideIcon; path?: string; submenu?: SubItem[] };

const Layout = ({ children, landing = false, workspace = false }: LayoutProps) => {
  const location = useLocation();
  const { user, logout } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [expanded, setExpanded] = useState(() => { try { return sessionStorage.getItem(WORKSPACE_EXPANDED_KEY) === 'true'; } catch { return false; } });
  const navigation = useRef<HTMLElement>(null);
  const [navigationHeight, setNavigationHeight] = useState(64);
  const hiddenNavigation = workspace && expanded;
  useLayoutEffect(() => {
    if (!workspace || !navigation.current) return;
    const measure = () => setNavigationHeight(navigation.current?.getBoundingClientRect().height ?? 0);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(navigation.current);
    return () => observer.disconnect();
  }, [workspace, hiddenNavigation]);
  const toggleNavigation = () => {
    setIsMobileMenuOpen(false);
    setExpanded(value => {
      try { sessionStorage.setItem(WORKSPACE_EXPANDED_KEY, String(!value)); } catch { /* In-memory mode remains usable. */ }
      return !value;
    });
  };
  // The paper editor keeps its existing page frame and print-friendly appearance.
  const paperLayout = /^\/paper-sheet(?:\/|$)/.test(location.pathname);

  const navItems: NavItem[] = [
    { path: '/library', label: 'Библиотека', icon: BookOpen },
    { path: '/characters-forge', label: 'Персонажи', icon: Users },
    { path: '/paper-sheet', label: 'Бумажный лист', icon: ScrollText },
    { path: '/roguelike', label: 'Забег', icon: Dices },
    {
      label: 'Ещё', icon: MoreHorizontal,
      submenu: [
        { path: '/templates', label: 'Шаблоны' },
        { path: '/export', label: 'Экспорт' },
      ],
    },
    user ? {
      label: 'Аккаунт', icon: User,
      submenu: [
        { path: '/groups', label: 'Мои группы' },
        { path: '/inventory', label: 'Инвентарь' },
        { path: '/settings', label: 'Настройки' },
        { label: 'Выйти', onClick: logout },
      ],
    } : { path: '/login', label: 'Войти', icon: User },
  ];

  const isActive = (path?: string) => !!path && (location.pathname === path
    || (path === '/library' && location.pathname === '/monsters')
    || (path === '/characters-forge' && /^\/characters-v3\//.test(location.pathname))
    || (path === '/roguelike' && location.pathname.startsWith('/roguelike/')));

  return (
    <WorkspaceNavigationContext.Provider value={workspace ? { expanded, toggle: toggleNavigation } : null}>
    <div className={`site-layout min-h-screen ${workspace ? 'site-layout-workspace' : ''} ${paperLayout ? 'site-layout-paper bg-gray-50' : 'site-page-theme'} ${landing ? 'site-layout-landing' : ''}`} style={paperLayout ? {
      backgroundImage: 'linear-gradient(rgba(245, 241, 235, 0.7), rgba(245, 241, 235, 0.7)), url(/groovepaper.png)',
      backgroundRepeat: 'repeat', backgroundSize: 'auto', color: '#111827',
    } : workspace ? { '--site-navigation-height': `${hiddenNavigation ? 0 : navigationHeight}px` } as React.CSSProperties : undefined}>
      {/* Header (компактный) */}
      <header id="site-navigation" ref={navigation} hidden={hiddenNavigation} className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-[1600px] mx-auto px-3 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center gap-2 h-12">
            <Link to="/" aria-description="На главную" className="site-brand text-lg sm:text-xl font-bold text-gray-900 truncate hover:text-gray-700 transition-colors">
              Bag of Holding
            </Link>

            <Link
              to="/paper-sheet"
              aria-label="Бумажный лист"
              aria-current={isActive('/paper-sheet') ? 'page' : undefined}
              className={`min-[1100px]:hidden ml-auto flex shrink-0 items-center gap-1.5 px-2 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-colors ${
                isActive('/paper-sheet') ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
              }`}
            >
              <ScrollText size={16} />
              <span className="max-[379px]:hidden">Бумажный лист</span>
            </Link>

            {/* Кнопка мобильного меню */}
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="min-[1100px]:hidden p-2 rounded-md text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors"
              aria-label="Меню"
              aria-expanded={isMobileMenuOpen}
              aria-controls="site-mobile-navigation"
            >
              {isMobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
            </button>

            {/* Десктоп-навигация */}
            <nav aria-label="Главная навигация" className="hidden min-[1100px]:flex items-center gap-0.5 whitespace-nowrap">
              {navItems.map((item) => {
                const Icon = item.icon;

                if (item.submenu) {
                  return (
                    <div key={item.label} className="relative group">
                      <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors">
                        <Icon size={16} />
                        <span>{item.label}</span>
                        <ChevronDown size={13} />
                      </button>
                      <div className="absolute top-full right-0 mt-1 w-44 bg-white rounded-md shadow-lg border border-gray-200 opacity-0 invisible group-hover:opacity-100 group-hover:visible group-focus-within:opacity-100 group-focus-within:visible transition-all duration-150 z-50">
                        {item.label === 'Аккаунт' && (
                          <div className="px-4 py-2 text-xs text-gray-500 border-b border-gray-100 flex items-center gap-2 truncate">
                            <User size={13} /><span className="truncate">{user?.display_name || user?.username}</span>
                          </div>
                        )}
                        <div className="py-1">
                          {item.submenu.map((sub) => sub.onClick ? (
                            <button
                              key={sub.label}
                              onClick={sub.onClick}
                              className="w-full text-left flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
                            >
                              <LogOut size={14} />{sub.label}
                            </button>
                          ) : (
                            <Link
                              key={sub.path}
                              to={sub.path!}
                              className={`block px-4 py-2 text-sm transition-colors ${
                                isActive(sub.path) ? 'bg-blue-100 text-blue-700' : 'text-gray-700 hover:bg-gray-100'
                              }`}
                            >
                              {sub.label}
                            </Link>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                }

                return (
                  <Link
                    key={item.path}
                    to={item.path!}
                    aria-current={isActive(item.path) ? 'page' : undefined}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      isActive(item.path) ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                    }`}
                  >
                    <Icon size={16} />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>

        {/* Мобильное меню */}
        {isMobileMenuOpen && (
          <div id="site-mobile-navigation" className="min-[1100px]:hidden border-t border-gray-200 bg-white">
            <div className="px-4 py-3 space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                if (item.submenu) {
                  return (
                    <div key={item.label} className="space-y-1">
                      <div className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-gray-700">
                        <Icon size={16} /><span>{item.label}</span>
                      </div>
                      <div className="pl-8 space-y-1">
                        {item.submenu.map((sub) => sub.onClick ? (
                          <button
                            key={sub.label}
                            onClick={() => { sub.onClick!(); setIsMobileMenuOpen(false); }}
                            className="w-full text-left flex items-center gap-2 px-3 py-2 text-sm rounded-md text-gray-600 hover:bg-gray-100"
                          >
                            <LogOut size={14} />{sub.label}
                          </button>
                        ) : (
                          <Link
                            key={sub.path}
                            to={sub.path!}
                            onClick={() => setIsMobileMenuOpen(false)}
                            className={`block px-3 py-2 text-sm rounded-md transition-colors ${
                              isActive(sub.path) ? 'bg-blue-100 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-100'
                            }`}
                          >
                            {sub.label}
                          </Link>
                        ))}
                      </div>
                    </div>
                  );
                }
                return (
                  <Link
                    key={item.path}
                    to={item.path!}
                    aria-current={isActive(item.path) ? 'page' : undefined}
                    onClick={() => setIsMobileMenuOpen(false)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                      isActive(item.path) ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    <Icon size={16} /><span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </header>

      {/* Основной контент */}
      <main className={landing ? 'landing-main' : 'max-w-[1500px] mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8'}>
        {children}
      </main>
    </div>
    </WorkspaceNavigationContext.Provider>
  );
};

export default Layout;
