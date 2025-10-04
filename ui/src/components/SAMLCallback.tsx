import React, { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { Loader, Dimmer } from 'semantic-ui-react';

const SAMLCallback: React.FC = () => {
  useEffect(() => {
    // This component handles the SAML callback
    // The SAML response is processed by the backend
    // and we should get redirected or receive a token
    
    // Check if we have a token in localStorage
    const token = localStorage.getItem('AUTOTA_AUTH_TOKEN');
    if (token) {
      // Token found, user is authenticated
      window.location.href = '/class/classes'; // or appropriate redirect
    } else {
      // No token, there might have been an error
      // Redirect back to login
      setTimeout(() => {
        window.location.href = '/login';
      }, 3000);
    }
  }, []);

  return (
    <Dimmer active>
      <Loader size="large">Processing login...</Loader>
    </Dimmer>
  );
};

export default SAMLCallback;