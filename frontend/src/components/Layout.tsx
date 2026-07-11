import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { BookOpen, LogOut, User, Users, Store, ChevronDown, Menu, X, Sparkles, Swords, MoreHorizontal, type LucideIcon } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

interface LayoutProps {
  children: React.ReactNode;
}

type SubItem = { label: string; path?: string; onClick?: () => void };
type NavItem = { label: string; icon: LucideIcon; path?: string; submenu?: SubItem[] };

const Layout = ({ children }: LayoutProps) => {
  const location = useLocation();
  const { user, logout } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Библиотека открывается кликом по названию сайта; «Создать *» убраны из панели.
  // Прямые пункты — в один клик; редкие инструменты и аккаунт — в компактных меню.
  const navItems: NavItem[] = [
    { path: '/characters-forge', label: 'Персонажи', icon: Users },
    { path: '/shop/new', label: 'Магазин', icon: Store },
    { path: '/initiative', label: 'Инициатива', icon: Swords },
    { path: '/image-generator', label: 'Генерация', icon: Sparkles },
    { path: '/docs/mechanics', label: 'Документация', icon: BookOpen },
    {
      label: 'Ещё', icon: MoreHorizontal,
      submenu: [
        { path: '/templates', label: 'Шаблоны' },
        { path: '/export', label: 'Экспорт' },
      ],
    },
    {
      label: 'Аккаунт', icon: User,
      submenu: [
        { path: '/groups', label: 'Мои группы' },
        { path: '/inventory', label: 'Инвентарь' },
        { path: '/settings', label: 'Настройки' },
        { label: 'Выйти', onClick: logout },
      ],
    },
  ];

  const isActive = (path?: string) => !!path && location.pathname === path;

  return (
    <div className="min-h-screen bg-gray-50" style={{
      backgroundImage: 'linear-gradient(rgba(245, 241, 235, 0.7), rgba(245, 241, 235, 0.7)), url(/groovepaper.png)',
      backgroundRepeat: 'repeat',
      backgroundSize: 'auto',
    }}>
      {/* Header (компактный) */}
      <header className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-12">
            {/* Логотип → библиотека */}
            <Link to="/" title="В библиотеку" className="text-lg sm:text-xl font-bold text-gray-900 truncate hover:text-gray-700 transition-colors">
              Bag of Holding
            </Link>

            {/* Кнопка мобильного меню */}
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="lg:hidden p-2 rounded-md text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors"
              aria-label="Меню"
            >
              {isMobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
            </button>

            {/* Десктоп-навигация */}
            <nav className="hidden lg:flex items-center gap-0.5">
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
                      <div className="absolute top-full right-0 mt-1 w-44 bg-white rounded-md shadow-lg border border-gray-200 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150 z-50">
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
          <div className="lg:hidden border-t border-gray-200 bg-white">
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
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">
        {children}
      </main>
    </div>
  );
};

export default Layout;
