import { useParams } from 'react-router-dom'
import OfficeHoursComponent from '../components/OfficeHoursComponent';
import { Helmet } from 'react-helmet';
import MenuComponent from '../components/MenuComponent';

const OfficeHoursPage = () => {
    const { id } = useParams<{ id: string }>();

    const projectId = id || "";

    console.log("This is the project id", projectId);

    return (
        <div>
            <Helmet>
                <title> Office Hours | TA-Bot</title>
            </Helmet>
            <MenuComponent
                showUpload={true}
                showAdminUpload={false}
                showHelp={false}
                showCreate={false}
                showLast={false}
                showReviewButton={false}
            />
            <OfficeHoursComponent
                project_id={projectId}
                question="Enter your question here"
            />
        </div>
    );
}

export default OfficeHoursPage;