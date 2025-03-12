import { Navigate, Outlet } from 'react-router-dom';
import ErrorBoundary from './ErrorComponent';
import React from 'react';

const ProtectedRoute = () => {
  return localStorage.getItem("AUTOTA_AUTH_TOKEN") != null ? (
    <ErrorBoundary>
      <Outlet />
    </ErrorBoundary>
  ) : (
    <Navigate to="/login" />
  );
};

export default ProtectedRoute;