import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import ErrorBoundary from './ErrorComponent';

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const isAuthenticated = localStorage.getItem("AUTOTA_AUTH_TOKEN") != null;
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  // Optionally, wrap in ErrorBoundary if you want error boundaries for all protected routes:
  return <ErrorBoundary>{children ? children : <Outlet />}</ErrorBoundary>;
};

export default ProtectedRoute;