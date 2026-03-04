import React, { useEffect, useMemo, useState } from 'react'
import { Helmet } from 'react-helmet'
import { useNavigate, useParams } from 'react-router-dom'
import axios from 'axios'

import MenuComponent from '../components/MenuComponent'
import DirectoryBreadcrumbs from '../components/DirectoryBreadcrumbs'
import '../../styling/AdminPracticeSelect.scss'

type PracticeRow = {
    id: number
    number: number
    name: string
    enabled: boolean
}

export default function AdminPracticeSelect() {
    const { id, class_id } = useParams()
    const navigate = useNavigate()

    const projectId = Number(id)
    const classId = Number(class_id)

    if (Number.isNaN(projectId) || Number.isNaN(classId)) {
        return <div>Error: Missing or invalid project or class ID.</div>
    }

    const API = import.meta.env.VITE_API_URL
    const authHeader = useMemo(
        () => ({ Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}` }),
        []
    )

    const [loading, setLoading] = useState(true)
    const [practiceEnabled, setPracticeEnabled] = useState(false)
    const [rows, setRows] = useState<PracticeRow[]>([])
    const [creating, setCreating] = useState(false)

    const parseEnabled = (raw: any): boolean => {
        if (raw === true) return true
        if (raw === 1) return true
        const s = String(raw ?? '').trim().toLowerCase()
        return s === 'true' || s === '1' || s === 'yes' || s === 'y' || s === 'on'
    }

    const loadPracticeStateAndRows = async () => {
        // 1) Pull main project info to see if practice is enabled
        const projRes = await axios.get(`${API}/projects/get_project_id?id=${projectId}&practice=false`, {
            headers: authHeader,
        })
        const projData = projRes.data
        const enabledRaw = projData?.[projectId]?.[8]
        const enabled = parseEnabled(enabledRaw)
        setPracticeEnabled(enabled)

        // 2) If enabled, load all practice problems from backend
        if (!enabled) {
            setRows([])
            return
        }

        const listRes = await axios.get(`${API}/projects/list_practice_problems?project_id=${projectId}`, {
            headers: authHeader,
        })

        const problems = Array.isArray(listRes.data?.problems) ? listRes.data.problems : []
        const mapped: PracticeRow[] = problems.map((p: any, idx: number) => ({
            id: Number(p?.id),
            number: Number(p?.number ?? idx + 1),
            name: String(p?.name ?? `Practice Problem ${idx + 1}`),
            enabled: !!p?.enabled,
        }))

        setRows(mapped)
    }

    useEffect(() => {
        let cancelled = false
            ; (async () => {
                try {
                    if (!cancelled) setLoading(true)
                    await loadPracticeStateAndRows()
                } catch (e) {
                    console.log(e)
                    if (!cancelled) {
                        setPracticeEnabled(false)
                        setRows([])
                    }
                } finally {
                    if (!cancelled) setLoading(false)
                }
            })()
        return () => {
            cancelled = true
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [API, authHeader, projectId])

    const openPractice = (practiceProblemId: number) => {
        navigate(`/admin/${classId}/project/${projectId}/practice/${practiceProblemId}`)
    }

    const createPracticeProblem = async () => {
        if (creating) return
        try {
            setCreating(true)

            const nextNumber = rows.length + 1
            const res = await axios.post(
                `${API}/projects/create_practice_problem`,
                {
                    project_id: projectId,
                    name: `Practice Problem ${nextNumber}`,
                },
                { headers: authHeader }
            )

            const newId = Number(res.data?.practice_problem_id)
            await loadPracticeStateAndRows()

            if (!Number.isNaN(newId) && newId > 0) {
                openPractice(newId)
            }
        } catch (e) {
            console.log(e)
            window.alert('Could not create a new practice problem.')
        } finally {
            setCreating(false)
        }
    }

    return (
        <div>
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

            <DirectoryBreadcrumbs
                items={[
                    { label: 'Class Selection', to: '/admin/classes' },
                    { label: 'Project List', to: `/admin/${classId}/projects/` },
                    { label: 'Project Manage', to: `/admin/${classId}/project/${projectId}/manage/` },
                    { label: 'Practice Select' as const },
                ]}
            />

            <div className="main-grid">
                <div className="admin-project-config-container">
                    <div className="pageTitle">Practice Problem Select</div>

                    {loading ? (
                        <div className="aps__panel aps__panel--loading">
                            <div className="aps__loadingText">Loading...</div>
                        </div>
                    ) : !practiceEnabled ? (
                        <div className="aps__panel aps__panel--disabled">
                            <div className="aps__notice">
                                Practice problems are currently disabled for this assignment.
                            </div>
                            <div className="aps__actions">
                                <button
                                    type="button"
                                    className="submit-button"
                                    onClick={() => navigate(`/admin/${classId}/project/${projectId}/manage/`)}
                                >
                                    Back to Project Manage
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="aps__panel aps__panel--enabled">
                            {rows.length === 0 ? (
                                <div className="aps__empty">No practice problems yet.</div>
                            ) : (
                                <div className="aps__grid">
                                    {rows.map((r) => (
                                        <div
                                            key={r.id}
                                            className="aps__card"
                                            role="button"
                                            tabIndex={0}
                                            onClick={() => openPractice(r.id)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' || e.key === ' ') {
                                                    e.preventDefault()
                                                    openPractice(r.id)
                                                }
                                            }}
                                        >
                                            <div className="aps__cardTitle">Practice Problem {r.number}</div>
                                            <div className="aps__cardName">{r.name}</div>
                                            <div className="aps__cardStatus">
                                                Status:{' '}
                                                <span
                                                    className={
                                                        r.enabled
                                                            ? 'aps__pill aps__pill--on'
                                                            : 'aps__pill aps__pill--off'
                                                    }
                                                >
                                                    {r.enabled ? 'Enabled' : 'Disabled'}
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            <div className="aps__actions aps__actions--bottom">
                                <button
                                    type="button"
                                    className="aps__addButton"
                                    onClick={createPracticeProblem}
                                    disabled={creating}
                                >
                                    {creating ? 'Creating...' : 'Add practice problem'}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}