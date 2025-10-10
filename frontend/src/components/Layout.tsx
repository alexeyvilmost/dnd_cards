import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { BookOpen, LogOut, User, Users, UserCircle, ChevronDown } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

interface LayoutProps {
  children: React.ReactNode;
}

const Layout = ({ children }: LayoutProps) => {
  const location = useLocation();
  const { user, logout } = useAuth();

  const navItems = [
    { path: '/', label: 'Библиотека', icon: BookOpen },
    { path: '/dice', label: '🎲 Кубики', icon: UserCircle },
    { 
      label: 'Предметы', 
      icon: UserCircle,
      submenu: [
        { path: '/create', label: 'Создать карту' },
        { path: '/templates', label: 'Шаблоны' },
        { path: '/export', label: 'Экспорт' }
      ]
    },
    { 
      label: 'Аккаунт', 
      icon: User,
      submenu: [
        { path: '/groups', label: 'Мои группы' },
        { path: '/characters', label: 'Мои персонажи' },
        { path: '/characters-v2', label: 'Персонажи V2' },
        { path: '/inventory', label: 'Инвентарь' }
      ]
    }
  ];

  const handleLogout = () => {
    logout();
  };

  return (
    <div className="min-h-screen bg-gray-50" style={{
      backgroundImage: 'linear-gradient(rgba(245, 241, 235, 0.7), rgba(245, 241, 235, 0.7)), url(/groovepaper.png)',
      backgroundRepeat: 'repeat',
      backgroundSize: 'auto'
    }}>
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            {/* Logo */}
            <div className="flex items-center">
              <h1 className="text-2xl font-bold text-gray-900">
                Bag of Holding
              </h1>
            </div>

            {/* Navigation */}
            <nav className="flex items-center space-x-8">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = item.path ? location.pathname === item.path : false;
                
                if (item.submenu) {
                  return (
                    <div key={item.label} className="relative group">
                      <button className="flex items-center space-x-2 px-3 py-2 rounded-md text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors duration-200">
                        <Icon size={18} />
                        <span>{item.label}</span>
                        <ChevronDown size={14} />
                      </button>
                      
                      {/* Dropdown menu */}
                      <div className="absolute top-full left-0 mt-1 w-48 bg-white rounded-md shadow-lg border border-gray-200 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50">
                        <div className="py-1">
                          {item.submenu.map((subItem) => (
                            <Link
                              key={subItem.path}
                              to={subItem.path}
                              className={`block px-4 py-2 text-sm transition-colors duration-200 ${
                                location.pathname === subItem.path
                                  ? 'bg-blue-100 text-blue-700'
                                  : 'text-gray-700 hover:bg-gray-100'
                              }`}
                            >
                              {subItem.label}
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
                    to={item.path}
                    className={`flex items-center space-x-2 px-3 py-2 rounded-md text-sm font-medium transition-colors duration-200 ${
                      isActive
                        ? 'bg-blue-100 text-blue-700'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                    }`}
                  >
                    <Icon size={18} />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>

            {/* User info and logout */}
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2 text-sm text-gray-600">
                <User size={16} />
                <span>{user?.display_name || user?.username}</span>
              </div>
              <button
                onClick={handleLogout}
                className="flex items-center space-x-2 px-3 py-2 rounded-md text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors duration-200"
                title="Выйти"
              >
                <LogOut size={16} />
                <span>Выйти</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  );
};

export default Layout;
