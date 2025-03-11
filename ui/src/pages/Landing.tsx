import { Component } from 'react';
import 'semantic-ui-css/semantic.min.css'
import { Navigate  } from 'react-router-dom'

class LandingPage extends Component {
  render() {
    if (localStorage.getItem("AUTOTA_AUTH_TOKEN") != null) {
        return ( <Navigate to={{pathname: '/class/1/upload'}}/> );
    } else {
        return ( <Navigate to={{pathname: '/login'}}/> );
    }
  }
}

export default LandingPage;
