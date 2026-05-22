// frontend/src/pages/admin/AdminViewStudentCode.tsx
import React, { useEffect, useState } from 'react'
import axios from 'axios'
import { useLocation, useParams } from 'react-router-dom'
import { Helmet } from 'react-helmet'
import MenuComponent from '../components/MenuComponent'
import DirectoryBreadcrumbs from '../components/DirectoryBreadcrumbs'
import DiffView from '../components/CodeDiffView'

const defaultpagenumber = -1

export function AdminViewStudentCode() {

    const { search } = useLocation()
    const { id, school_id, class_id, module_id, project_id, checkpoint_id: route_checkpoint_id } = useParams<{
        id?: string
        school_id?: string
        class_id?: string
        module_id?: string
        project_id?: string
        checkpoint_id?: string
    }>()

    const submissionId = id !== undefined ? parseInt(id, 10) : defaultpagenumber
    const cid = class_id !== undefined ? parseInt(class_id, 10) : -1
    const pid = project_id !== undefined ? parseInt(project_id, 10) : -1

    const [studentName, setStudentName] = useState<string>('')
    const [projectDisplayName, setProjectDisplayName] = useState<string>('')

    const params = new URLSearchParams(search)
    const fromParam = (params.get('from') || '').toLowerCase()
    const fromOfficeHours = fromParam === 'office-hours'
    const fromAdminUpload = fromParam === 'admin-upload'
    const fromAnalytics = fromParam === 'analytics' || fromParam === 'analytics-dashboard'
    const truthyValues = ['1', 'true', 'yes', 'y', 'on']
    const checkpointParam = (params.get('checkpoint') || params.get('practice') || '').toLowerCase()
    const isCheckpoint = !!route_checkpoint_id || truthyValues.includes(checkpointParam)

    const checkpointIdParam = (
        route_checkpoint_id ||
        params.get('checkpoint_id') ||
        params.get('practice_problem_id') ||
        ''
    ).trim()
    const parsedCheckpointId = parseInt(checkpointIdParam, 10)
    const checkpointId =
        isCheckpoint && !Number.isNaN(parsedCheckpointId) && parsedCheckpointId > 0 ? parsedCheckpointId : undefined

    const schoolIdStr = school_id ?? ''
    const classIdStr = class_id ?? ''
    const moduleIdStr = module_id ?? ''
    const projectIdStr = project_id ?? ''

    const hasClassDirectoryPath = !!schoolIdStr && !!classIdStr
    const hasFullDirectoryPath = !!schoolIdStr && !!classIdStr && !!moduleIdStr && !!projectIdStr

    const classSelectionUrl = hasClassDirectoryPath ? `/admin/school/${schoolIdStr}/classes` : '/admin/schools'
    const adminMenuUrl = `/admin/school/${schoolIdStr}/class/${classIdStr}/menu`
    const adminUploadUrl = `/admin/school/${schoolIdStr}/class/${classIdStr}/upload`
    const analyticsDashboardUrl = `/admin/school/${schoolIdStr}/class/${classIdStr}/analytics`
    const moduleListUrl = `/admin/school/${schoolIdStr}/class/${classIdStr}/modules`
    const moduleDetailsUrl = `/admin/school/${schoolIdStr}/class/${classIdStr}/module/${moduleIdStr}/overview`
    const studentListUrl = isCheckpoint && checkpointId
        ? `/admin/school/${schoolIdStr}/class/${classIdStr}/module/${moduleIdStr}/project/${projectIdStr}/checkpoint/${checkpointId}/submissions`
        : `/admin/school/${schoolIdStr}/class/${classIdStr}/module/${moduleIdStr}/project/${projectIdStr}/submissions`

    useEffect(() => {
        if (submissionId < 0 || pid < 0) return
        axios
            .post(
                `${import.meta.env.VITE_API_URL}/submissions/recentsubproject`,
                {
                    project_id: pid,
                    checkpoint: isCheckpoint,
                    checkpoint_id: checkpointId ?? null,
                },
                {
                    headers: {
                        Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}`,
                    },
                }
            )
            .then((res) => {
                const data = res.data
                const entry = Object.entries(data).find(
                    ([_, value]) => parseInt((value as Array<string>)[7], 10) === submissionId
                )
                if (entry) {
                    const studentData = entry[1] as Array<string>
                    setStudentName(`${studentData[1]} ${studentData[0]}`)
                }
            })
            .catch((err) => console.log(err))
    }, [submissionId, pid, isCheckpoint, checkpointId])

    useEffect(() => {
        if (pid < 0) return
        axios
            .get(
                `${import.meta.env.VITE_API_URL}/projects/get_project_id?id=${pid}${isCheckpoint && checkpointId ? `&checkpoint_id=${checkpointId}` : ''
                }`,
                {
                    headers: {
                        Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}`,
                    },
                }
            )
            .then((res) => {
                try {
                    const parsed =
                        typeof res.data === 'string'
                            ? JSON.parse(res.data || '{}')
                            : res.data || {}

                    const firstEntry = Object.values(parsed as Record<string, any>)[0]

                    if (Array.isArray(firstEntry)) {
                        setProjectDisplayName(String(firstEntry[0] ?? firstEntry[1] ?? '').trim())
                    } else {
                        setProjectDisplayName(String((parsed as any)?.Name ?? '').trim())
                    }
                } catch (_err) {
                    setProjectDisplayName('')
                }
            })
            .catch((err) => console.log(err))
    }, [pid, isCheckpoint, checkpointId])

    return (
        <div className="page-container" id="admin-view-student-code">
            <Helmet>
                <title>MAAT</title>
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
                    { label: 'School Selection', to: '/admin/schools' },
                    ...(fromOfficeHours
                        ? [{ label: 'Office Hours', to: '/admin/OfficeHours' }]
                        : fromAnalytics && hasClassDirectoryPath
                            ? [
                                { label: 'Class Selection', to: classSelectionUrl },
                                { label: 'Admin Menu', to: adminMenuUrl },
                                { label: 'Analytics Dashboard', to: analyticsDashboardUrl },
                            ]
                            : fromAdminUpload && hasClassDirectoryPath
                                ? [
                                    { label: 'Class Selection', to: classSelectionUrl },
                                    { label: 'Admin Menu', to: adminMenuUrl },
                                    { label: 'Admin Upload', to: adminUploadUrl },
                                ]
                                : fromAdminUpload || !hasFullDirectoryPath
                                    ? [{ label: 'Admin Upload', to: '/admin/schools' }]
                                    : [
                                        { label: 'Class Selection', to: classSelectionUrl },
                                        { label: 'Admin Menu', to: adminMenuUrl },
                                        { label: 'Module List', to: moduleListUrl },
                                        { label: 'Module Details', to: moduleDetailsUrl },
                                        {
                                            label: 'Student List',
                                            to: studentListUrl,
                                        },
                                    ]),
                    { label: 'Code View' },
                ]}
            />

            <div className="pageTitle">
                {(projectDisplayName || (isCheckpoint ? 'Checkpoint Submission' : 'Main Submission'))}: {studentName || 'Unknown Student'}
            </div>

            <DiffView submissionId={submissionId} classId={cid} revealHiddenOutput />
        </div>
    )
}

export default AdminViewStudentCode