import 'semantic-ui-css/semantic.min.css'
import MenuComponent from '../components/MenuComponent'
import AdminProjectConfigComponent from '../components/AdminProjectConfigComponent'
import { Helmet } from 'react-helmet'
import { useParams } from 'react-router-dom'

const AdminProjectConfig = () => {

    const { id, class_id } = useParams();
    const project_id = Number(id);
    const classId = Number(class_id);
    if (Number.isNaN(project_id) || Number.isNaN(classId)) {
        return <div>Error: Missing or invalid project or class ID.</div>;
    }

    return (
        <div style={{ height: "100%" }}>
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
            />
            <div style={{ height: "100%" }} className="main-grid">
                <AdminProjectConfigComponent id={project_id} class_id={classId} />
            </div>
        </div>
    );
}

export default AdminProjectConfig;