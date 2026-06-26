import React from 'react';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

// ВНИМАНИЕ: авторизация временно отключена по запросу — сайт доступен без
// токенов/логинов. ProtectedRoute сейчас просто пропускает детей без проверок.
// Чтобы вернуть защиту — восстановите проверку useAuth()/Navigate ниже.
const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  return <>{children}</>;
};

export default ProtectedRoute;
