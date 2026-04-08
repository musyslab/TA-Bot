// frontend/src/pages/student/StudentOutputDiff.tsx
import React from 'react'
import axios from 'axios'
import { useLocation, useParams } from 'react-router-dom'
import { Helmet } from 'react-helmet'
import MenuComponent from '../components/MenuComponent'
import DirectoryBreadcrumbs from '../components/DirectoryBreadcrumbs'
import DiffView from '../components/CodeDiffView'

const defaultpagenumber = -1

type ApiPastSubmissionsProject = {
    projectId: number
    projectName: string
    main: { submissionId: number } | null
    practices: Array<{ practiceProblemId: number; name: string; submissionId: number }>
}

export function StudentOutputDiff() {
    const { id, class_id } = useParams<{ id: string; class_id: string }>()
    const location = useLocation()

    const submissionId = id !== undefined ? parseInt(id, 10) : defaultpagenumber
    const cid = class_id !== undefined ? parseInt(class_id, 10) : -1
    const classIdStr = class_id ?? ''

    const sp = new URLSearchParams(location.search)
    const practiceRaw = (sp.get('practice') ?? '').trim().toLowerCase()
    const isPractice = practiceRaw === '1' || practiceRaw === 'true' || practiceRaw === 'yes' || practiceRaw === 'y'
    const ppidRaw = (sp.get('practice_problem_id') ?? '').trim()
    const practiceProblemId =
        /^\d+$/.test(ppidRaw) ? parseInt(ppidRaw, 10) : null

    const [resolvedProjectName, setResolvedProjectName] = React.useState<string>('')
    const [resolvedPracticeName, setResolvedPracticeName] = React.useState<string>('')

    React.useEffect(() => {
        const token = localStorage.getItem('AUTOTA_AUTH_TOKEN')
        if (!token || submissionId <= 0) return

        axios
            .get(import.meta.env.VITE_API_URL + `/projects/past-submissions`, {
                headers: { Authorization: `Bearer ${token}` },
            })
            .then((res) => {
                const data: ApiPastSubmissionsProject[] =
                    typeof res.data === 'string' ? JSON.parse(res.data) : (res.data ?? [])

                let projName = ''
                let ppName = ''

                if (isPractice) {
                    // Case A: route param is projectId, practice_problem_id specifies which practice
                    if (practiceProblemId !== null) {
                        const p = (data || []).find((x) => Number(x?.projectId) === submissionId)
                        if (p) {
                            projName = (p.projectName || '').trim()
                            const pp = (p.practices || []).find((y) => Number(y?.practiceProblemId) === practiceProblemId)
                            ppName = (pp?.name || '').trim()
                        }
                    }

                    // Case B: route param is a submissionId (match the practice submission directly)
                    if (!ppName) {
                        for (const p of (data || [])) {
                            const pp = (p?.practices || []).find((y) => Number(y?.submissionId) === submissionId)
                            if (pp) {
                                projName = (p?.projectName || '').trim()
                                ppName = (pp?.name || '').trim()
                                break
                            }
                        }
                    }
                } else {
                    // Main: either projectId or submissionId
                    const pById = (data || []).find((x) => Number(x?.projectId) === submissionId)
                    if (pById) {
                        projName = (pById.projectName || '').trim()
                    } else {
                        const pBySub = (data || []).find((x) => Number(x?.main?.submissionId) === submissionId)
                        projName = (pBySub?.projectName || '').trim()
                    }
                }

                if (projName) setResolvedProjectName(projName)
                if (ppName) setResolvedPracticeName(ppName)
            })
            .catch(() => { })
    }, [submissionId])

    const pageTitle = React.useMemo(() => {
        if (isPractice) {
            const pp = (resolvedPracticeName || '').trim()
            return pp ? `Practice Problem: ${pp}` : 'Practice Problem'
        }
        const name = (resolvedProjectName || '').trim()
        return name ? name : 'Output Results'
    }, [isPractice, resolvedPracticeName, resolvedProjectName])

    const fromRaw = (sp.get('from') ?? '').trim().toLowerCase()
    const isFromPastSubmissions =
        fromRaw === 'past' || fromRaw === 'pastsubmissions' || fromRaw === 'past_submissions'

    const breadcrumbsItems = React.useMemo(() => {
        if (isFromPastSubmissions) {
            return [
                { label: 'Class Selection', to: '/student/classes' },
                { label: 'Past Submissions', to: '/student/PastSubmissions' },
                { label: 'Code View' },
            ]
        }

        if (isPractice) {
            return [
                { label: 'Class Selection', to: '/student/classes' },
                { label: 'Project Upload', to: `/student/${classIdStr}/upload` },
                { label: 'Practice Select', to: `/student/${classIdStr}/practice` },
                ...(practiceProblemId
                    ? [{ label: 'Practice Upload', to: `/student/${classIdStr}/practice/${practiceProblemId}/upload` }]
                    : [{ label: 'Practice Upload' }]),
                { label: 'Code View' },
            ]
        }

        return [
            { label: 'Class Selection', to: '/student/classes' },
            { label: 'Project Upload', to: `/student/${classIdStr}/upload` },
            { label: 'Code View' },
        ]
    }, [classIdStr, isFromPastSubmissions, isPractice, practiceProblemId])

    return (
        <div className="page-container" id="student-output-diff">
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
                items={breadcrumbsItems}
            />

            <div className="pageTitle">{pageTitle}</div>

            <DiffView
                submissionId={submissionId}
                classId={cid}
                disableCopy
                isPractice={isPractice}
                practiceProblemId={practiceProblemId}
            />

        </div>
    )
}

export default StudentOutputDiff