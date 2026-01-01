import React, { Component } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import axios from 'axios';

import LoginPage from './pages/public/Login';
import LandingPage from './pages/public/Landing';
import NotFound from './pages/public/NotFound';

import StudentUpload from './pages/student/StudentUpload';
import StudentOutputDiff from './pages/student/StudentOutputDiff';
import StudentClassSelection from './pages/student/StudentClassSelection';
import StudentOfficeHours from './pages/student/StudentOfficeHours';
import StudentPastSubmissions from "./pages/student/StudentPastSubmissions";

import AdminClassSelection from './pages/admin/AdminClassSelection';
import AdminOfficeHours from './pages/admin/AdminOfficeHours';
import AdminPlagiarism from "./pages/admin/AdminPlagiarism";
import AdminProjectList from './pages/admin/AdminProjectList';
import AdminProjectManage from './pages/admin/AdminProjectManage';
import AdminStudentRoster from './pages/admin/AdminStudentRoster';
import AdminUpload from './pages/admin/AdminUpload';

import ProtectedRoute from './pages/components/ProtectedRoute';

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
                            <StudentPastSubmissions />
                        </ProtectedRoute>
                    } />
                    <Route path="/class/:class_id/upload" element={
                        <ProtectedRoute>
                            <StudentUpload />
                        </ProtectedRoute>
                    } />
                    <Route path="/class/:class_id/code/:id?" element={
                        <ProtectedRoute>
                            <StudentOutputDiff />
                        </ProtectedRoute>
                    } />
                    <Route path="/class/classes" element={
                        <ProtectedRoute>
                            <StudentClassSelection />
                        </ProtectedRoute>
                    } />
                    <Route path="/admin/classes" element={
                        <ProtectedRoute>
                            <AdminClassSelection />
                        </ProtectedRoute>
                    } />
                    <Route path="/admin/projects/:id/*" element={
                        <ProtectedRoute>
                            <AdminProjectList />
                        </ProtectedRoute>
                    } />
                    <Route path="/admin/project/:class_id/:id" element={
                        <ProtectedRoute>
                            <AdminStudentRoster />
                        </ProtectedRoute>
                    } />
                    <Route path="/admin/upload" element={
                        <ProtectedRoute>
                            <AdminUpload />
                        </ProtectedRoute>
                    } />
                    <Route path="/admin/project/edit/:class_id/:id" element={
                        <ProtectedRoute>
                            <AdminProjectManage />
                        </ProtectedRoute>
                    } />
                    <Route path="/class/OfficeHours/:id" element={
                        <ProtectedRoute>
                            <StudentOfficeHours />
                        </ProtectedRoute>
                    } />
                    <Route path="/admin/OfficeHours" element={
                        <ProtectedRoute>
                            <AdminOfficeHours />
                        </ProtectedRoute>
                    } />
                    <Route path="/plagiarism/compare" element={
                        <ProtectedRoute>
                            <AdminPlagiarism />
                        </ProtectedRoute>
                    } />
                    {/* Catch-all for 404 */}
                    <Route path="*" element={<NotFound />} />
                </Routes>
            </BrowserRouter>
        );
    }
}

export default App;