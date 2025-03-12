import React, { Component } from 'react';
import 'semantic-ui-css/semantic.min.css';
import { Navigate } from 'react-router-dom';

class LandingPage extends Component {
  render() {
    if (localStorage.getItem("AUTOTA_AUTH_TOKEN") != null) {
      return <Navigate to='/class/1/upload' replace />;
    } else {
      return <Navigate to='/login' replace />;
    }
  }
}

export default LandingPage;
