import React, { Component } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import axios from 'axios';

import LoginPage from './pages/public/Login';
import HomePage from './pages/public/HomePage';
import NotFound from './pages/public/NotFound';

import StudentUpload from './pages/student/StudentUpload';
import StudentOutputDiff from './pages/student/StudentOutputDiff';
import StudentSchoolSelect from './pages/student/StudentSchoolSelect';
import StudentClassSelection from './pages/student/StudentClassSelection';
import StudentModuleList from './pages/student/StudentModuleList';
import StudentModuleDetails from './pages/student/StudentModuleDetails';
import StudentOfficeHours from './pages/student/StudentOfficeHours';
import StudentPastSubmissions from "./pages/student/StudentPastSubmissions";
import StudentPracticeSelect from './pages/student/StudentPracticeSelect';

import AdminSchoolSelect from './pages/admin/AdminSchoolSelect';
import AdminClassSelect from './pages/admin/AdminClassSelect';
import AdminGrading from './pages/admin/AdminGrading';
import AdminOfficeHours from './pages/admin/AdminOfficeHours';
import AdminPlagiarism from "./pages/admin/AdminPlagiarism";
import AdminModuleList from './pages/admin/AdminModuleList';
import AdminModuleDetails from './pages/admin/AdminModuleDetails';
import AdminProjectManage from './pages/admin/AdminProjectManage';
import AdminPracticeSelect from './pages/admin/AdminPracticeSelect';
import AdminStudentList from './pages/admin/AdminStudentList';
import AdminUpload from './pages/admin/AdminUpload';
import AdminViewStudentCode from './pages/admin/AdminViewStudentCode';

import ProtectedRoute from './pages/components/ProtectedRoute';

const ADMIN_SELECTED_SCHOOL_STORAGE_KEY = "ADMIN_SELECTED_SCHOOL";

const getStoredAdminSchoolId = (): string => {
    const storedValue = localStorage.getItem(ADMIN_SELECTED_SCHOOL_STORAGE_KEY);
    if (!storedValue) return "";

    try {
        const parsed = JSON.parse(storedValue) as { Id?: number };
        return parsed?.Id ? String(parsed.Id) : "";
    } catch {
        return "";
    }
};

const getLegacyClassIdFromPath = (): string => {
    const parts = window.location.pathname.split('/');
    return parts[2] || "";
};

const redirectToStoredSchoolClasses = () => {
    const schoolId = getStoredAdminSchoolId();
    return schoolId ? `/admin/school/${schoolId}/classes` : "/admin/schools";
};

