import { Helmet } from 'react-helmet';
import { useParams } from 'react-router-dom';
import MenuComponent from '../components/MenuComponent';
import StudentList from '../components/StudentList';
import '../css/AdminComponent.scss';

const ProjectBreakdown = () => {
    const { id } = useParams<{ id: string }>();

    if (!id) {
        return <div>Error: project id missing or invalid</div>;
    }

    const project_id = parseInt(id, 10);

    return (
        <div>
            <Helmet>
                <title>[Admin] Students | TA-Bot</title>
            </Helmet>
            <MenuComponent 
                showUpload={false} 
                showAdminUpload={true} 
                showHelp={false} 
                showCreate={false} 
                showLast={false} 
                showReviewButton={false} 
            />
            <div className="main-grid">
                <StudentList project_id={project_id} />
            </div>
        </div>
    );
};

export default ProjectBreakdown;