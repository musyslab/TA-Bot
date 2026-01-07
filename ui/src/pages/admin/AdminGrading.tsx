// AdminGrading.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import { useParams } from 'react-router-dom'
import { Helmet } from 'react-helmet'
import MenuComponent from '../components/MenuComponent'
import '../../styling/AdminGrading.scss'
import DirectoryBreadcrumbs from '../components/DirectoryBreadcrumbs'
import DiffView from '../components/CodeDiffView'

const defaultpagenumber = -1

type BackendError = {
    line: number
    errorId: string
}

type ErrorDef = {
    id: string
    label: string
    description: string
    points: number
}

type ObservedError = {
    errorId: string
}

type ErrorsByLine = {
    [line: number]: ObservedError[]
}

export function AdminGrading() {
    const { id, class_id, project_id } = useParams<{ id: string; class_id: string; project_id: string }>()
    const submissionId = id !== undefined ? parseInt(id, 10) : defaultpagenumber
    const cid = class_id !== undefined ? parseInt(class_id, 10) : -1
    const pid = project_id !== undefined ? parseInt(project_id, 10) : -1

    const [studentName, setStudentName] = useState<string>('')

    // Track which lines contain errors and if errors exist
    const [observedErrors, setObservedErrors] = useState<ErrorsByLine>({})
    const hasErrors = Object.keys(observedErrors).length > 0

    // TODO: Add actual error definitions
    const ERRORS: Record<string, ErrorDef> = {
        ERROR1: {
            id: 'ERROR1',
            label: 'Error 1',
            description: 'Error 1 description.',
            points: 1,
        },
        ERROR2: {
            id: 'ERROR2',
            label: 'Error 2',
            description: 'Error 2 description.',
            points: 2,
        },
        ERROR3: {
            id: 'ERROR3',
            label: 'Error 3',
            description: 'Error 3 description.',
            points: 3,
        },
    }

    const errorDefs = useMemo(() => Object.values(ERRORS), [])

    const totalPoints = useMemo(() => {
        return Object.values(observedErrors)
            .flat()
            .reduce((sum, err) => sum + (ERRORS[err.errorId]?.points ?? 0), 0)
    }, [observedErrors])

    const grade = Math.max(0, 100 - totalPoints)

    // Line hover and selection
    const [hoveredLine, setHoveredLine] = useState<number | null>(null)
    const [selectedLine, setSelectedLine] = useState<number | null>(null)

    // References for code lines
    const codeContainerRef = useRef<HTMLDivElement | null>(null)
    const lineRefs = useRef<Record<number, HTMLLIElement | null>>({})

    const scrollToLine = (lineNo: number) => {
        const el = lineRefs.current[lineNo]
        if (!el) return
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }

    const selectLine = (lineNo: number) => {
        setSelectedLine(lineNo)
    }

    // Fetch student name for header
    useEffect(() => {
        if (submissionId < 0 || pid < 0) return

        axios
            .post(
                `${import.meta.env.VITE_API_URL}/submissions/recentsubproject`,
                { project_id: pid },
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
    }, [submissionId, pid])

    // Load saved grading (errors)
    useEffect(() => {
        if (submissionId < 0) return

        axios
            .get(`${import.meta.env.VITE_API_URL}/submissions/get-grading/${submissionId}`, {
                headers: { Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}` },
            })
            .then((response) => {
                const { errors } = response.data

                const formattedErrors: ErrorsByLine = {}

                for (const item of errors as BackendError[]) {
                    const lineNo = Number(item.line)
                    if (!formattedErrors[lineNo]) formattedErrors[lineNo] = []
                    formattedErrors[lineNo].push({ errorId: item.errorId })
                }

                setObservedErrors(formattedErrors)

                const firstLine = Object.keys(formattedErrors)
                    .map((k) => Number(k))
                    .sort((a, b) => a - b)[0]

                if (Number.isFinite(firstLine)) {
                    setSelectedLine(firstLine)
                }
            })
            .catch((err) => console.error('Could not load saved grading:', err))
    }, [submissionId])

    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

    const handleSave = () => {
        setSaveStatus('saving')

        // converts { 10: [{errorId: "ERROR1"}] } into [{ line: 10, errorId: "ERROR1" }]
        const errorList = Object.entries(observedErrors).flatMap(([line, errors]) =>
            errors.map((err) => ({
                line: parseInt(line, 10),
                errorId: err.errorId,
            }))
        )

        axios
            .post(
                `${import.meta.env.VITE_API_URL}/submissions/save-grading`,
                {
                    submissionId: submissionId,
                    grade: grade,
                    errors: errorList,
                },
                {
                    headers: {
                        Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}`,
                    },
                }
            )
            .then((response) => {
                setSaveStatus('saved')
                console.log(response.data)
            })
            .catch((error) => {
                console.error('Failed to save:', error)
                setSaveStatus('error')
            })
    }

    const addObservedError = (line: number, errorId: string) => {
        setObservedErrors((prev) => {
            const errors = prev[line] ?? []
            if (errors.some((e) => e.errorId === errorId)) return prev
            return { ...prev, [line]: [...errors, { errorId }] }
        })
        setSaveStatus('idle')
    }

    const removeObservedError = (line: number, errorId: string) => {
        setObservedErrors((prev) => {
            const remaining = prev[line]?.filter((e) => e.errorId !== errorId) ?? []

            if (remaining.length === 0) {
                const { [line]: _, ...rest } = prev
                return rest
            }
            return { ...prev, [line]: remaining }
        })
        setSaveStatus('idle')
    }

    const selectedLineErrors = selectedLine !== null ? observedErrors[selectedLine] ?? [] : []

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
                    { label: 'Class Selection', to: '/admin/classes' },
                    { label: 'Project List', to: `/admin/${cid}/projects` },
                    { label: 'Student List', to: `/admin/${cid}/project/${pid}` },
                    { label: 'Grade Submission' },
                ]}
            />

            <div className="pageTitle">Grade Submission: {studentName || 'Unknown Student'}</div>

            <DiffView
                submissionId={submissionId}
                classId={cid}
                codeSectionTitle="Submitted Code (click lines to mark errors)"
                betweenDiffAndCode={
                    <div className="grading-banner" role="note" aria-label="How to add errors">
                        <div className="banner-title">How to mark errors</div>
                        <div className="banner-text">
                            Click a line in the submitted code. Use the Grading Panel on the right to add or remove error
                            categories for that line.
                        </div>
                    </div>
                }
                codeContainerRef={codeContainerRef}
                lineRefs={lineRefs}
                getLineClassName={(lineNo) => {
                    const errors = observedErrors[lineNo] ?? []
                    return [
                        errors.length > 0 ? 'has-error' : '',
                        hoveredLine === lineNo ? 'is-hovered' : '',
                        selectedLine === lineNo ? 'is-selected' : '',
                    ]
                        .filter(Boolean)
                        .join(' ')
                }}
                onLineClick={(lineNo) => selectLine(lineNo)}
                onLineMouseEnter={(lineNo) => setHoveredLine(lineNo)}
                onLineMouseLeave={() => setHoveredLine(null)}
                codeRightPanel={
                    <aside className="grading-panel" aria-label="Grading panel">
                        <div className="grading-panel-header">
                            <div className="grading-title">Grading Panel</div>
                            <div className="grading-hint">
                                {selectedLine === null ? 'Select a line to start.' : 'Add errors to the selected line.'}
                            </div>
                        </div>

                        <div className="grading-section">
                            <div className="section-label">Selected line</div>
                            <div className="selected-line-row">
                                <span className={`selected-line-pill ${selectedLine !== null ? 'active' : 'inactive'}`}>
                                    {selectedLine !== null ? `Line ${selectedLine}` : 'None'}
                                </span>
                            </div>
                        </div>

                        <div className="grading-section">
                            <div className="section-label">Add an error</div>
                            <div className="error-def-list">
                                {errorDefs.map((err) => (
                                    <button
                                        key={err.id}
                                        type="button"
                                        className="error-def-btn"
                                        disabled={selectedLine === null}
                                        onClick={() => {
                                            if (selectedLine === null) return
                                            addObservedError(selectedLine, err.id)
                                        }}
                                    >
                                        <div className="error-def-top">
                                            <span className="error-def-label">{err.label}</span>
                                            <span className="error-def-points">-{err.points}</span>
                                        </div>
                                        <div className="error-def-desc">{err.description}</div>
                                    </button>
                                ))}
                            </div>
                            {selectedLine === null && <div className="muted small">Select a line to enable adding.</div>}
                        </div>

                        <div className="grading-section">
                            <div className="section-label">Errors on selected line</div>

                            {selectedLine === null && <div className="muted">No line selected.</div>}

                            {selectedLine !== null && selectedLineErrors.length === 0 && (
                                <div className="muted">No errors on this line.</div>
                            )}

                            {selectedLine !== null && selectedLineErrors.length > 0 && (
                                <div className="line-error-list">
                                    {selectedLineErrors.map((err, idx) => {
                                        const meta = ERRORS[err.errorId]
                                        const label = meta?.label ?? err.errorId
                                        const pts = meta?.points ?? 0
                                        return (
                                            <div key={`${selectedLine}-${err.errorId}-${idx}`} className="line-error-item">
                                                <div className="line-error-main">
                                                    <span className="line-error-label">{label}</span>
                                                    <span className="line-error-points">-{pts}</span>
                                                </div>
                                                <button
                                                    type="button"
                                                    className="line-error-remove"
                                                    onClick={() => removeObservedError(selectedLine, err.errorId)}
                                                >
                                                    Remove
                                                </button>
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                        </div>

                        <div className="grading-panel-footer">
                            <div className="grade-row">
                                <span className="grade-label">Grade</span>
                                <span className="grade-value">{grade}</span>
                            </div>

                            <button
                                className={`save-grade ${saveStatus}`}
                                onClick={handleSave}
                                disabled={saveStatus === 'saving'}
                            >
                                {saveStatus === 'idle' && 'Save'}
                                {saveStatus === 'saving' && 'Saving...'}
                                {saveStatus === 'saved' && 'Saved!'}
                                {saveStatus === 'error' && 'Error'}
                            </button>

                            {saveStatus === 'error' && (
                                <div className="muted small">Save failed. Try again.</div>
                            )}
                            {saveStatus === 'saved' && (
                                <div className="muted small">Saved to the database.</div>
                            )}
                        </div>
                    </aside>
                }
            />

            <section className="all-observed-section" aria-label="All observed errors">
                <h2 className="section-title">All Observed Errors</h2>
                <div className="all-observed-panel">
                    {!hasErrors && <div className="muted">No errors added yet.</div>}

                    {hasErrors && (
                        <div className="all-errors">
                            {Object.entries(observedErrors)
                                .sort(([a], [b]) => Number(a) - Number(b))
                                .map(([lineStr, errors]) => {
                                    const lineNo = Number(lineStr)
                                    const lineTotal = errors.reduce((sum, e) => sum + (ERRORS[e.errorId]?.points ?? 0), 0)

                                    return (
                                        <div
                                            key={lineNo}
                                            className={`all-errors-line ${selectedLine === lineNo ? 'is-selected' : ''}`}
                                        >
                                            <button
                                                type="button"
                                                className="all-errors-line-header"
                                                onClick={() => {
                                                    setSelectedLine(lineNo)
                                                    scrollToLine(lineNo)
                                                }}
                                                title="Select line"
                                            >
                                                <span className="all-errors-line-title">Line {lineNo}</span>
                                                <span className="all-errors-line-meta">
                                                    {errors.length} {errors.length === 1 ? 'error' : 'errors'}, -{lineTotal}
                                                </span>
                                            </button>

                                            <div className="all-errors-line-body">
                                                {errors.map((err, idx) => {
                                                    const meta = ERRORS[err.errorId]
                                                    const label = meta?.label ?? err.errorId
                                                    const pts = meta?.points ?? 0

                                                    return (
                                                        <div key={`${lineNo}-${err.errorId}-${idx}`} className="all-errors-item">
                                                            <span className="all-errors-item-label">{label}</span>
                                                            <span className="all-errors-item-points">-{pts}</span>
                                                            <button
                                                                type="button"
                                                                className="all-errors-item-remove"
                                                                onClick={() => removeObservedError(lineNo, err.errorId)}
                                                            >
                                                                Remove
                                                            </button>
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        </div>
                                    )
                                })}
                        </div>
                    )}
                </div>
            </section>
        </div>
    )
}

export default AdminGrading