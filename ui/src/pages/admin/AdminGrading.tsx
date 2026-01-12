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

type ErrorDef = {
    id: string
    label: string
    description: string
    points: number
}

type ObservedError = {
    startLine: number
    endLine: number
    errorId: string
}

type LineRange = {
    start: number
    end: number
}

export function AdminGrading() {
    const { id, class_id, project_id } = useParams<{ id: string; class_id: string; project_id: string }>()
    const submissionId = id !== undefined ? parseInt(id, 10) : defaultpagenumber
    const cid = class_id !== undefined ? parseInt(class_id, 10) : -1
    const pid = project_id !== undefined ? parseInt(project_id, 10) : -1

    const [studentName, setStudentName] = useState<string>('')

    // Track which lines contain errors and if errors exist
    const [observedErrors, setObservedErrors] = useState<ObservedError[]>([])
    const hasErrors = observedErrors.length > 0

    const ERRORS: Record<string, ErrorDef> = {
        FORMAT: {
            id: 'FORMAT',
            label: 'Format/typo',
            description: 'Spelling, spacing, newlines, punctuation, or order issues',
            points: 5,
        },
        COMPUTE: {
            id: 'COMPUTE',
            label: 'Computation',
            description: 'Wrong math/types (division, formula, rounding)',
            points: 20,
        },
        BRANCH: {
            id: 'BRANCH',
            label: 'Branching',
            description: 'Wrong if/else/boolean/boundary logic',
            points: 20,
        },
        LOOP: {
            id: 'LOOP',
            label: 'Loop/off-by-one',
            description: 'Wrong count; missing/extra/duplicate items',
            points: 20,
        },
        INDEX: {
            id: 'INDEX',
            label: 'Indexing',
            description: 'Wrong element/range/order (arrays/strings)',
            points: 20,
        },
        INCOMPLETE: {
            id: 'INCOMPLETE',
            label: 'Incomplete',
            description: 'Missing required steps/major parts',
            points: 30,
        },
    }


    const errorDefs = useMemo(() => Object.values(ERRORS), [])

    const totalPoints = useMemo(() => {
        return observedErrors
            .reduce((sum, err) => sum + (ERRORS[err.errorId]?.points ?? 0), 0)
    }, [observedErrors])

    const grade = Math.max(0, 100 - totalPoints)

    // Line hover and selection
    const [hoveredLine, setHoveredLine] = useState<number | null>(null)
    const [initialLine, setInitialLine] = useState<number | null>(null)
    const [selectedRange, setSelectedRange] = useState<LineRange | null>(null)

    const selectLines = (start: number, end: number) => {
        setSelectedRange({ start: start, end: end })
    }

    const isRangeSelected = (start: number, end: number) => {
        if (selectedRange === null) return false
        return start <= selectedRange.end && end >= selectedRange.start
    }

    // Handles code line selection
    const handleMouseDown = (line: number) => {
        setInitialLine(line)
        selectLines(line, line)
    }

    const handleMouseEnter = (line: number) => {
        setHoveredLine(line)
        if (initialLine === null) return
        setSelectedRange({
            start: Math.min(initialLine, line),
            end: Math.max(initialLine, line)
        })
    }

    const handleMouseUp = () => {
        setInitialLine(null)
    }

    // References for code lines
    const codeContainerRef = useRef<HTMLDivElement | null>(null)
    const lineRefs = useRef<Record<number, HTMLLIElement | null>>({})

    const scrollToLine = (lineNo: number) => {
        const el = lineRefs.current[lineNo]
        if (!el) return
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }

    // References for Navigation
    const diffViewRef = useRef<HTMLElement | null>(null)
    const allObservedErrorsRef = useRef<HTMLElement | null>(null)

    const scrollToSection = (section: HTMLElement) => {
        if (!section) return
        section.scrollIntoView({ behavior: 'smooth', block: 'center' })
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

    // Fetch saved grading errors
    useEffect(() => {
        if (submissionId < 0) return

        axios
            .get(`${import.meta.env.VITE_API_URL}/submissions/get-grading/${submissionId}`, {
                headers: { Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}` },
            })
            .then((response) => {
                const { errors } = response.data

                for (const item of errors as ObservedError[]) {
                    const start = Number(item.startLine)
                    const end = Number(item.endLine)
                    addError(start, end, item.errorId)
                }
            })
            .catch((err) => console.error('Could not load saved grading:', err))
    }, [submissionId])

    // Handles saving grading errors
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

    const handleSave = () => {
        setSaveStatus('saving')

        axios
            .post(
                `${import.meta.env.VITE_API_URL}/submissions/save-grading`,
                {
                    submissionId: submissionId,
                    grade: grade,
                    errors: observedErrors,
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

    // Groups and sorts errors for the All Errors table
    const tableRows = useMemo(() => {
        return Object.values(
            observedErrors.reduce((table, err) => {
                const key = `${err.startLine}-${err.endLine}`
                if (!table[key]) table[key] = [err.startLine, err.endLine, []]

                table[key][2].push(err)
                return table
            }, {} as Record<string, [number, number, ObservedError[]]>)
        ).sort((a, b) => {
            const [aStart, aEnd] = a
            const [bStart, bEnd] = b
            if (aStart !== bStart) return aStart - bStart
            return (aEnd - aStart) - (bEnd - bStart)
        })
    }, [observedErrors])

    const addError = (start: number, end: number, errorId: string) => {
        setObservedErrors(prev => {
            if (prev.some((err) => err.errorId === errorId &&
                err.startLine === start &&
                err.endLine === end))
                return prev
            return [...prev,
            {
                errorId: errorId,
                startLine: start,
                endLine: end
            }
            ]
        })
        setSaveStatus('idle')
    }

    const removeError = (start: number, end: number, errorId: string) => {
        setObservedErrors(prev =>
            prev.filter(err => !(
                err.errorId === errorId &&
                err.startLine === start &&
                err.endLine === end
            ))
        )
        setSaveStatus('idle')
    }

    const selectedRangeErrors = selectedRange !== null ? observedErrors.filter(err =>
        isRangeSelected(err.startLine, err.endLine)
    ) : []

    return (
        <div className="page-container" id="admin-output-diff">
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
                diffViewRef={diffViewRef}
                codeSectionTitle="Submitted Code (click lines to mark errors)"
                betweenDiffAndCode={
                    <div className="grading-banner" role="note" aria-label="How to add errors">
                        <div className="banner-title">How to mark errors</div>
                        <div className="banner-text">
                            Click a line or select multiple lines in the submitted code. Use the Grading Panel on the right to add or remove error
                            categories for the selected line(s).
                        </div>
                    </div>
                }
                codeContainerRef={codeContainerRef}
                lineRefs={lineRefs}
                getLineClassName={(lineNo) => {
                    const errors = observedErrors.some(err => err.startLine <= lineNo && err.endLine >= lineNo)
                    return [
                        errors ? 'has-error' : '',
                        hoveredLine === lineNo ? 'is-hovered' : '',
                        isRangeSelected(lineNo, lineNo) ? 'is-selected' : '',
                    ]
                        .filter(Boolean)
                        .join(' ')
                }}
                onLineMouseDown={(lineNo) => handleMouseDown(lineNo)}
                onLineMouseEnter={(lineNo) => handleMouseEnter(lineNo)}
                onLineMouseLeave={() => setHoveredLine(null)}
                onLineMouseUp={() => handleMouseUp()}
                rightPanel={
                    <aside className="grading-panel" aria-label="Grading panel">
                        <div className="grading-panel-header">
                            <div className="grading-title">Grading Panel</div>
                            <div className="grading-hint">
                                {!selectedRange ? 'Select a line to start.' : 'Add errors to the selected line(s).'}
                            </div>
                        </div>

                        <div className="navigation-section">
                            <div className="navigation-header">Jump To</div>
                            <ul className="navigation-list">
                                <li className="navigation-item"
                                    onClick={() => diffViewRef.current !== null ? scrollToSection(diffViewRef.current) : null}
                                >
                                    Test Cases
                                </li>
                                <li className="navigation-item"
                                    onClick={() => allObservedErrorsRef.current !== null ? scrollToSection(allObservedErrorsRef.current) : null}
                                >
                                    All Observed Errors
                                </li>
                            </ul>
                        </div>

                        <div className="grading-section">
                            <div className="section-label">Selected line(s)</div>
                            <div className="selected-line-row">
                                <button
                                    type="button"
                                    className={`selected-line-pill ${selectedRange ? 'active' : 'inactive'}`}
                                    disabled={!selectedRange}
                                    onClick={() => selectedRange !== null ? scrollToLine(selectedRange?.start) : null}
                                    title="Click to jump to selected line"
                                >
                                    {selectedRange === null ? 'None' :
                                        selectedRange.start === selectedRange.end ? `Line ${selectedRange.start}` :
                                            `Lines ${selectedRange.start}-${selectedRange.end}`}
                                </button>
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
                                        disabled={selectedRange === null}
                                        onClick={() => {
                                            if (selectedRange === null) return
                                            addError(selectedRange.start, selectedRange.end, err.id)
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
                            {selectedRange === null && <div className="muted small">Select a line to enable adding.</div>}
                        </div>

                        <div className="grading-section">
                            <div className="section-label">Errors on selected line(s)</div>

                            {selectedRange === null && <div className="muted">No line selected.</div>}

                            {selectedRange !== null && selectedRangeErrors.length === 0 && (
                                <div className="muted">No errors on this line.</div>
                            )}

                            {selectedRange !== null && selectedRangeErrors.length > 0 && (
                                <div className="line-error-list">
                                    {selectedRangeErrors.map((err, idx) => {
                                        const meta = ERRORS[err.errorId]
                                        const label = meta?.label ?? err.errorId
                                        const pts = meta?.points ?? 0
                                        return (
                                            <div key={`${selectedRange.start}-${err.errorId}-${idx}`} className="line-error-item">
                                                <div className="line-error-main">
                                                    <span className="line-error-label">{label}</span>
                                                    <span className="line-error-lines">
                                                        {err.startLine === err.endLine ? `${err.startLine}` : `${err.startLine}-${err.endLine}`}
                                                    </span>
                                                    <span className="line-error-points">-{pts}</span>
                                                </div>
                                                <button
                                                    type="button"
                                                    className="line-error-remove"
                                                    onClick={() => removeError(selectedRange.start, selectedRange.end, err.errorId)}
                                                >
                                                    Remove
                                                </button>
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                    </aside>
                }
            />

            <section className="all-observed-section" aria-label="All observed errors" ref={allObservedErrorsRef}>
                <h2 className="section-title">All Observed Errors</h2>
                <div className="all-observed-panel">
                    <div className="save-panel">
                        <div className="grade-column">
                            Grade: {grade}
                        </div>

                        <button className="save-grade">
                            Save as draft
                        </button>

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

                    {!hasErrors && <div className="muted">No errors added yet.</div>}

                    {hasErrors && (
                        <div className="all-errors">
                            {tableRows.map(([start, end, errors]) => {
                                const totalPoints = errors.reduce((sum, e) => sum + (ERRORS[e.errorId]?.points ?? 0), 0)

                                return (
                                    <div
                                        key={`${start}-${end}`}
                                        className={`
                                            all-errors-line
                                            ${selectedRange?.start === start && selectedRange.end === end ? 'is-selected' : ''}
                                        `}
                                    >
                                        <button
                                            type="button"
                                            className="all-errors-line-header"
                                            onClick={() => {
                                                setSelectedRange({ start: start, end: end })
                                                scrollToLine(start)
                                            }}
                                            title="Select line(s)"
                                        >
                                            <span className="all-errors-line-title">
                                                {start === end ? `Line ${start}` : `Lines ${start}-${end}`}
                                            </span>
                                            <span className="all-errors-line-meta">
                                                {errors.length} {errors.length === 1 ? 'error' : 'errors'}, -{totalPoints}
                                            </span>
                                        </button>

                                        <div className="all-errors-line-body">
                                            {errors.map((err, idx) => {
                                                const meta = ERRORS[err.errorId]

                                                return (
                                                    <div key={`${start}-${end}-${err.errorId}-${idx}`} className="all-errors-item">
                                                        <span className="all-errors-item-label">{meta.label}</span>
                                                        <span className="all-errors-item-points">-{meta.points}</span>
                                                        <button
                                                            type="button"
                                                            className="all-errors-item-remove"
                                                            onClick={() => removeError(start, end, err.errorId)}
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