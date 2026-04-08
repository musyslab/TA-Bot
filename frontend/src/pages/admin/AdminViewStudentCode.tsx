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
    const { id, class_id, project_id } = useParams<{ id: string; class_id: string; project_id: string }>()

    const submissionId = id !== undefined ? parseInt(id, 10) : defaultpagenumber
    const cid = class_id !== undefined ? parseInt(class_id, 10) : -1
    const pid = project_id !== undefined ? parseInt(project_id, 10) : -1

    const [studentName, setStudentName] = useState<string>('')
    const [projectDisplayName, setProjectDisplayName] = useState<string>('')

    const params = new URLSearchParams(search)
    const fromParam = (params.get('from') || '').toLowerCase()
    const fromOfficeHours = fromParam === 'office-hours'
    const practiceParam = (params.get('practice') || '').toLowerCase()
    const isPractice = ['1', 'true', 'yes', 'y', 'on'].includes(practiceParam)

    const ppidParam = (params.get('practice_problem_id') || '').trim()
    const parsedPpid = parseInt(ppidParam, 10)
    const practiceProblemId =
        isPractice && !Number.isNaN(parsedPpid) && parsedPpid > 0 ? parsedPpid : undefined

    const classIdStr = class_id ?? ''
    const projectIdStr = project_id ?? ''

    const practiceQuery =
        isPractice ? `?practice=true${practiceProblemId ? `&practice_problem_id=${practiceProblemId}` : ''}` : ''

    useEffect(() => {
        if (submissionId < 0 || pid < 0) return
        axios
            .post(
                `${import.meta.env.VITE_API_URL}/submissions/recentsubproject`,
                {
                    project_id: pid,
                    practice: isPractice,
                    practice_problem_id: practiceProblemId ?? null,
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
    }, [submissionId, pid, isPractice, practiceProblemId])

    useEffect(() => {
        if (pid < 0) return
        axios
            .get(
                `${import.meta.env.VITE_API_URL}/projects/get_project_id?id=${pid}${isPractice && practiceProblemId ? `&practice_problem_id=${practiceProblemId}` : ''
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
    }, [pid, isPractice, practiceProblemId])

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
                    { label: 'Class Selection', to: '/admin/classes' },
                    ...(fromOfficeHours
                        ? [{ label: 'Office Hours', to: '/admin/OfficeHours' }]
                        : [
                            { label: 'Project List', to: `/admin/${classIdStr}/projects` },
                            {
                                label: isPractice ? 'Practice Submissions' : 'Student List',
                                to: `/admin/${classIdStr}/project/${projectIdStr}${practiceQuery}`,
                            },
                        ]),
                    { label: 'Code View' },
                ]}
            />

            <div className="pageTitle">
                {(projectDisplayName || (isPractice ? 'Practice Submission' : 'Main Submission'))}: {studentName || 'Unknown Student'}
            </div>

            <DiffView submissionId={submissionId} classId={cid} revealHiddenOutput />
        </div>
    )
}

export default AdminViewStudentCode
