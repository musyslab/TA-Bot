import React, { Component } from 'react';
import 'semantic-ui-css/semantic.min.css';
import OfficeHoursComponent from '../components/OfficeHoursComponent';
import { Helmet, HelmetProps } from "react-helmet";
import MenuComponent from '../components/MenuComponent';

// Wrap Helmet to bypass missing refs error
const SafeHelmet: React.FC<HelmetProps> = Helmet as any;

class OfficeHoursPage extends Component {
  render() {
    return (
      <div id="code-page">
        <SafeHelmet>
          <title>Office Hours | TA-Bot</title>
        </SafeHelmet>
        <MenuComponent
          showUpload={true}
          showAdminUpload={false}
          showHelp={false}
          showCreate={false}
          showLast={false}
          showReviewButton={false}
        />
        <OfficeHoursComponent question="Enter your question here" />
      </div>
    );
  }
}

const OfficeHoursPage = () => {
    let { id } = useParams<OfficeHoursProps>();
    console.log("This is the project id", id);

    return (
        <div>
            <Helmet>
                <title>[Admin] Students | TA-Bot</title>
            </Helmet>
            <MenuComponent showUpload={true} showAdminUpload={false} showHelp={false} showCreate={false} showLast={false} showReviewButton={false}></MenuComponent>
            <OfficeHoursComponent project_id={id} question="Enter your question here"></OfficeHoursComponent>
        </div>
    )
}


export default OfficeHoursPage;
