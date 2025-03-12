import { Component } from 'react';
import 'semantic-ui-css/semantic.min.css';
import { Grid } from 'semantic-ui-react';
import MenuComponent from '../components/MenuComponent';
import AdminSettingsPageComponent from '../components/AdminSettingsPageComponent';
import { Helmet } from "react-helmet";
import React from 'react';

// Cast Helmet to `any` to avoid TypeScript issue
const SafeHelmet: any = Helmet;

class AdminSettingsPage extends Component<{}, {}> {

    render() {
        return (
        <div>
            <SafeHelmet>
                <title>[Admin] Projects | TA-Bot</title>
            </SafeHelmet>
            <MenuComponent 
                showUpload={true} 
                showAdminUpload={true} 
                showHelp={false} 
                showCreate={false} 
                showLast={false} 
                showReviewButton={false} 
            />
            <Grid className="main-grid">
                <AdminSettingsPageComponent />
            </Grid>
        </div>
        );
    }
}

export default AdminSettingsPage;
