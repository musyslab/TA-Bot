
import 'semantic-ui-css/semantic.min.css'
import MenuComponent from '../components/MenuComponent';
import AdminProjectConfigComponent from '../components/AdminProjectConfigComponent';
import { Helmet } from "react-helmet-async";
import { useParams } from 'react-router-dom';

interface AdminProjectConfigProps extends Record<string, string | undefined> {
    id: string
    class_id : string  
}

const AdminProjectConfig = () => {

    let { class_id, id } = useParams<AdminProjectConfigProps>();
    var project_id = parseInt(id || '0');
    var classId = parseInt(class_id || '0');

   return (
        <div style={{height: "100%"}}>
            <Helmet>
                <title>[Admin] Projects | TA-Bot</title>
            </Helmet>
            <MenuComponent showUpload={false} showAdminUpload={true} showHelp={false} showCreate={false} showLast={false} showReviewButton={false} ></MenuComponent>
            <div style={{height: "100%"}} className="main-grid">
                <AdminProjectConfigComponent id={project_id} class_id={classId}  ></AdminProjectConfigComponent>
            </div>
        </div>
   )
}

export default AdminProjectConfig;