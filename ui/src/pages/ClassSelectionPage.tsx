import React, { Component } from 'react';
import 'semantic-ui-css/semantic.min.css';
import { Helmet, HelmetProps } from "react-helmet";
import MenuComponent from '../components/MenuComponent';
import ClassSelectionPageComponent from '../components/ClassSelectionPageComponent';

// Wrap Helmet to satisfy JSX element requirements
const SafeHelmet: React.FC<HelmetProps> = Helmet as any;

class ClassSelectionPage extends Component {
  render() {
    return (
      <div id="code-page">
        <SafeHelmet>
          <title>Select A Class | TA-Bot</title>
        </SafeHelmet>
        <MenuComponent
          showUpload={true}
          showAdminUpload={false}
          showHelp={false}
          showCreate={false}
          showLast={false}
          showReviewButton={false}
        />
        <ClassSelectionPageComponent />
      </div>
    );
  }
}

export default ClassSelectionPage;
