import React, { Component } from 'react';
import 'semantic-ui-css/semantic.min.css';
import { Grid } from 'semantic-ui-react';
import MenuComponent from '../components/MenuComponent';
import '../css/AdminComponent.scss';
import { Helmet } from "react-helmet";
import AdminLandingComponent from '../components/AdminLandingComponent';


const SafeHelmet: any = Helmet;

class AdminLanding extends Component<{}, {}> {
  render() {
    return (
      <div>
        <SafeHelmet>
          <title>[Admin] Projects | TA-Bot</title>
        </SafeHelmet>
        <MenuComponent 
          showUpload={false} 
          showAdminUpload={false} 
          showHelp={false} 
          showCreate={false} 
          showLast={false} 
          showReviewButton={false} 
        />
        <Grid className="main-grid">
          <AdminLandingComponent />
        </Grid>
      </div>
    );
  }
}

export default AdminLanding;