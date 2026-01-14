// ui/src/pages/student/StudentOutputDiff.tsx
import React from 'react'
import { useParams } from 'react-router-dom'
import { Helmet } from 'react-helmet'
import MenuComponent from '../components/MenuComponent'
import DirectoryBreadcrumbs from '../components/DirectoryBreadcrumbs'
import DiffView from '../components/CodeDiffView'

const defaultpagenumber = -1

export function StudentOutputDiff() {
    const { id, class_id } = useParams<{ id: string; class_id: string }>()

    const submissionId = id !== undefined ? parseInt(id, 10) : defaultpagenumber
    const cid = class_id !== undefined ? parseInt(class_id, 10) : -1
    const classIdStr = class_id ?? ''

    return (
        <div className="page-container" id="student-output-diff">
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
                    { label: 'Class Selection', to: '/student/classes' },
                    { label: 'Project Upload', to: `/student/${classIdStr}/upload` },
                    { label: 'Code View' },
                ]}
            />

            <div className="pageTitle">Your Program Output Results</div>

            <DiffView submissionId={submissionId} classId={cid} disableCopy />
        </div>
    )
}

export default StudentOutputDiff