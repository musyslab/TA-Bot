import { Navigate, Route, Outlet } from 'react-router-dom'; // Import Outlet if needed for nested routes
import ErrorBoundary from './ErrorComponent';

const ProtectedRoute = ({ component: Component, ...rest }: any) => {
  return (
    <Route
      {...rest}
      element={
        localStorage.getItem("AUTOTA_AUTH_TOKEN") != null ? (
          <ErrorBoundary>
            <Component />
          </ErrorBoundary>
        ) : (
          <Navigate to="/login" />
        )
      }
    />
  );
};

export default ProtectedRoute;
