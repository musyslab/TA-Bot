import { Component } from 'react';
import 'semantic-ui-css/semantic.min.css';
import { Grid } from 'semantic-ui-react';
import MenuComponent from '../components/MenuComponent';
import '../css/AdminComponent.scss';
import { Helmet } from "react-helmet";
import TaLandingComponent from '../components/TaLandingComponent';
import React from 'react';

// Cast Helmet to `any` to avoid TypeScript issue
const SafeHelmet: any = Helmet;

class TaLanding extends Component<{}, {}> {
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
          <TaLandingComponent />
        </Grid>
      </div>
    );
  }
}

export default TaLanding;
