import React, { createContext, useContext, useState, useCallback } from 'react';
import Toast, { ToastProps } from '../components/Toast';
import type { Effect } from '../types';

interface ToastContextType {
  showToast: (toast: Omit<ToastProps, 'id' | 'onClose'>) => void;
  hideToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};

interface ToastProviderProps {
  children: React.ReactNode;
}

interface ToastState extends Omit<ToastProps, 'onClose'> {
  id: string;
}

export const ToastProvider: React.FC<ToastProviderProps> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastState[]>([]);
  const [recentToasts, setRecentToasts] = useState<Map<string, number>>(new Map());

  const showToast = useCallback((toast: Omit<ToastProps, 'id' | 'onClose'>) => {
    const id = Math.random().toString(36).substr(2, 9);
    
    // Создаем ключ для идентификации похожих уведомлений
    const toastKey = `${toast.title}|${toast.message}|${toast.type}`;
    const now = Date.now();
    const cooldownTime = 5000; // 5 секунд кулдауна
    
    // Проверяем активные toast'ы
    const isActiveDuplicate = toasts.some(existingToast => 
      existingToast.title === toast.title && 
      existingToast.message === toast.message &&
      existingToast.type === toast.type
    );
    
    // Проверяем недавние toast'ы (кулдаун)
    const lastShown = recentToasts.get(toastKey);
    const isRecentDuplicate = lastShown && (now - lastShown) < cooldownTime;
    
    if (isActiveDuplicate || isRecentDuplicate) {
      console.log('🚫 [TOAST] Дублирующееся уведомление заблокировано:', toast.title);
      return;
    }
    
    // Обновляем время последнего показа
    setRecentToasts(prev => {
      const newMap = new Map(prev);
      newMap.set(toastKey, now);
      return newMap;
    });
    
    const newToast: ToastState = {
      ...toast,
      id,
    };
    
    console.log('📢 [TOAST] Показываем уведомление:', newToast.title);
    setToasts(prev => [...prev, newToast]);
  }, [toasts, recentToasts]);

  const hideToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
  }, []);

  // Очищаем старые записи кулдауна каждые 30 секунд
  React.useEffect(() => {
    const cleanupInterval = setInterval(() => {
      const now = Date.now();
      const cooldownTime = 5000;
      
      setRecentToasts(prev => {
        const newMap = new Map();
        for (const [key, timestamp] of prev) {
          if (now - timestamp < cooldownTime) {
            newMap.set(key, timestamp);
          }
        }
        return newMap;
      });
    }, 30000); // Очистка каждые 30 секунд

    return () => clearInterval(cleanupInterval);
  }, []);

  const value = {
    showToast,
    hideToast,
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Рендерим все toast-уведомления */}
      <div className="fixed bottom-4 right-4 z-50 space-y-2">
        {toasts.map((toast, index) => (
          <div
            key={toast.id}
            style={{
              transform: `translateY(${index * -10}px)`,
              zIndex: 50 - index,
            }}
          >
            <Toast
              {...toast}
              onClose={hideToast}
            />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};
