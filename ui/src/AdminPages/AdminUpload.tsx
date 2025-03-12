import { Component } from 'react';
import 'semantic-ui-css/semantic.min.css';
import { Grid } from 'semantic-ui-react';
import MenuComponent from '../components/MenuComponent';
import '../css/AdminComponent.scss';
import { Helmet } from "react-helmet";
import AdminUploadPage from '../components/AdminUploadPage';
import React from 'react';

// Cast Helmet to `any` to avoid TypeScript issue
const SafeHelmet: any = Helmet;

class AdminUpload extends Component<{}, {}> {

    render() {
        return (
        <div>
            <SafeHelmet>
                <title>[Admin] Student Upload | TA-Bot</title>
            </SafeHelmet>
            <MenuComponent 
                showUpload={true} 
                showAdminUpload={true} 
                showHelp={false} 
                showCreate={false} 
                showLast={false} 
                showReviewButton={false} 
            />
            <Grid textAlign='center' style={{ height: '100vh' }} verticalAlign='middle' className="main-grid">
                <AdminUploadPage />
            </Grid>
        </div>
        );
    }
}

export default AdminUpload;