const redirectLegacyClassRouteToModules = () => {
    const schoolId = getStoredAdminSchoolId();
    const classId = getLegacyClassIdFromPath();

    if (!schoolId || !classId) return "/admin/schools";
    return `/admin/school/${schoolId}/class/${classId}/modules`;
};

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

                    <Route path="/" element={<HomePage />} />

                    <Route path="/admin/schools" element={
                        <ProtectedRoute>
                            <AdminSchoolSelect />
                        </ProtectedRoute>
                    } />
                    <Route path="/admin/classes" element={
                        <ProtectedRoute>
                            <Navigate to={redirectToStoredSchoolClasses()} replace />
                        </ProtectedRoute>
                    } />
                    <Route path="/admin/school/:school_id/classes" element={
                        <ProtectedRoute>
                            <AdminClassSelect />
                        </ProtectedRoute>
                    } />
                    <Route path="/admin/school/:school_id/class/:class_id/modules/*" element={
                        <ProtectedRoute>
                            <AdminModuleList />
                        </ProtectedRoute>
                    } />

                    <Route path="/admin/school/:school_id/class/:class_id/module/:module_id/overview" element={
                        <ProtectedRoute>
                            <AdminModuleDetails />
                        </ProtectedRoute>
                    } />

                    <Route path="/admin/school/:school_id/class/:class_id/module/:module_id/project/:id/overview" element={
                        <ProtectedRoute>
                            <Navigate to="../../overview" replace />
                        </ProtectedRoute>
                    } />
                    <Route path="/admin/school/:school_id/class/:class_id/module/:module_id/project/:id/submissions" element={
                        <ProtectedRoute>
                            <AdminStudentList />
                        </ProtectedRoute>
                    } />
                    <Route path="/admin/school/:school_id/class/:class_id/module/:module_id/project/:id/manage" element={
                        <ProtectedRoute>
                            <AdminProjectManage />
                        </ProtectedRoute>
                    } />

                    <Route path="/admin/school/:school_id/class/:class_id/module/:module_id/project/:id/practice/:practice_problem_id/submissions" element={
                        <ProtectedRoute>
                            <AdminStudentList />
                        </ProtectedRoute>
                    } />
                    <Route path="/admin/school/:school_id/class/:class_id/module/:module_id/project/:id/practice/:practice_problem_id/manage" element={
                        <ProtectedRoute>
                            <AdminProjectManage practiceMode />
                        </ProtectedRoute>
                    } />
                    <Route path="/admin/school/:school_id/class/:class_id/module/:module_id/project/:id/practice/select" element={
                        <ProtectedRoute>
                            <AdminPracticeSelect />
                        </ProtectedRoute>
                    } />

                    <Route path="/admin/school/:school_id/class/:class_id/module/:module_id/project/:project_id/grade/:id" element={
                        <ProtectedRoute>
                            <AdminGrading />
                        </ProtectedRoute>
                    } />
                    <Route path="/admin/school/:school_id/class/:class_id/module/:module_id/project/:project_id/codeview/:id" element={
                        <ProtectedRoute>
                            <AdminViewStudentCode />
                        </ProtectedRoute>
                    } />

                    <Route path="/admin/:id/modules/*" element={
                        <ProtectedRoute>
                            <Navigate to={redirectLegacyClassRouteToModules()} replace />
                        </ProtectedRoute>
                    } />
                    <Route path="/admin/:class_id/module/:module_id/overview" element={
                        <ProtectedRoute>
                            <Navigate to={redirectLegacyClassRouteToModules()} replace />
                        </ProtectedRoute>
                    } />
                    <Route path="/admin/:class_id/module/:module_id/project/:id/overview" element={
                        <ProtectedRoute>
                            <Navigate to={redirectLegacyClassRouteToModules()} replace />
                        </ProtectedRoute>
                    } />
                    <Route path="/admin/:class_id/module/:module_id/project/:id/submissions" element={
                        <ProtectedRoute>
                            <Navigate to={redirectLegacyClassRouteToModules()} replace />
                        </ProtectedRoute>
                    } />
                    <Route path="/admin/:class_id/module/:module_id/project/:id/manage" element={
                        <ProtectedRoute>
                            <Navigate to={redirectLegacyClassRouteToModules()} replace />
                        </ProtectedRoute>
                    } />
                    <Route path="/admin/:class_id/module/:module_id/project/:id/practice/:practice_problem_id/submissions" element={
                        <ProtectedRoute>
                            <Navigate to={redirectLegacyClassRouteToModules()} replace />
                        </ProtectedRoute>
                    } />
                    <Route path="/admin/:class_id/module/:module_id/project/:id/practice/:practice_problem_id/manage" element={
                        <ProtectedRoute>
                            <Navigate to={redirectLegacyClassRouteToModules()} replace />
                        </ProtectedRoute>
                    } />
                    <Route path="/admin/:class_id/module/:module_id/project/:id/practice/select" element={
                        <ProtectedRoute>
                            <Navigate to={redirectLegacyClassRouteToModules()} replace />
                        </ProtectedRoute>
                    } />
                    <Route path="/admin/:class_id/module/:module_id/project/:project_id/grade/:id" element={
                        <ProtectedRoute>
                            <Navigate to={redirectLegacyClassRouteToModules()} replace />
                        </ProtectedRoute>
                    } />
                    <Route path="/admin/:class_id/module/:module_id/project/:project_id/codeview/:id" element={
                        <ProtectedRoute>
                            <Navigate to={redirectLegacyClassRouteToModules()} replace />
                        </ProtectedRoute>
                    } />

                    <Route path="/admin/:class_id/project/:id/overview" element={
                        <ProtectedRoute>
                            <Navigate to={redirectLegacyClassRouteToModules()} replace />
                        </ProtectedRoute>
                    } />
                    <Route path="/admin/:class_id/project/:id" element={
                        <ProtectedRoute>
                            <Navigate to={redirectLegacyClassRouteToModules()} replace />
                        </ProtectedRoute>
                    } />
                    <Route path="/admin/:class_id/project/:id/manage" element={
                        <ProtectedRoute>
                            <Navigate to={redirectLegacyClassRouteToModules()} replace />
                        </ProtectedRoute>
                    } />
                    <Route path="/admin/:class_id/project/:id/practice/:practice_problem_id" element={
                        <ProtectedRoute>
                            <Navigate to={redirectLegacyClassRouteToModules()} replace />
                        </ProtectedRoute>
                    } />
                    <Route path="/admin/:class_id/project/:id/practice/select" element={
                        <ProtectedRoute>
                            <Navigate to={redirectLegacyClassRouteToModules()} replace />
                        </ProtectedRoute>
                    } />
                    <Route path="/admin/:class_id/project/:project_id/grade/:id" element={
                        <ProtectedRoute>
                            <Navigate to={redirectLegacyClassRouteToModules()} replace />
                        </ProtectedRoute>
                    } />
                    <Route path="/admin/:class_id/project/:project_id/codeview/:id" element={
                        <ProtectedRoute>
                            <Navigate to={redirectLegacyClassRouteToModules()} replace />
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

                    <Route path="/student/schools" element={
                        <ProtectedRoute>
                            <StudentSchoolSelect />
                        </ProtectedRoute>
                    } />
                    <Route path="/student/classes" element={
                        <ProtectedRoute>
                            <Navigate to="/student/schools" replace />
                        </ProtectedRoute>
                    } />
                    <Route path="/student/school/:school_id/classes" element={
                        <ProtectedRoute>
                            <StudentClassSelection />
                        </ProtectedRoute>
                    } />
                    <Route path="/student/school/:school_id/class/:class_id/modules/*" element={
                        <ProtectedRoute>
                            <StudentModuleList />
                        </ProtectedRoute>
                    } />
                    <Route path="/student/school/:school_id/class/:class_id/module/:module_id" element={
                        <ProtectedRoute>
                            <StudentModuleDetails />
                        </ProtectedRoute>
                    } />
                    <Route path="/student/school/:school_id/class/:class_id/module/:module_id/project/:project_id/upload" element={
                        <ProtectedRoute>
                            <StudentUpload />
                        </ProtectedRoute>
                    } />
                    <Route path="/student/school/:school_id/class/:class_id/module/:module_id/project/:project_id/practice/select" element={
                        <ProtectedRoute>
                            <StudentPracticeSelect />
                        </ProtectedRoute>
                    } />
                    <Route path="/student/school/:school_id/class/:class_id/module/:module_id/project/:project_id/practice/:practice_problem_id/upload" element={
                        <ProtectedRoute>
                            <StudentUpload />
                        </ProtectedRoute>
                    } />
                    <Route path="/student/:class_id/upload" element={
                        <ProtectedRoute>
                            <StudentUpload />
                        </ProtectedRoute>
                    } />
                    <Route path="/student/:class_id/practice" element={
                        <ProtectedRoute>
                            <StudentPracticeSelect />
                        </ProtectedRoute>
                    } />
                    <Route path="/student/:class_id/practice/:practice_problem_id/upload" element={
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
                    <Route path="/student/:class_id/OfficeHours" element={
                        <ProtectedRoute>
                            <StudentOfficeHours />
                        </ProtectedRoute>
                    } />
                    <Route path="*" element={<NotFound />} />
                </Routes>
            </BrowserRouter>
        );
    }
}

export default App;