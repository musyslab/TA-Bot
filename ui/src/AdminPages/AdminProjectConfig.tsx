import 'semantic-ui-css/semantic.min.css';
import MenuComponent from '../components/MenuComponent';
import AdminProjectConfigComponent from '../components/AdminProjectConfigComponent';
import { Helmet } from "react-helmet";
import { useParams } from 'react-router-dom';
import React from 'react';

// Cast Helmet to `any` to avoid TypeScript issue
const SafeHelmet: any = Helmet;

interface AdminProjectConfigProps extends Record<string, string | undefined> {
    id: string;
    class_id: string;  
}

const AdminProjectConfig = () => {

    let { class_id, id } = useParams<AdminProjectConfigProps>();
    var project_id = parseInt(id || '0');
    var classId = parseInt(class_id || '0');

   return (
        <div style={{height: "100%"}}>
            <SafeHelmet>
                <title>[Admin] Projects | TA-Bot</title>
            </SafeHelmet>
            <MenuComponent 
                showUpload={false} 
                showAdminUpload={true} 
                showHelp={false} 
                showCreate={false} 
                showLast={false} 
                showReviewButton={false} 
            />
            <div style={{height: "100%"}} className="main-grid">
                <AdminProjectConfigComponent id={project_id} class_id={classId} />
            </div>
        </div>
   );
};

export default AdminProjectConfig;
