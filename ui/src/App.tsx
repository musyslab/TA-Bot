import React, { Component } from 'react';
import 'semantic-ui-css/semantic.min.css'
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import LoginPage from './pages/Login';
import LandingPage from './pages/Landing';
import UploadPage from './pages/UploadPage';
import ProtectedRoute from './components/ProtectedRoute';
import PastSubmissionPage from "./components/PastSubmissionPage";
import { CodePage } from './pages/CodeViews';
import AdminLanding from './AdminPages/AdminLanding';
import ProjectBreakdown from './AdminPages/ProjectBreakdown';
import axios from 'axios';
import NotFoundComponent from './components/NotFoundComponent';
import AdminUpload from './AdminPages/AdminUpload';
import AdminSettingsPage from './AdminPages/AdminSettingsPage';
import ClassSelectionPage from './pages/ClassSelectionPage';
import AdminProjectConfig from './AdminPages/AdminProjectConfig';
import AdminProject from './AdminPages/AdminProject';
import CreateAccountPage from './pages/AccountCreationPage';
import TaLanding from './AdminPages/TaLanding';
import OfficeHoursPage from './pages/OfficeHoursPage';
import ProjectAnalytics from './AdminPages/ProjectAnalitics';
import ForumPage from './pages/ForumPage';

class App extends Component {

    render() {
        axios.interceptors.response.use(
            function (successRes) {
                return successRes;
            },
            function (error) {
                if (error.response && (error.response.status === 401 || error.response.status === 422 || error.response.status === 419)) {
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

                    <Route path="/submissions" element={
                        <ProtectedRoute>
                            <PastSubmissionPage />
                        </ProtectedRoute>
                    } />
                    <Route path="/class/:class_id/upload" element={
                        <ProtectedRoute>
                            <UploadPage />
                        </ProtectedRoute>
                    } />
                    <Route path="/class/:class_id/code/:id?" element={
                        <ProtectedRoute>
                            <CodePage />
                        </ProtectedRoute>
                    } />
                    <Route path="/class/classes" element={
                        <ProtectedRoute>
                            <ClassSelectionPage />
                        </ProtectedRoute>
                    } />
                    <Route path="/admin/classes" element={
                        <ProtectedRoute>
                            <AdminLanding />
                        </ProtectedRoute>
                    } />
                    <Route path="/admin/TaLanding" element={
                        <ProtectedRoute>
                            <TaLanding />
                        </ProtectedRoute>
                    } />
                    <Route path="/admin/projects/:id/*" element={
                        <ProtectedRoute>
                            <AdminProject />
                        </ProtectedRoute>
                    } />
                    <Route path="/admin/project/:id" element={
                        <ProtectedRoute>
                            <ProjectBreakdown />
                        </ProtectedRoute>
                    } />
                    <Route path="/admin/upload" element={
                        <ProtectedRoute>
                            <AdminUpload />
                        </ProtectedRoute>
                    } />
                    <Route path="/admin/settings" element={
                        <ProtectedRoute>
                            <AdminSettingsPage />
                        </ProtectedRoute>
                    } />
                    <Route path="/admin/project/edit/:class_id/:id" element={
                        <ProtectedRoute>
                            <AdminProjectConfig />
                        </ProtectedRoute>
                    } />
                    <Route path="/class/OfficeHours/:id" element={
                        <ProtectedRoute>
                            <OfficeHoursPage />
                        </ProtectedRoute>
                    } />
                    <Route path="/user/createAccount" element={
                        <ProtectedRoute>
                            <CreateAccountPage />
                        </ProtectedRoute>
                    } />
                    <Route path="/admin/AdminAnalytics/:id" element={
                        <ProtectedRoute>
                            <ProjectAnalytics />
                        </ProtectedRoute>
                    } />
                    <Route path="/class/:class_id/forum" element={
                        <ProtectedRoute>
                            <ForumPage />
                        </ProtectedRoute>
                    } />
                    {/* Catch-all for 404 */}
                    <Route path="*" element={<NotFoundComponent />} />
                </Routes>
            </BrowserRouter>
        );
    }
}

export default App;