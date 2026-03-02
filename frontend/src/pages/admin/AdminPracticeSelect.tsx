import React, { useEffect, useMemo, useState } from 'react'
import { Helmet } from 'react-helmet'
import { useNavigate, useParams } from 'react-router-dom'
import axios from 'axios'

import MenuComponent from '../components/MenuComponent'
import DirectoryBreadcrumbs from '../components/DirectoryBreadcrumbs'

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
        // 1) Pull main project info to see if practice is enabled (field [7] per your backend contract)
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
            number: Number(p?.number ?? (idx + 1)),
            name: String(p?.name ?? `Practice Problem ${idx + 1}`),
            enabled: !!p?.enabled,
        }))

        setRows(mapped)
    }

    useEffect(() => {
        let cancelled = false
        ;(async () => {
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
            // Refresh list so numbering stays correct even if backend returns in different order
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
                    { label: 'Project Manage', to: `/admin/${classId}/project/manage/${projectId}` },
                    { label: 'Practice Select' as const },
                ]}
            />

            <div className="main-grid">
                <div className="admin-project-config-container">
                    <div className="pageTitle">Practice Problem Select</div>

                    {loading ? (
                        <div style={{ padding: 16 }}>Loading...</div>
                    ) : !practiceEnabled ? (
                        <div style={{ padding: 16 }}>
                            Practice problems are currently disabled for this assignment.
                            <div style={{ marginTop: 12 }}>
                                <button
                                    type="button"
                                    className="submit-button"
                                    onClick={() => navigate(`/admin/${classId}/project/manage/${projectId}`)}
                                >
                                    Back to Project Manage
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div style={{ padding: 16 }}>
                            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
                                <button
                                    type="button"
                                    className="submit-button"
                                    onClick={createPracticeProblem}
                                    disabled={creating}
                                >
                                    {creating ? 'Creating...' : 'Add practice problem'}
                                </button>
                                <button
                                    type="button"
                                    className="submit-button"
                                    onClick={() => navigate(`/admin/${classId}/project/manage/${projectId}`)}
                                >
                                    Back
                                </button>
                            </div>

                            {rows.length === 0 ? (
                                <div>No practice problems yet.</div>
                            ) : (
                                <div style={{ display: 'grid', gap: 12 }}>
                                    {rows.map((r) => (
                                        <div
                                            key={r.id}
                                            style={{
                                                border: '1px solid rgba(255,255,255,0.12)',
                                                borderRadius: 12,
                                                padding: 14,
                                            }}
                                        >
                                            <div style={{ fontSize: 18, fontWeight: 700 }}>
                                                Practice Problem {r.number}
                                            </div>
                                            <div style={{ opacity: 0.8, marginTop: 4 }}>{r.name}</div>
                                            <div style={{ opacity: 0.7, marginTop: 4 }}>
                                                Status: {r.enabled ? 'Enabled' : 'Disabled'}
                                            </div>
                                            <div style={{ marginTop: 12 }}>
                                                <button
                                                    type="button"
                                                    className="submit-button"
                                                    onClick={() => openPractice(r.id)}
                                                >
                                                    Open
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}