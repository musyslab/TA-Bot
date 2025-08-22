import { Component } from 'react';
import 'semantic-ui-css/semantic.min.css'
import MenuComponent from '../components/MenuComponent';
import '../css/AdminComponent.scss'
import { Helmet } from 'react-helmet';
import AdminLandingComponent from '../components/AdminLandingComponent';

class AdminLanding extends Component<{}, {}> {

    render() {
        return (
            <div className="admin-landing-root">
                <Helmet>
                    <title>[Admin] Projects | TA-Bot</title>
                </Helmet>
                <MenuComponent showUpload={false} showAdminUpload={false} showHelp={false} showCreate={false} showLast={false} showReviewButton={false} ></MenuComponent>
                <AdminLandingComponent></AdminLandingComponent>
            </div>
        );
    }
}

export default AdminLanding;