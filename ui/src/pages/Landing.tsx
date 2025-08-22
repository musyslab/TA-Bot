import { Component } from 'react';
import 'semantic-ui-css/semantic.min.css'
import { Navigate } from 'react-router-dom';

class LandingPage extends Component {
  render() {
    return <Navigate to="/login" replace />;
  }
}

export default LandingPage;
