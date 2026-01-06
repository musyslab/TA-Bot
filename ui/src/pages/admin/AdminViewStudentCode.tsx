// ui/src/pages/admin/AdminViewStudentCode.tsx
import React from 'react'
import { useParams } from 'react-router-dom'
import { Helmet } from 'react-helmet'
import MenuComponent from '../components/MenuComponent'
import DirectoryBreadcrumbs from '../components/DirectoryBreadcrumbs'
import DiffView from '../components/CodeDiffView'

const defaultpagenumber = -1

export function AdminViewStudentCode() {
    const { id, class_id, project_id } = useParams<{ id: string; class_id: string; project_id: string }>()

    const submissionId = id !== undefined ? parseInt(id, 10) : defaultpagenumber
    const cid = class_id !== undefined ? parseInt(class_id, 10) : -1

    const classIdStr = class_id ?? ''
    const projectIdStr = project_id ?? ''

    return (
        <div className="page-container" id="admin-view-student-code">
            <Helmet>
                <title>TA-Bot</title>
            </Helmet>

            <MenuComponent
                showUpload={false}
                showAdminUpload={false}
                showHelp={false}
                showCreate={false}
                showLast={false}
                showReviewButton={false}
            />

            <DirectoryBreadcrumbs
                items={[
                    { label: 'Class Selection', to: '/admin/classes' },
                    { label: 'Project List', to: `/admin/${classIdStr}/projects` },
                    { label: 'Project Manage', to: `/admin/${classIdStr}/project/${projectIdStr}` },
                    { label: 'Code View' },
                ]}
            />

            <div className="pageTitle">Submission Output Viewer</div>

            <DiffView submissionId={submissionId} classId={cid} />
        </div>
    )
}

export default AdminViewStudentCode
