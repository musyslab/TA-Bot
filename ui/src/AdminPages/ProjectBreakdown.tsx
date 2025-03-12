import { Helmet } from "react-helmet";
import { useParams } from 'react-router-dom';
import 'semantic-ui-css/semantic.min.css';
import { Grid } from 'semantic-ui-react';
import MenuComponent from '../components/MenuComponent';
import StudentList from '../components/StudentList';
import '../css/AdminComponent.scss';
import React from 'react';
// Cast Helmet to `any` to avoid TypeScript issue
const SafeHelmet: any = Helmet;

interface ProjectBreakdownProps extends Record<string, string | undefined> {
    id: string;
}

const ProjectBreakdown = () => {
    let { id } = useParams<ProjectBreakdownProps>();
    var project_id = id ? parseInt(id) : 0;

    return (
        <div>
            <SafeHelmet>
                <title>[Admin] Students | TA-Bot</title>
            </SafeHelmet>
            <MenuComponent 
                showUpload={false} 
                showAdminUpload={true} 
                showHelp={false} 
                showCreate={false} 
                showLast={false} 
                showReviewButton={false} 
            />
            <Grid className="main-grid">
                <StudentList project_id={project_id} />
            </Grid>
        </div>
    );
};

export default ProjectBreakdown;
