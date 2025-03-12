import { Component } from 'react';
import { Helmet } from 'react-helmet-async'; // Updated import
import 'semantic-ui-css/semantic.min.css';
import { Grid } from 'semantic-ui-react';
import MenuComponent from './MenuComponent';
import React from 'react';

class CriticalErrorPage extends Component {
  render() {
    return (
      <div>
        <Helmet>
          <title>500 Error | TA-Bot</title>
        </Helmet>
        <MenuComponent
          showAdminUpload={false}
          showUpload={false}
          showHelp={false}
          showCreate={false}
          showLast={false}
          showReviewButton={false}
        ></MenuComponent>
        <Grid textAlign="center" style={{ height: '100vh' }} verticalAlign="middle">
          <Grid.Column style={{ maxWidth: 600 }}>
            <img
              src="https://i.ytimg.com/vi/AY-rnBoaiY8/maxresdefault.jpg"
              alt="Sad robot"
              height="200px"
              width="300px"
            />
            <h1>We're sorry. AutoTA failed this test.</h1>
            <p>A critical error occurred when rendering the page.</p>
            <p>If this continues to occur, please contact us.</p>
          </Grid.Column>
        </Grid>
      </div>
    );
  }
}

export default CriticalErrorPage;
