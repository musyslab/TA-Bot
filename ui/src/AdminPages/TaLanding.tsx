import { Component } from 'react';
import MenuComponent from '../components/MenuComponent';
import '../css/AdminComponent.scss';
import { Helmet } from 'react-helmet';
import TaLandingComponent from '../components/TaLandingComponent';

class TaLanding extends Component<{}, {}> {
    render() {
        return (
            <div>
                <Helmet>
                    <title>[Admin] Projects | TA-Bot</title>
                </Helmet>
                <MenuComponent
                    showUpload={false}
                    showAdminUpload={false}
                    showHelp={false}
                    showCreate={false}
                    showLast={false}
                    showReviewButton={false}
                />
                <div className="main-grid">
                    <TaLandingComponent />
                </div>
            </div>
        );
    }
}

export default TaLanding;
