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
    const [activeTestcaseName, setActiveTestcaseName] = useState<string>('')
    const [activeTestcaseLongDiff, setActiveTestcaseLongDiff] = useState<string>('')

    // Track which lines contain errors and if errors exist
    const [observedErrors, setObservedErrors] = useState<ObservedError[]>([])
    const hasErrors = observedErrors.length > 0

    const ERROR_DEFS = useMemo<ErrorOption[]>(
        () => [
            {
                id: 'MISSPELL',
                label: 'Spelling or word substitution error',
                description:
                    'A word or short phrase is wrong compared to expected output (including valid English words used incorrectly, missing/extra letters, or wrong small words) when the rest of the line is otherwise correct.',
                points: 10,
            },
            {
                id: 'FORMAT',
                label: 'Formatting mismatch',
                description: 'Correct content but incorrect formatting (spacing/newlines/case/spelling/precision).',
                points: 5,
            },
            {
                id: 'CONTENT',
                label: 'Missing or extra required content',
                description: 'Required value/line is missing, or additional unexpected value/line is produced.',
                points: 20,
            },
            {
                id: 'ORDER',
                label: 'Order mismatch',
                description: 'Reads inputs or prints outputs in the wrong order relative to the required sequence.',
                points: 15,
            },
            {
                id: 'INIT_STATE',
                label: 'Incorrect initialization',
                description: 'Uses uninitialized values or starts with the wrong initial state.',
                points: 20,
            },
            {
                id: 'STATE_MISUSE',
                label: 'Incorrect variable or state use',
                description: 'Wrong variable used, wrong type behavior (truncation), overwritten state, or flag not managed correctly.',
                points: 15,
            },
            {
                id: 'COMPUTE',
                label: 'Incorrect computation',
                description: 'Wrong formula, precedence, numeric operation, or derived value.',
                points: 20,
            },
            {
                id: 'CONDITION',
                label: 'Incorrect condition logic',
                description: 'Incorrect comparison, boundary, compound logic, or missing edge case handling.',
                points: 15,
            },
            {
                id: 'BRANCHING',
                label: 'Incorrect branching structure',
                description:
                    'Wrong if/elif/else structure (misbound else), missing default case, or missing break in selection-like logic.',
                points: 15,
            },
            {
                id: 'LOOP',
                label: 'Incorrect loop logic',
                description: 'Wrong bounds/termination, update/control error, off-by-one, wrong nesting, or accumulation error.',
                points: 20,
            },
            {
                id: 'INDEXING',
                label: 'Incorrect indexing or collection setup',
                description: 'Out-of-bounds, wrong base/range, or incorrect array/string/list setup (size or contents).',
                points: 20,
            },
            {
                id: 'FUNCTIONS',
                label: 'Incorrect function behavior or use',
                description: 'Wrong return behavior (missing/ignored/wrong type) or incorrect function use (scope/order/unnecessary re-calls).',
                points: 15,
            },
            {
                id: 'COMPILE',
                label: 'Program did not compile',
                description:
                    'Code fails to compile or run due to syntax errors, missing imports/includes, or build/runtime errors that prevent execution.',
                points: 40,
            },
        ],
        [],
    )

    const ERROR_MAP = useMemo<Record<string, ErrorOption>>(() => {
        const map: Record<string, ErrorOption> = {}
        for (const err of ERROR_DEFS) map[err.id] = err
        return map
    }, [ERROR_DEFS])

    // AI suggestions (dynamic, based on selected lines + failing diffs)
    const [aiSuggestionIds, setAiSuggestionIds] = useState<string[]>([])
    const [aiSuggestStatus, setAiSuggestStatus] = useState<'idle' | 'loading' | 'error'>('idle')
    const [aiSuggestError, setAiSuggestError] = useState<string | null>(null)
    const lastAiKeyRef = useRef<string>('')
    const aiAbortRef = useRef<AbortController | null>(null)

    const getSelectedCodeFromDom = (range: LineRange): string => {
        const lines: string[] = []
        for (let ln = range.start; ln <= range.end; ln++) {
            const el = lineRefs.current[ln]
            if (!el) continue
            // Try to strip leading line number if it appears in textContent.
            const raw = (el.textContent ?? '').replace(/\u00A0/g, ' ').trimEnd()
            const stripped = raw.replace(/^\s*\d+\s+/, '')
            lines.push(stripped)
        }
        return lines.join('\n').trim()
    }

    const requestAiSuggestions = async (range: LineRange) => {
        const key = `${submissionId}:${range.start}-${range.end}`
        if (lastAiKeyRef.current === key) return
        lastAiKeyRef.current = key

        const selectedCode = getSelectedCodeFromDom(range)
        if (!selectedCode) {
            setAiSuggestionIds([])
            setAiSuggestStatus('idle')
            setAiSuggestError(null)
            return
        }

        // Cancel any in-flight request to avoid race conditions while selecting.
        if (aiAbortRef.current) aiAbortRef.current.abort()
        const ctrl = new AbortController()
        aiAbortRef.current = ctrl

        setAiSuggestStatus('loading')
        setAiSuggestError(null)

        try {
            const res = await axios.post(
                `${import.meta.env.VITE_API_URL}/ai/grading-suggestions`,
                {
                    submissionId: submissionId,
                    startLine: range.start,
                    endLine: range.end,
                    selectedCode: selectedCode,
                    testcaseName: activeTestcaseName,
                    testcaseLongDiff: activeTestcaseLongDiff,
                },
                {
                    headers: {
                        Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}`,
                    },
                    signal: ctrl.signal,
                }
            )

            const ids = Array.isArray(res.data?.suggestions) ? res.data.suggestions : []
            setAiSuggestionIds(ids)
            setAiSuggestStatus('idle')
        } catch (e: any) {
            // Ignore abort errors
            if (e?.name === 'CanceledError' || e?.code === 'ERR_CANCELED') return
            setAiSuggestStatus('error')
            setAiSuggestError('AI suggestion request failed.')
            setAiSuggestionIds([])
        }
    }

    const totalPoints = useMemo(() => {
        return observedErrors
            .reduce((sum, err) => sum + (ERROR_MAP[err.errorId]?.points ?? 0), 0)
    }, [observedErrors, ERROR_MAP])

    const grade = Math.max(0, 100 - totalPoints)

    // Line hover and selection
    const [hoveredLine, setHoveredLine] = useState<number | null>(null)
    const [initialLine, setInitialLine] = useState<number | null>(null)
    const [selectedRange, setSelectedRange] = useState<LineRange | null>(null)
    const selectedRangeRef = useRef<LineRange | null>(null)
    useEffect(() => {
        selectedRangeRef.current = selectedRange
    }, [selectedRange])

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

    // Only request AI suggestions once the selection is finalized (initialLine becomes null),
    // and also when selection is set from elsewhere (ex: Grading Summary and Save click).
    useEffect(() => {
        if (initialLine !== null) return
        if (selectedRange === null) {
            setAiSuggestionIds([])
            setAiSuggestStatus('idle')
            setAiSuggestError(null)
            lastAiKeyRef.current = ''
            return
        }
        requestAiSuggestions(selectedRange)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedRange, initialLine])

    // References for code lines
    const codeContainerRef = useRef<HTMLDivElement | null>(null)
    const lineRefs = useRef<Record<number, HTMLLIElement | null>>({})

    const scrollToLine = (lineNo: number) => {
        const el = lineRefs.current[lineNo]
        if (!el) return
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }

    // Ctrl+F style find (commits on Enter)
    const [findInput, setFindInput] = useState<string>('')
    const [findQuery, setFindQuery] = useState<string>('') // last committed query
    const [findMatches, setFindMatches] = useState<number[]>([])
    const [findMatchIndex, setFindMatchIndex] = useState<number>(0)

    const findMatchSet = useMemo(() => new Set(findMatches), [findMatches])
    const activeFindLine = findMatches.length > 0 ? findMatches[findMatchIndex] : null

    const performFind = (rawQuery: string) => {
        const needle = rawQuery.trim()
        if (!needle) {
            setFindQuery('')
            setFindMatches([])
            setFindMatchIndex(0)
            return
        }

        const lowerNeedle = needle.toLowerCase()
        const lineNos = Object.keys(lineRefs.current)
            .map((k) => Number(k))
            .filter((n) => Number.isFinite(n))
            .sort((a, b) => a - b)

        const matches: number[] = []
        for (const ln of lineNos) {
            const el = lineRefs.current[ln]
            if (!el) continue
            const hay = (el.textContent ?? '').replace(/\u00A0/g, ' ').toLowerCase()
            if (hay.includes(lowerNeedle)) matches.push(ln)
        }

        setFindQuery(needle)
        setFindMatches(matches)
        setFindMatchIndex(0)
        if (matches.length > 0) scrollToLine(matches[0])
    }

    const stepFind = (dir: 1 | -1) => {
        if (findMatches.length === 0) return
        setFindMatchIndex((prev) => {
            const next = (prev + dir + findMatches.length) % findMatches.length
            scrollToLine(findMatches[next])
            return next
        })
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
                onActiveTestcaseChange={(tc) => {
                    // Only feed diffs to AI when the testcase is failing and has a long diff.
                    if (!tc || tc.passed) {
                        setActiveTestcaseName('')
                        setActiveTestcaseLongDiff('')
                        return
                    }
                    setActiveTestcaseName(tc.name ?? '')
                    setActiveTestcaseLongDiff(tc.longDiff ?? '')
                }}
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
                    const isFindMatch = findMatchSet.has(lineNo)
                    const isFindActive = activeFindLine === lineNo
                    return [
                        errors ? 'has-error' : '',
                        hoveredLine === lineNo ? 'is-hovered' : '',
                        isRangeSelected(lineNo, lineNo) ? 'is-selected' : '',
                        isFindMatch ? 'is-find-match' : '',
                        isFindActive ? 'is-find-active' : '',
                    ]
                        .filter(Boolean)
                        .join(' ')
                }}
                onLineMouseDown={(lineNo) => handleMouseDown(lineNo)}
                onLineMouseEnter={(lineNo) => handleMouseEnter(lineNo)}
                onLineMouseLeave={() => setHoveredLine(null)}
                onLineMouseUp={() => handleMouseUp()}


                belowCode={
                    <section className="all-observed-section" aria-label="Grading Summary and Save" ref={allObservedErrorsRef}>
                        <h2 className="section-title">Grading Summary and Save</h2>
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
                                                        const pts = meta?.points ?? 0

                                                        return (
                                                            <div key={`${start}-${end}-${err.errorId}-${idx}`} className="all-errors-item">
                                                                <span className="all-errors-item-label">{label}</span>
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
                }


                rightPanel={
                    <aside className="grading-panel" aria-label="Grading panel">

                        <div className="grading-panel-header">
                            <div className="grading-title">Grading Panel</div>
                            <div className="grading-hint">
                                {!selectedRange ? 'Select a line to start.' : 'Add errors to the selected line(s).'}
                            </div>
                        </div>

                        <div className="find-bar" role="search" aria-label="Find in code">
                            <input
                                className="find-input"
                                type="text"
                                placeholder="Find in code (Enter to search)"
                                value={findInput}
                                onChange={(e) => setFindInput(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key !== 'Enter') return
                                    e.preventDefault()

                                    const nextQuery = findInput.trim()
                                    // If query changed, run a fresh search and jump to first match.
                                    if (nextQuery !== findQuery) {
                                        performFind(findInput)
                                        return
                                    }
                                    // If query is the same, behave like Ctrl+F Enter: jump to next (Shift+Enter: previous).
                                    stepFind(e.shiftKey ? -1 : 1)
                                }}
                            />

                            <div className="find-count" aria-label="Match count">
                                {findMatches.length === 0 ? '0/0' : `${findMatchIndex + 1}/${findMatches.length}`}
                            </div>

                            <div className="find-nav" aria-label="Find navigation">
                                <button
                                    type="button"
                                    className="find-nav-btn"
                                    disabled={findMatches.length === 0}
                                    onClick={() => stepFind(-1)}
                                    title="Previous match (Shift+Enter)"
                                >
                                    ‹
                                </button>
                                <button
                                    type="button"
                                    className="find-nav-btn"
                                    disabled={findMatches.length === 0}
                                    onClick={() => stepFind(1)}
                                    title="Next match (Enter)"
                                >
                                    ›
                                </button>
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
                                    Grading Summary and Save
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
                                {aiSuggestStatus === 'loading' && (
                                    <div className="muted small">Generating suggestions...</div>
                                )}

                                {aiSuggestStatus === 'error' && (
                                    <div className="muted small">
                                        {aiSuggestError ?? 'AI error.'}{' '}
                                        <button
                                            type="button"
                                            className="linklike"
                                            disabled={selectedRange === null}
                                            onClick={() => {
                                                if (!selectedRangeRef.current) return
                                                // Allow retry even if same key
                                                lastAiKeyRef.current = ''
                                                requestAiSuggestions(selectedRangeRef.current)
                                            }}
                                        >
                                            Retry
                                        </button>
                                    </div>
                                )}

                                {aiSuggestStatus === 'idle' && selectedRange !== null && aiSuggestionIds.length === 0 && (
                                    <div className="muted small">No suggestions yet for this selection.</div>
                                )}

                                {aiSuggestStatus !== 'loading' &&
                                    aiSuggestionIds.map((errorId) => {
                                        const meta = ERROR_MAP[errorId]
                                        const label = meta?.label ?? errorId
                                        const pts = meta?.points ?? 0
                                        return (
                                            <button
                                                key={`ai-${errorId}`}
                                                type="button"
                                                className="suggestion-btn"
                                                disabled={selectedRange === null}
                                                onClick={() => {
                                                    if (selectedRange === null) return
                                                    addError(selectedRange.start, selectedRange.end, errorId)
                                                }}
                                            >
                                                <div className="suggestion-top">
                                                    <span className="suggestion-title">{label}</span>
                                                    <span className="suggestion-points">-{pts}</span>
                                                </div>
                                            </button>
                                        )
                                    })}
                            </div>
                        </div>

                        <div className="grading-section">
                            <details className="all-errors-picker" defaultChecked={false}>
                                <summary className="all-errors-picker-header">
                                    <span className="all-errors-picker-title">All errors</span>
                                    <span className="all-errors-picker-count">{ERROR_DEFS.length}</span>
                                </summary>
                                <div className="all-errors-picker-body">
                                    <div className="error-options-list">
                                        {ERROR_DEFS.map((err) => (
                                            <button
                                                key={err.id}
                                                type="button"
                                                className="error-option-btn"
                                                disabled={selectedRange === null}
                                                title={err.description}
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
        </div>
    )
}

export default AdminGrading