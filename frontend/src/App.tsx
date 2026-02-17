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
import AdminGrading from './pages/admin/AdminGrading';
import AdminOfficeHours from './pages/admin/AdminOfficeHours';
import AdminPlagiarism from "./pages/admin/AdminPlagiarism";
import AdminProjectList from './pages/admin/AdminProjectList';
import AdminProjectManage from './pages/admin/AdminProjectManage';
import AdminPracticeProblemsManage from './pages/admin/AdminPracticeProblemsManage';
import AdminStudentRoster from './pages/admin/AdminStudentRoster';
import AdminUpload from './pages/admin/AdminUpload';
import AdminViewStudentCode from './pages/admin/AdminViewStudentCode';

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
                    <Route path="/admin/classes" element={
                        <ProtectedRoute>
                            <AdminClassSelection />
                        </ProtectedRoute>
                    } />
                    <Route path="/admin/:id/projects/*" element={
                        <ProtectedRoute>
                            <AdminProjectList />
                        </ProtectedRoute>
                    } />
                    <Route path="/admin/:class_id/project/:id" element={
                        <ProtectedRoute>
                            <AdminStudentRoster />
                        </ProtectedRoute>
                    } />
                    <Route path="/admin/:class_id/project/manage/:id" element={
                        <ProtectedRoute>
                            <AdminProjectManage />
                        </ProtectedRoute>
                    } />

                    <Route path="/admin/:class_id/project/:id/practice" element={
                        <ProtectedRoute>
                            <AdminPracticeProblemsManage />
                        </ProtectedRoute>
                    } />

                    <Route path="/admin/:class_id/project/:project_id/grade/:id" element={
                        <ProtectedRoute>
                            <AdminGrading />
                        </ProtectedRoute>
                    } />
                    <Route path="/admin/:class_id/project/:project_id/codeview/:id" element={
                        <ProtectedRoute>
                            <AdminViewStudentCode />
                        </ProtectedRoute>
                    } />
                    <Route path="/admin/plagiarism" element={
                        <ProtectedRoute>
                            <AdminPlagiarism />
                        </ProtectedRoute>
                    } />
                    <Route path="/admin/OfficeHours" element={
                        <ProtectedRoute>
                            <AdminOfficeHours />
                        </ProtectedRoute>
                    } />
                    <Route path="/admin/upload" element={
                        <ProtectedRoute>
                            <AdminUpload />
                        </ProtectedRoute>
                    } />

                    <Route path="/student/classes" element={
                        <ProtectedRoute>
                            <StudentClassSelection />
                        </ProtectedRoute>
                    } />
                    <Route path="/student/:class_id/upload" element={
                        <ProtectedRoute>
                            <StudentUpload />
                        </ProtectedRoute>
                    } />
                    <Route path="/student/:class_id/code/:id?" element={
                        <ProtectedRoute>
                            <StudentOutputDiff />
                        </ProtectedRoute>
                    } />
                    <Route path="/student/PastSubmissions" element={
                        <ProtectedRoute>
                            <StudentPastSubmissions />
                        </ProtectedRoute>
                    } />
                    <Route path="/student/:id/OfficeHours" element={
                        <ProtectedRoute>
                            <StudentOfficeHours />
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