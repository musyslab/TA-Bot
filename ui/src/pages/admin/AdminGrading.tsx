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

type ErrorOption = {
    id: string
    label: string
    description: string
    points: number
}

type CategoryDef = {
    id: string
    label: string
    description: string
    errors: ErrorOption[]
}

type ErrorDef = ErrorOption & {
    categoryId: string
    categoryLabel: string
}

type SuggestedPick = {
    id: string
    errorId: string
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

    const CATEGORIES = useMemo<CategoryDef[]>(() => [
        {
            id: 'INPUT',
            label: 'Input handling',
            description: 'Missing prompts, wrong order, wrong parsing',
            errors: [
                { id: 'INPUT_PROMPT', label: 'No prompt before reading input', description: 'Missing prompt before input read', points: 4 },
                { id: 'INPUT_ORDER', label: 'Reads inputs in the wrong order', description: 'Consumes inputs in the wrong sequence', points: 6 },
                { id: 'INPUT_PARSE', label: 'Wrong parsing of input type', description: 'String vs int/float parse mismatch', points: 5 },
            ],
        },
        {
            id: 'OUTPUT',
            label: 'Output formatting and ordering',
            description: 'Right values, wrong presentation',
            errors: [
                { id: 'OUTPUT_ORDER', label: 'Correct values, wrong order of output lines', description: 'Lines printed in the wrong order', points: 6 },
                { id: 'OUTPUT_MISSING', label: 'Missing required line(s) of output', description: 'Required output line(s) not printed', points: 8 },
                { id: 'OUTPUT_EXTRA', label: 'Extra line(s) of output', description: 'Unexpected extra output printed', points: 6 },
                { id: 'OUTPUT_SPACE', label: 'Wrong formatting: spaces/newlines', description: 'Extra or missing spaces/newlines', points: 2 },
                { id: 'OUTPUT_SPELL', label: 'Wrong formatting: misspellings', description: 'Typos in required output text', points: 3 },
                { id: 'OUTPUT_ROUND', label: 'Wrong rounding/precision formatting', description: 'Wrong decimal precision/rounding', points: 4 },
            ],
        },
        {
            id: 'STATE',
            label: 'Variable and state',
            description: 'Bad initialization, wrong variable use, misused flags',
            errors: [
                { id: 'STATE_INIT', label: 'Uninitialized or wrong initial value', description: 'Uses uninitialized value or wrong starting value', points: 10 },
                { id: 'STATE_VAR', label: 'Wrong variable use or type', description: 'Mixed variables, truncation, overwritten state', points: 8 },
                { id: 'STATE_FLAG', label: 'Flag/state variable misused', description: 'Never set/cleared, reused incorrectly', points: 7 },
            ],
        },
        {
            id: 'COMPUTE',
            label: 'Computation and numeric logic',
            description: 'Wrong formula, precedence, or division type',
            errors: [
                { id: 'COMPUTE_NUMERIC', label: 'Wrong numeric computation', description: 'Wrong formula, precedence, or division type', points: 10 },
            ],
        },
        {
            id: 'COND',
            label: 'Condition and boolean logic',
            description: 'Wrong branch condition logic',
            errors: [
                { id: 'COND_COMPOUND', label: 'Incorrect compound logic', description: 'Missing AND/OR or logical vs bitwise', points: 10 },
                { id: 'COND_BOUNDARY', label: 'Incorrect comparisons or boundaries', description: 'Wrong operator/variable or missed edge case', points: 8 },
            ],
        },
        {
            id: 'BRANCH',
            label: 'Branching structure',
            description: 'Control flow wiring mistakes',
            errors: [
                { id: 'BRANCH_STRUCTURE', label: 'Incorrect branch structure', description: 'Misbound else, missing default/else, missing break', points: 8 },
            ],
        },
        {
            id: 'LOOP',
            label: 'Loop',
            description: 'Bounds, control, and semantics',
            errors: [
                { id: 'LOOP_BOUNDS', label: 'Incorrect loop bounds or termination', description: 'Off-by-one, missing last, infinite loop', points: 12 },
                { id: 'LOOP_CONTROL', label: 'Incorrect loop control logic', description: 'Bad init/update, misplaced counter, empty loop', points: 10 },
                { id: 'LOOP_SEMANTICS', label: 'Incorrect loop semantics', description: 'Wrong nesting, wrong I/O placement, bad accumulation', points: 9 },
            ],
        },
        {
            id: 'INDEX',
            label: 'Array, string, and indexing',
            description: 'Out of bounds, wrong setup, wrong range',
            errors: [
                { id: 'INDEX_INVALID', label: 'Invalid indexing', description: 'Out-of-bounds, empty, wrong base, wrong range', points: 12 },
                { id: 'INDEX_SETUP', label: 'Incorrect array/string setup', description: 'Wrong size, missing elements', points: 8 },
            ],
        },
        {
            id: 'FUNC',
            label: 'Function and return values',
            description: 'Wrong return behavior or function use',
            errors: [
                { id: 'FUNC_RETURN', label: 'Incorrect return behavior', description: 'Ignored, missing, wrong sentinel/type', points: 10 },
                { id: 'FUNC_USE', label: 'Incorrect function use', description: 'Wrong order/scope or unnecessary re-calls', points: 8 },
            ],
        },
    ], [])

    const ERROR_MAP = useMemo<Record<string, ErrorDef>>(() => {
        const map: Record<string, ErrorDef> = {}
        for (const cat of CATEGORIES) {
            for (const err of cat.errors) {
                map[err.id] = {
                    ...err,
                    categoryId: cat.id,
                    categoryLabel: cat.label,
                }
            }
        }
        return map
    }, [CATEGORIES])

    const SUGGESTIONS = useMemo<SuggestedPick[]>(() => [
        { id: 'SUG_1', errorId: 'LOOP_BOUNDS' },
        { id: 'SUG_2', errorId: 'COMPUTE_NUMERIC' },
        { id: 'SUG_3', errorId: 'OUTPUT_MISSING' },
        { id: 'SUG_4', errorId: 'COND_BOUNDARY' },
    ], [])

    const totalPoints = useMemo(() => {
        return observedErrors
            .reduce((sum, err) => sum + (ERROR_MAP[err.errorId]?.points ?? 0), 0)
    }, [observedErrors, ERROR_MAP])

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
                            <div className="section-label">AI suggestions</div>
                            <div className="suggestions-grid">
                                {SUGGESTIONS.map((s) => {
                                    const meta = ERROR_MAP[s.errorId]
                                    return (
                                        <button
                                            key={s.id}
                                            type="button"
                                            className="suggestion-btn"
                                            disabled={selectedRange === null}
                                            onClick={() => {
                                                if (selectedRange === null) return
                                                addError(selectedRange.start, selectedRange.end, s.errorId)
                                            }}
                                        >
                                            <div className="suggestion-top">
                                                <span className="suggestion-title">{meta?.label ?? s.errorId}</span>
                                                <span className="suggestion-points">-{meta?.points ?? 0}</span>
                                            </div>
                                        </button>
                                    )
                                })}
                            </div>
                        </div>

                        <div className="grading-section">
                            <details className="all-categories">
                                <summary className="all-categories-summary">
                                    <span className="all-categories-title">All categories</span>
                                    <span className="all-categories-count">{CATEGORIES.length}</span>
                                </summary>

                                <div className="all-categories-body">
                                    <div className="category-list">
                                        {CATEGORIES.map((cat) => (
                                            <details
                                                key={cat.id}
                                                className="category"
                                            >
                                                <summary className="category-summary">
                                                    <span className="category-title">{cat.label}</span>
                                                    <span className="category-count">{cat.errors.length}</span>
                                                </summary>
                                                <div className="category-errors">
                                                    {cat.errors.map((err) => (
                                                        <button
                                                            key={err.id}
                                                            type="button"
                                                            className="error-option-btn"
                                                            disabled={selectedRange === null}
                                                            onClick={() => {
                                                                if (selectedRange === null) return
                                                                addError(selectedRange.start, selectedRange.end, err.id)
                                                            }}
                                                        >
                                                            <span className="error-option-label">{err.label}</span>
                                                            <span className="error-option-points">-{err.points}</span>
                                                        </button>
                                                    ))}
                                                </div>
                                            </details>
                                        ))}
                                    </div>
                                </div>
                            </details>

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
                                        const meta = ERROR_MAP[err.errorId]
                                        const label = meta?.label ?? err.errorId
                                        const pts = meta?.points ?? 0
                                        const catLabel = meta?.categoryLabel ?? ''
                                        return (
                                            <div key={`${selectedRange.start}-${err.errorId}-${idx}`} className="line-error-item">
                                                <div className="line-error-main">
                                                    {catLabel && <span className="line-error-category">{catLabel}</span>}
                                                    <span className="line-error-lines">
                                                        {err.startLine === err.endLine ? `${err.startLine}` : `${err.startLine}-${err.endLine}`}
                                                    </span>
                                                    <span className="line-error-points">-{pts}</span>
                                                </div>
                                                <button
                                                    type="button"
                                                    className="line-error-remove"
                                                    onClick={() => removeError(err.startLine, err.endLine, err.errorId)}
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
                                const totalPoints = errors.reduce((sum, e) => sum + (ERROR_MAP[e.errorId]?.points ?? 0), 0)

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
                                                const meta = ERROR_MAP[err.errorId]
                                                const label = meta?.label ?? err.errorId
                                                const catLabel = meta?.categoryLabel ?? ''
                                                const pts = meta?.points ?? 0

                                                return (
                                                    <div key={`${start}-${end}-${err.errorId}-${idx}`} className="all-errors-item">
                                                        <span className="all-errors-item-label">{label}</span>
                                                        {catLabel && <span className="all-errors-item-category">{catLabel}</span>}
                                                        <span className="all-errors-item-points">-{pts}</span>
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