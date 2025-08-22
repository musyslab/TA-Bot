import 'semantic-ui-css/semantic.min.css'
import MenuComponent from '../components/MenuComponent';
import AdminProjectConfigComponent from '../components/AdminProjectConfigComponent';
import { Helmet } from 'react-helmet';
import { useParams } from 'react-router-dom';

const AdminProjectConfig = () => {
    const params = useParams();

    if (params.id === undefined || params.class_id === undefined) {
        return <div>Error: Missing project or class ID.</div>;
    }

    const project_id = parseInt(params.id, 10);
    const classId = parseInt(params.class_id, 10);

    return (
        <div style={{ height: "100%" }}>
            <Helmet>
                <title>[Admin] Projects | TA-Bot</title>
            </Helmet>
            <MenuComponent showUpload={false} showAdminUpload={true} showHelp={false} showCreate={false} showLast={false} showReviewButton={false} />
            <div style={{ height: "100%" }} className="main-grid">
                <AdminProjectConfigComponent id={project_id} class_id={classId} />
            </div>
        </div>
    );
}

export default AdminProjectConfig;