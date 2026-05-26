// frontend/src/pages/student/StudentOutputDiff.tsx
import React from 'react'
import axios from 'axios'
import { useLocation, useParams } from 'react-router-dom'
import { Helmet } from 'react-helmet'
import MenuComponent from '../components/MenuComponent'
import DirectoryBreadcrumbs from '../components/DirectoryBreadcrumbs'
import DiffView from '../components/CodeDiffView'

type ApiPastSubmissionsProject = {
    projectId: number
    projectName: string
    main: { submissionId: number } | null
    practices: Array<{ practiceProblemId: number; name: string; submissionId: number }>
}

type CheckpointLite = {
    id: number
    number?: number
    name?: string
    enabled?: boolean
    solved?: boolean
    rewarded?: boolean
}

const parsePositiveInt = (value: string | undefined): number | null => {
    if (value === undefined || !/^\d+$/.test(value)) return null

    const parsed = parseInt(value, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

const parsePositiveIntFromString = (value: string | null | undefined): number | null => {
    if (value === undefined || value === null || !/^\d+$/.test(value)) return null

    const parsed = parseInt(value, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export function StudentOutputDiff() {
    const {
        id,
        school_id,
        class_id,
        module_id,
        project_id,
        checkpoint_id,
    } = useParams<{
        id?: string
        school_id?: string
        class_id?: string
        module_id?: string
        project_id?: string
        checkpoint_id?: string
    }>()

    const location = useLocation()

    const routeSubmissionId = parsePositiveInt(id) ?? -1
    const cid = class_id !== undefined ? parseInt(class_id, 10) : -1
    const classIdStr = class_id ?? ''
    const routeProjectId = parsePositiveInt(project_id)

    const sp = new URLSearchParams(location.search)
    const practiceRaw = (sp.get('practice') ?? '').trim().toLowerCase()
    const checkpointRaw = (sp.get('checkpoint') ?? '').trim().toLowerCase()
    const isPractice =
        practiceRaw === '1' ||
        practiceRaw === 'true' ||
        practiceRaw === 'yes' ||
        practiceRaw === 'y' ||
        checkpointRaw === '1' ||
        checkpointRaw === 'true' ||
        checkpointRaw === 'yes' ||
        checkpointRaw === 'y' ||
        checkpoint_id !== undefined

    const ppidRaw = (sp.get('practice_problem_id') ?? sp.get('checkpoint_id') ?? checkpoint_id ?? '').trim()
    const practiceProblemId =
        /^\d+$/.test(ppidRaw) ? parseInt(ppidRaw, 10) : null

    const [effectiveSubmissionId, setEffectiveSubmissionId] = React.useState<number>(routeSubmissionId)
    const [effectiveProjectId, setEffectiveProjectId] = React.useState<number | null>(routeProjectId)
    const [resolvedProjectName, setResolvedProjectName] = React.useState<string>('')
    const [resolvedCheckpointLabel, setResolvedCheckpointLabel] = React.useState<string>('')

    React.useEffect(() => {
        setEffectiveSubmissionId(routeSubmissionId)
    }, [routeSubmissionId])

    React.useEffect(() => {
        if (routeProjectId !== null) {
            setEffectiveProjectId(routeProjectId)
            return
        }

        const token = localStorage.getItem('AUTOTA_AUTH_TOKEN')

        if (
            !token ||
            !Number.isFinite(cid) ||
            cid <= 0
        ) {
            return
        }

        axios
            .get(
                `${import.meta.env.VITE_API_URL}/submissions/GetSubmissionDetails?class_id=${cid}`,
                {
                    headers: { Authorization: `Bearer ${token}` },
                },
            )
            .then((res) => {
                const activeProjectName = String(res.data?.[3] || '').trim()
                const activeProjectId = Number(res.data?.[5] || 0)

                if (activeProjectId > 0) {
                    setEffectiveProjectId(activeProjectId)
                }

                if (activeProjectName && !resolvedProjectName) {
                    setResolvedProjectName(activeProjectName)
                }
            })
            .catch(() => { })
    }, [routeProjectId, cid, resolvedProjectName])

    React.useEffect(() => {
        const token = localStorage.getItem('AUTOTA_AUTH_TOKEN')

        if (!token) return

        if (routeSubmissionId > 0 && effectiveProjectId === null && !resolvedProjectName) {
            axios
                .get(import.meta.env.VITE_API_URL + `/projects/past-submissions`, {
                    headers: { Authorization: `Bearer ${token}` },
                })
                .then((res) => {
                    const data: ApiPastSubmissionsProject[] =
                        typeof res.data === 'string' ? JSON.parse(res.data) : (res.data ?? [])

                    const projectByMainSubmission = (data || []).find(
                        (project) => Number(project?.main?.submissionId) === routeSubmissionId,
                    )

                    if (projectByMainSubmission) {
                        setEffectiveProjectId(Number(projectByMainSubmission.projectId))
                        setResolvedProjectName((projectByMainSubmission.projectName || '').trim())
                        return
                    }

                    for (const project of data || []) {
                        const practice = (project?.practices || []).find(
                            (row) => Number(row?.submissionId) === routeSubmissionId,
                        )

                        if (practice) {
                            setEffectiveProjectId(Number(project.projectId))
                            setResolvedProjectName((project.projectName || '').trim())

                            const n = Number(practice.practiceProblemId) || practiceProblemId
                            const checkpointName = (practice.name || '').trim()

                            if (checkpointName) {
                                setResolvedCheckpointLabel(
                                    n ? `Checkpoint ${n}: ${checkpointName}` : `Checkpoint: ${checkpointName}`,
                                )
                            }

                            return
                        }
                    }
                })
                .catch(() => { })
        }
    }, [routeSubmissionId, effectiveProjectId, resolvedProjectName, practiceProblemId])

    React.useEffect(() => {
        const token = localStorage.getItem('AUTOTA_AUTH_TOKEN')

        if (
            routeSubmissionId > 0 ||
            !token ||
            effectiveProjectId === null
        ) {
            return
        }

        axios
            .get(import.meta.env.VITE_API_URL + `/projects/past-submissions`, {
                headers: { Authorization: `Bearer ${token}` },
            })
            .then((res) => {
                const data: ApiPastSubmissionsProject[] =
                    typeof res.data === 'string' ? JSON.parse(res.data) : (res.data ?? [])

                const projectRow = (data || []).find(
                    (project) => Number(project?.projectId) === effectiveProjectId,
                )

                if (!projectRow) {
                    setEffectiveSubmissionId(-1)
                    return
                }

                setResolvedProjectName((projectRow.projectName || '').trim())

                if (isPractice) {
                    if (practiceProblemId === null) {
                        setEffectiveSubmissionId(-1)
                        return
                    }

                    const practiceRow = (projectRow.practices || []).find(
                        (row) => Number(row?.practiceProblemId) === practiceProblemId,
                    )

                    const submissionId = Number(practiceRow?.submissionId || 0)

                    if (submissionId > 0) {
                        setEffectiveSubmissionId(submissionId)
                    } else {
                        setEffectiveSubmissionId(-1)
                    }

                    const checkpointName = (practiceRow?.name || '').trim()

                    if (checkpointName) {
                        setResolvedCheckpointLabel(
                            `Checkpoint ${practiceProblemId}: ${checkpointName}`,
                        )
                    }

                    return
                }

                const mainSubmissionId = Number(projectRow.main?.submissionId || 0)

                setEffectiveSubmissionId(mainSubmissionId > 0 ? mainSubmissionId : -1)
            })
            .catch(() => {
                setEffectiveSubmissionId(-1)
            })
    }, [routeSubmissionId, effectiveProjectId, isPractice, practiceProblemId])

    React.useEffect(() => {
        const token = localStorage.getItem('AUTOTA_AUTH_TOKEN')
        if (!token || effectiveSubmissionId <= 0) return

        axios
            .get(import.meta.env.VITE_API_URL + `/projects/past-submissions`, {
                headers: { Authorization: `Bearer ${token}` },
            })
            .then((res) => {
                const data: ApiPastSubmissionsProject[] =
                    typeof res.data === 'string' ? JSON.parse(res.data) : (res.data ?? [])

                let projName = ''
                let checkpointName = ''
                let checkpointNumber: number | null = practiceProblemId

                if (effectiveProjectId !== null) {
                    const pByRouteProject = (data || []).find((x) => Number(x?.projectId) === effectiveProjectId)

                    if (pByRouteProject) {
                        projName = (pByRouteProject.projectName || '').trim()

                        if (isPractice && practiceProblemId !== null) {
                            const pp = (pByRouteProject.practices || []).find(
                                (y) => Number(y?.practiceProblemId) === practiceProblemId,
                            )

                            checkpointName = (pp?.name || '').trim()
                        }
                    }
                }

                if (!projName) {
                    const pByMainSubmission = (data || []).find((x) => Number(x?.main?.submissionId) === effectiveSubmissionId)
                    projName = (pByMainSubmission?.projectName || '').trim()
                }

                if (isPractice && !checkpointName) {
                    for (const p of (data || [])) {
                        const pp = (p?.practices || []).find((y) => Number(y?.submissionId) === effectiveSubmissionId)

                        if (pp) {
                            projName = (p?.projectName || '').trim()
                            checkpointName = (pp?.name || '').trim()
                            checkpointNumber = Number(pp?.practiceProblemId) || checkpointNumber
                            break
                        }
                    }
                }

                if (projName) setResolvedProjectName(projName)

                if (isPractice && checkpointName) {
                    const n = checkpointNumber ?? practiceProblemId
                    setResolvedCheckpointLabel(
                        n ? `Checkpoint ${n}: ${checkpointName}` : `Checkpoint: ${checkpointName}`,
                    )
                }
            })
            .catch(() => { })
    }, [effectiveSubmissionId, effectiveProjectId, isPractice, practiceProblemId])

    React.useEffect(() => {
        const token = localStorage.getItem('AUTOTA_AUTH_TOKEN')

        if (
            !isPractice ||
            resolvedCheckpointLabel ||
            !token ||
            effectiveProjectId === null ||
            practiceProblemId === null
        ) {
            return
        }

        axios
            .get(
                `${import.meta.env.VITE_API_URL}/projects/list_checkpoints_student?project_id=${effectiveProjectId}`,
                {
                    headers: { Authorization: `Bearer ${token}` },
                },
            )
            .then((res) => {
                const probs = (res?.data?.problems ?? []) as CheckpointLite[]
                const found = Array.isArray(probs)
                    ? probs.find((p) => Number(p?.id) === practiceProblemId)
                    : undefined

                if (!found) {
                    setResolvedCheckpointLabel(`Checkpoint ${practiceProblemId}: Checkpoint ${practiceProblemId}`)
                    return
                }

                const n = Number(found?.number ?? practiceProblemId)
                const name = String(found?.name || `Checkpoint ${n}`).trim()

                setResolvedCheckpointLabel(`${n ? `Checkpoint ${n}` : 'Checkpoint'}: ${name}`)
            })
            .catch(() => {
                setResolvedCheckpointLabel(`Checkpoint ${practiceProblemId}: Checkpoint ${practiceProblemId}`)
            })
    }, [isPractice, resolvedCheckpointLabel, effectiveProjectId, practiceProblemId])

    React.useEffect(() => {
        const token = localStorage.getItem('AUTOTA_AUTH_TOKEN')
        if (
            resolvedProjectName ||
            !token ||
            !Number.isFinite(cid) ||
            cid <= 0
        ) {
            return
        }

        axios
            .get(
                `${import.meta.env.VITE_API_URL}/submissions/GetSubmissionDetails?class_id=${cid}`,
                {
                    headers: { Authorization: `Bearer ${token}` },
                },
            )
            .then((res) => {
                const activeProjectName = String(res.data?.[3] || '').trim()
                const activeProjectId = Number(res.data?.[5] || 0)

                if (
                    activeProjectName &&
                    (effectiveProjectId === null || activeProjectId === effectiveProjectId)
                ) {
                    setResolvedProjectName(activeProjectName)
                }
            })
            .catch(() => { })
    }, [resolvedProjectName, cid, effectiveProjectId])

    const pageTitle = React.useMemo(() => {
        if (isPractice) {
            return resolvedCheckpointLabel || 'Checkpoint'
        }

        const name = (resolvedProjectName || '').trim()
        return name ? `Main Project: ${name.replace(/_/g, ' ')}` : 'Main Project'
    }, [isPractice, resolvedCheckpointLabel, resolvedProjectName])

    const breadcrumbsItems = React.useMemo(() => {
        if (school_id && class_id && module_id && project_id) {
            const uploadPath = checkpoint_id
                ? `/student/school/${school_id}/class/${class_id}/module/${module_id}/project/${project_id}/checkpoint/${checkpoint_id}/upload`
                : `/student/school/${school_id}/class/${class_id}/module/${module_id}/project/${project_id}/upload`

            return [
                { label: 'School Selection', to: '/schools' },
                { label: 'Class Selection', to: `/student/school/${school_id}/classes` },
                { label: 'Module List', to: `/student/school/${school_id}/class/${class_id}/modules` },
                { label: 'Module Details', to: `/student/school/${school_id}/class/${class_id}/module/${module_id}` },
                { label: 'Student Upload', to: uploadPath },
                { label: 'Code View' },
            ]
        }

        return [
            { label: 'School Selection', to: '/schools' },
            { label: 'Class Selection', to: '/student/classes' },
            { label: 'Module List' },
            { label: 'Module Details' },
            { label: 'Student Upload', to: classIdStr ? `/student/${classIdStr}/upload` : undefined },
            { label: 'Code View' },
        ]
    }, [school_id, class_id, module_id, project_id, checkpoint_id, classIdStr])

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
                submissionId={effectiveSubmissionId}
                classId={cid}
                disableCopy
                isPractice={isPractice}
                practiceProblemId={practiceProblemId}
            />

        </div>
    )
}

export default StudentOutputDiff