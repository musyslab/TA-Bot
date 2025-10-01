import { Component } from 'react'
import 'semantic-ui-css/semantic.min.css'
import { Grid } from 'semantic-ui-react'
import MenuComponent from '../components/MenuComponent'
import '../css/AdminComponent.scss'
import { Helmet } from 'react-helmet'
import AdminComponent from '../components/AdminComponent'
import { Routes, Route } from 'react-router-dom'

class AdminProject extends Component<{}, {}> {
    render() {
        return (
            <div>
                <div>hi</div>
                <Helmet>
                    <title>[Admin] TA-Bot</title>
                </Helmet>
                <MenuComponent
                    showUpload={false}
                    showAdminUpload={true}
                    showHelp={false}
                    showCreate={false}
                    showLast={false}
                    showReviewButton={false}
                    showAdminForum={true}
                />
                <Grid className="main-grid">
                    <Routes>
                        <Route index element={<AdminComponent />} />
                    </Routes>
                </Grid>
            </div>
        );
    }
}

export default AdminProject;