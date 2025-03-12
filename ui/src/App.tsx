import React, { Component } from 'react';
import 'semantic-ui-css/semantic.min.css'
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import LoginPage from './pages/Login';
import LandingPage from './pages/Landing';
import UploadPage from './pages/UploadPage';
import ProtectedRoute from './components/ProtectedRoute';
import PastSubmissionPage from "./components/PastSubmissionPage";
import CodePage from './pages/CodePage';
import AdminLanding from './AdminPages/AdminLanding';
import ProjectBreakdown from './AdminPages/ProjectBreakdown';
import axios from 'axios';
import NotFoundComponent from './components/NotFoundComponent';
import AdminUpload from './AdminPages/AdminUpload';
import AdminSettingsPage from './AdminPages/AdminSettingsPage';
import ClassSelectionPage from './pages/ClassSelectionPage';
import AdminProjectConfig from './AdminPages/AdminProjectConfig';

import CodeHelpPage from './pages/CodeHelpPage';

import AdminProject from './AdminPages/AdminProject';

import CreateAccountPage from './pages/AccountCreationPage';
import TaLanding from './AdminPages/TaLanding';
import OfficeHoursPage from './pages/OfficeHoursPage';

class App extends Component {

  render() {
    axios.interceptors.response.use(
        function(successRes) {
            return successRes;
        }, 
        function(error) {
            if(error.response && (error.response.status === 401 || error.response.status === 422 || error.response.status === 419)) {
                localStorage.removeItem("AUTOTA_AUTH_TOKEN");
                window.location.href = "/login";
            }
            return Promise.reject(error);
    });

    return (
        <BrowserRouter>
            <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/" element={<LandingPage />} />
                <Route element={<ProtectedRoute />}>
                <Route path="/submissions" element={<PastSubmissionPage />} />
                <Route path="/class/:class_id/upload" element={<UploadPage />} />
                <Route path="/class/:class_id/code/:id?" element={<CodePage />} />
                <Route path="/class/classes" element={<ClassSelectionPage />} />
                <Route path="/admin/classes" element={<AdminLanding />} />
                <Route path="/admin/TaLanding" element={<TaLanding />} />
                <Route path="/admin/projects/:id" element={<AdminProject />} />
                <Route path="/admin/project/:id" element={<ProjectBreakdown />} />
                <Route path="/admin/upload" element={<AdminUpload />} />
                <Route path="/admin/settings" element={<AdminSettingsPage />} />
                <Route path="/admin/project/edit/:class_id/:id" element={<AdminProjectConfig />} />
                <Route path="/class/:class_id/codeHelp" element={<CodeHelpPage />} />
                <Route path="/class/OfficeHours" element={<OfficeHoursPage />} />
                <Route path="/user/createAccount" element={<CreateAccountPage />} />
                </Route>
                <Route path="*" element={<NotFoundComponent />} />
            </Routes>
        </BrowserRouter>

    );
  }
}

export default App;
