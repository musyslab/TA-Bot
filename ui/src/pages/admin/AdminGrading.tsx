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

type ObservedError = {
    startLine: number
    endLine: number
    errorId: string
    count: number
}

type LineRange = {
    start: number
    end: number
}

type ScoringMode = 'perInstance' | 'flatPerError'

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

    // Scoring mode:
    // - perInstance: points deducted per instance (count matters for grading)
    // - flatPerError: points deducted once if error exists on a selected range (count does not affect grading)
    const [scoringMode, setScoringMode] = useState<ScoringMode>('perInstance')

    const BASE_ERROR_DEFS = useMemo<ErrorOption[]>(
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

    // Points are now editable (global per errorId for this grading session/page).
    const [errorPoints, setErrorPoints] = useState<Record<string, number>>(() => {
        const m: Record<string, number> = {}
        for (const e of BASE_ERROR_DEFS) m[e.id] = e.points
        return m
    })

    const ERROR_DEFS = useMemo<ErrorOption[]>(
        () =>
            BASE_ERROR_DEFS.map((e) => ({
                ...e,
                points: Number.isFinite(errorPoints[e.id]) ? Math.max(0, errorPoints[e.id]) : e.points,
            })),
        [BASE_ERROR_DEFS, errorPoints],
    )

    const ERROR_MAP = useMemo<Record<string, ErrorOption>>(() => {
        const map: Record<string, ErrorOption> = {}
        for (const err of ERROR_DEFS) map[err.id] = err
        return map
    }, [ERROR_DEFS])

    const bumpErrorPoints = (errorId: string, delta: number) => {
        if (!delta) return
        setErrorPoints((prev) => {
            const cur = Number.isFinite(prev[errorId]) ? prev[errorId] : 0
            const next = Math.max(0, cur + delta)
            return { ...prev, [errorId]: next }
        })
        setSaveStatus('idle')
    }

    // AI suggestions (dynamic, based on selected lines + failing diffs)
    const [aiSuggestionIds, setAiSuggestionIds] = useState<string[]>([])
    const [aiSuggestStatus, setAiSuggestStatus] = useState<'idle' | 'loading' | 'error'>('idle')
    const [aiSuggestError, setAiSuggestError] = useState<string | null>(null)
    const lastAiKeyRef = useRef<string>('')
    const aiAbortRef = useRef<AbortController | null>(null)

    // References for code lines
    const codeContainerRef = useRef<HTMLDivElement | null>(null)
    const lineRefs = useRef<Record<number, HTMLLIElement | null>>({})

    const errorCountByKey = useMemo(() => {
        const m: Record<string, number> = {}
        for (const e of observedErrors) {
            m[`${e.startLine}-${e.endLine}-${e.errorId}`] = e.count
        }
        return m
    }, [observedErrors])

    const getErrorCount = (start: number, end: number, errorId: string) => {
        return errorCountByKey[`${start}-${end}-${errorId}`] ?? 0
    }

    // Adjust COUNT (instances) via separate + / - buttons
    const bumpErrorCount = (start: number, end: number, errorId: string, delta: number) => {
        if (delta === 0) return

        setObservedErrors((prev) => {
            const idx = prev.findIndex((e) => e.startLine === start && e.endLine === end && e.errorId === errorId)
            if (idx === -1) {
                if (delta < 0) return prev
                return [...prev, { startLine: start, endLine: end, errorId: errorId, count: delta }]
            }

            const next = [...prev]
            const cur = next[idx]
            const nextCount = (cur.count ?? 1) + delta

            if (nextCount <= 0) {
                next.splice(idx, 1)
            } else {
                next[idx] = { ...cur, count: nextCount }
            }
            return next
        })

        setSaveStatus('idle')
    }

    const scrollToLine = (lineNo: number) => {
        const el = lineRefs.current[lineNo]
        if (!el) return
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }

    const getSelectedCodeFromDom = (range: LineRange): string => {
        const lines: string[] = []
        for (let ln = range.start; ln <= range.end; ln++) {
            const el = lineRefs.current[ln]
            if (!el) continue
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
                },
            )

            const ids = Array.isArray(res.data?.suggestions) ? res.data.suggestions : []
            setAiSuggestionIds(ids)
            setAiSuggestStatus('idle')
        } catch (e: any) {
            if (e?.name === 'CanceledError' || e?.code === 'ERR_CANCELED') return
            setAiSuggestStatus('error')
            setAiSuggestError('AI suggestion request failed.')
            setAiSuggestionIds([])
        }
    }

    const computeDeduction = (errorId: string, count: number) => {
        const pts = ERROR_MAP[errorId]?.points ?? 0
        if (scoringMode === 'flatPerError') return pts
        return pts * Math.max(1, count)
    }

    const totalPoints = useMemo(() => {
        if (scoringMode === 'flatPerError') {
            const uniq = new Set<string>()
            for (const e of observedErrors) uniq.add(e.errorId)
            let sum = 0
            for (const id of uniq) sum += ERROR_MAP[id]?.points ?? 0
            return sum
        }

        return observedErrors.reduce((sum, err) => sum + computeDeduction(err.errorId, err.count ?? 1), 0)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [observedErrors, ERROR_MAP, scoringMode])

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

    const handleMouseDown = (line: number) => {
        setInitialLine(line)
        selectLines(line, line)
    }

    const handleMouseEnter = (line: number) => {
        setHoveredLine(line)
        if (initialLine === null) return
        setSelectedRange({
            start: Math.min(initialLine, line),
            end: Math.max(initialLine, line),
        })
    }

    const handleMouseUp = () => {
        setInitialLine(null)
    }

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
                },
            )
            .then((res) => {
                const data = res.data
                const entry = Object.entries(data).find(
                    ([_, value]) => parseInt((value as Array<string>)[7], 10) === submissionId,
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

                // Supports either:
                // - legacy: [{startLine,endLine,errorId}, ...] (duplicates imply multiple counts)
                // - counted: [{startLine,endLine,errorId,count}, ...]
                for (const item of errors as Array<any>) {
                    const start = Number(item.startLine)
                    const end = Number(item.endLine)
                    const errorId = String(item.errorId)
                    const count = Number.isFinite(Number(item.count)) ? Math.max(1, Number(item.count)) : 1
                    bumpErrorCount(start, end, errorId, count)
                }
            })
            .catch((err) => console.error('Could not load saved grading:', err))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [submissionId])

    // Handles saving grading errors
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

    const serializeErrorsForSave = (errs: ObservedError[]) => {
        // Keep backend compatibility by flattening counts into repeated entries.
        const flat: Array<{ startLine: number; endLine: number; errorId: string }> = []
        for (const e of errs) {
            const c = Math.max(1, Number(e.count ?? 1))
            for (let i = 0; i < c; i++) {
                flat.push({ startLine: e.startLine, endLine: e.endLine, errorId: e.errorId })
            }
        }
        return flat
    }

    const handleSave = () => {
        setSaveStatus('saving')

        axios
            .post(
                `${import.meta.env.VITE_API_URL}/submissions/save-grading`,
                {
                    submissionId: submissionId,
                    grade: grade,
                    errors: serializeErrorsForSave(observedErrors),
                },
                {
                    headers: {
                        Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}`,
                    },
                },
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
            }, {} as Record<string, [number, number, ObservedError[]]>),
        ).sort((a, b) => {
            const [aStart, aEnd] = a
            const [bStart, bEnd] = b
            if (aStart !== bStart) return aStart - bStart
            return aEnd - bEnd
        })
    }, [observedErrors])

    const selectedRangeErrors = selectedRange !== null ? observedErrors.filter((err) => isRangeSelected(err.startLine, err.endLine)) : []

    const selectedRangeCountsByErrorId = useMemo(() => {
        const m: Record<string, number> = {}
        if (!selectedRange) return m
        for (const e of observedErrors) {
            if (e.startLine === selectedRange.start && e.endLine === selectedRange.end) {
                m[e.errorId] = e.count
            }
        }
        return m
    }, [observedErrors, selectedRange])

    return (
        <div className="page-container" id="admin-output-diff">
            <Helmet>
                <title>TA-Bot</title>
            </Helmet>
            <MenuComponent showUpload={false} showAdminUpload={false} showHelp={false} showCreate={false} showLast={false} showReviewButton={false} />

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
                    const errors = observedErrors.some((err) => err.startLine <= lineNo && err.endLine >= lineNo)
                    const isFindMatch = findMatchSet.has(lineNo)
                    const isFindActive = activeFindLine === lineNo
                    return [errors ? 'has-error' : '', hoveredLine === lineNo ? 'is-hovered' : '', isRangeSelected(lineNo, lineNo) ? 'is-selected' : '', isFindMatch ? 'is-find-match' : '', isFindActive ? 'is-find-active' : '']
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
                                    <div className="grade-stack">
                                        <div className="grade-value">{grade}</div>
                                        <div className="grade-mode">{scoringMode === 'perInstance' ? 'Per-instance scoring' : 'Flat per-error scoring'}</div>
                                    </div>
                                </div>

                                <button className="save-grade">Save as draft</button>

                                <button className={`save-grade ${saveStatus}`} onClick={handleSave} disabled={saveStatus === 'saving'}>
                                    {saveStatus === 'idle' && 'Save'}
                                    {saveStatus === 'saving' && 'Saving...'}
                                    {saveStatus === 'saved' && 'Saved!'}
                                    {saveStatus === 'error' && 'Error'}
                                </button>

                                <div className="scoring-toggle" role="group" aria-label="Scoring mode toggle">
                                    <button type="button" className={`toggle-btn ${scoringMode === 'perInstance' ? 'active' : ''}`} onClick={() => setScoringMode('perInstance')}>
                                        Per instance
                                    </button>
                                    <button type="button" className={`toggle-btn ${scoringMode === 'flatPerError' ? 'active' : ''}`} onClick={() => setScoringMode('flatPerError')}>
                                        Flat per error
                                    </button>
                                </div>

                                {saveStatus === 'error' && <div className="muted small save-status">Save failed. Try again.</div>}
                                {saveStatus === 'saved' && <div className="muted small save-status">Saved to the database.</div>}
                            </div>

                            {!hasErrors && <div className="muted">No errors added yet.</div>}

                            {hasErrors && (
                                <div className="all-errors">
                                    {tableRows.map(([start, end, errors]) => {
                                        const totalPointsForRange =
                                            scoringMode === 'flatPerError'
                                                ? (() => {
                                                    const uniq = new Set<string>()
                                                    for (const e of errors) uniq.add(e.errorId)
                                                    let sum = 0
                                                    for (const id of uniq) sum += ERROR_MAP[id]?.points ?? 0
                                                    return sum
                                                })()
                                                : errors.reduce((sum, e) => sum + computeDeduction(e.errorId, e.count ?? 1), 0)
                                        const totalCountForRange = errors.reduce((sum, e) => sum + (e.count ?? 1), 0)

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
                                                    <span className="all-errors-line-title">{start === end ? `Line ${start}` : `Lines ${start}-${end}`}</span>
                                                    <span className="all-errors-line-meta">
                                                        {totalCountForRange} {totalCountForRange === 1 ? 'instance' : 'instances'}, -{totalPointsForRange}
                                                    </span>
                                                </button>

                                                <div className="all-errors-line-body">
                                                    {errors.map((err, idx) => {
                                                        const meta = ERROR_MAP[err.errorId]
                                                        const label = meta?.label ?? err.errorId
                                                        const desc = meta?.description ?? ''
                                                        const count = Math.max(1, err.count ?? 1)
                                                        const shownDeduction = computeDeduction(err.errorId, count)

                                                        return (
                                                            <div key={`${start}-${end}-${err.errorId}-${idx}`} className="all-errors-item" title={desc}>
                                                                <div className="all-errors-item-left">
                                                                    <span className="all-errors-item-label">{label}</span>

                                                                    <div className="instance-box" aria-label="Instances">
                                                                        <span className={`count-badge ${count > 0 ? 'active' : ''}`}>x{count}</span>
                                                                        <div className="count-controls" aria-label="Adjust count">
                                                                            <button
                                                                                type="button"
                                                                                className="count-btn plus"
                                                                                onClick={() => bumpErrorCount(start, end, err.errorId, 1)}
                                                                                aria-label="Increase count"
                                                                                title="Increase count"
                                                                            >
                                                                                +
                                                                            </button>
                                                                            {getErrorCount(start, end, err.errorId) > 0 && (
                                                                                <button
                                                                                    type="button"
                                                                                    className="count-btn minus"
                                                                                    onClick={() => bumpErrorCount(start, end, err.errorId, -1)}
                                                                                    aria-label="Decrease count"
                                                                                    title="Decrease count"
                                                                                >
                                                                                    −
                                                                                </button>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                </div>

                                                                <div className="points-box" aria-label="Point deduction">
                                                                    <span className="deduction-value">-{shownDeduction}</span>
                                                                    <div className="points-controls" aria-label="Adjust points">
                                                                        <button
                                                                            type="button"
                                                                            className="points-btn plus"
                                                                            onClick={() => bumpErrorPoints(err.errorId, 1)}
                                                                            aria-label="Increase points for this error type"
                                                                            title="Increase points"
                                                                        >
                                                                            +
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            className="points-btn minus"
                                                                            onClick={() => bumpErrorPoints(err.errorId, -1)}
                                                                            disabled={(ERROR_MAP[err.errorId]?.points ?? 0) <= 0}
                                                                            aria-label="Decrease points for this error type"
                                                                            title="Decrease points"
                                                                        >
                                                                            −
                                                                        </button>
                                                                    </div>
                                                                </div>
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
                            <div className="grading-hint">{!selectedRange ? 'Select a line to start.' : 'Add errors to the selected line(s).'}</div>
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
                                    if (nextQuery !== findQuery) {
                                        performFind(findInput)
                                        return
                                    }
                                    stepFind(e.shiftKey ? -1 : 1)
                                }}
                            />

                            <div className="find-count" aria-label="Match count">
                                {findMatches.length === 0 ? '0/0' : `${findMatchIndex + 1}/${findMatches.length}`}
                            </div>

                            <div className="find-nav" aria-label="Find navigation">
                                <button type="button" className="find-nav-btn" disabled={findMatches.length === 0} onClick={() => stepFind(-1)} title="Previous match (Shift+Enter)">
                                    ‹
                                </button>
                                <button type="button" className="find-nav-btn" disabled={findMatches.length === 0} onClick={() => stepFind(1)} title="Next match (Enter)">
                                    ›
                                </button>
                            </div>
                        </div>

                        <div className="navigation-section">
                            <div className="navigation-header">Jump To</div>
                            <ul className="navigation-list">
                                <li className="navigation-item" onClick={() => (diffViewRef.current !== null ? scrollToSection(diffViewRef.current) : null)}>
                                    Test Cases
                                </li>
                                <li className="navigation-item" onClick={() => (allObservedErrorsRef.current !== null ? scrollToSection(allObservedErrorsRef.current) : null)}>
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
                                    onClick={() => (selectedRange !== null ? scrollToLine(selectedRange.start) : null)}
                                    title="Click to jump to selected line"
                                >
                                    {selectedRange === null ? 'None' : selectedRange.start === selectedRange.end ? `Line ${selectedRange.start}` : `Lines ${selectedRange.start}-${selectedRange.end}`}
                                </button>
                            </div>
                        </div>

                        <div className="grading-section">
                            <div className="section-label">AI suggestions</div>
                            <div className="suggestions-grid">
                                {aiSuggestStatus === 'loading' && <div className="muted small">Generating suggestions...</div>}

                                {aiSuggestStatus === 'error' && (
                                    <div className="muted small">
                                        {aiSuggestError ?? 'AI error.'}{' '}
                                        <button
                                            type="button"
                                            className="linklike"
                                            disabled={selectedRange === null}
                                            onClick={() => {
                                                if (!selectedRangeRef.current) return
                                                lastAiKeyRef.current = ''
                                                requestAiSuggestions(selectedRangeRef.current)
                                            }}
                                        >
                                            Retry
                                        </button>
                                    </div>
                                )}

                                {aiSuggestStatus === 'idle' && selectedRange !== null && aiSuggestionIds.length === 0 && <div className="muted small">No suggestions yet for this selection.</div>}

                                {aiSuggestStatus !== 'loading' &&
                                    aiSuggestionIds.map((errorId) => {
                                        const meta = ERROR_MAP[errorId]
                                        const label = meta?.label ?? errorId
                                        const pts = meta?.points ?? 0
                                        const desc = meta?.description ?? ''
                                        const count = selectedRange === null ? 0 : selectedRangeCountsByErrorId[errorId] ?? 0
                                        const shownDeduction = selectedRange === null ? 0 : computeDeduction(errorId, Math.max(1, count))

                                        return (
                                            <div key={`ai-${errorId}`} className="suggestion-card" title={desc}>
                                                <div className="suggestion-top">
                                                    <span className="suggestion-title">{label}</span>
                                                </div>

                                                <div className="suggestion-bottom">
                                                    <div className="instance-box" aria-label="Instances">
                                                        <span className={`count-badge ${count > 0 ? 'active' : ''}`}>x{count}</span>
                                                        <div className="count-controls" aria-label="Adjust count">
                                                            <button
                                                                type="button"
                                                                className="count-btn plus"
                                                                disabled={selectedRange === null}
                                                                onClick={() => {
                                                                    if (selectedRange === null) return
                                                                    bumpErrorCount(selectedRange.start, selectedRange.end, errorId, 1)
                                                                }}
                                                                aria-label="Increase count"
                                                                title="Increase count"
                                                            >
                                                                +
                                                            </button>
                                                            {selectedRange !== null && count > 0 && (
                                                                <button
                                                                    type="button"
                                                                    className="count-btn minus"
                                                                    onClick={() => bumpErrorCount(selectedRange.start, selectedRange.end, errorId, -1)}
                                                                    aria-label="Decrease count"
                                                                    title="Decrease count"
                                                                >
                                                                    −
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>

                                                    <div className="points-box" aria-label="Point deduction">
                                                        <span className="deduction-value">{selectedRange === null ? `-${pts}` : `-${shownDeduction}`}</span>
                                                        <div className="points-controls" aria-label="Adjust points">
                                                            <button
                                                                type="button"
                                                                className="points-btn plus"
                                                                onClick={() => bumpErrorPoints(errorId, 1)}
                                                                aria-label="Increase points for this error type"
                                                                title="Increase points"
                                                            >
                                                                +
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="points-btn minus"
                                                                onClick={() => bumpErrorPoints(errorId, -1)}
                                                                disabled={pts <= 0}
                                                                aria-label="Decrease points for this error type"
                                                                title="Decrease points"
                                                            >
                                                                −
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        )
                                    })}
                            </div>
                        </div>

                        <div className="grading-section">
                            <details className="all-errors-picker" defaultChecked={false as any}>
                                <summary className="all-errors-picker-header">
                                    <span className="all-errors-picker-title">All errors</span>
                                    <span className="all-errors-picker-count">{ERROR_DEFS.length}</span>
                                </summary>
                                <div className="all-errors-picker-body">
                                    <div className="error-options-list">
                                        {ERROR_DEFS.map((err) => {
                                            const count = selectedRange ? selectedRangeCountsByErrorId[err.id] ?? 0 : 0
                                            const shownDeduction = selectedRange === null ? err.points : computeDeduction(err.id, Math.max(1, count))

                                            return (
                                                <div key={err.id} className="suggestion-card" title={err.description}>
                                                    <div className="suggestion-top">
                                                        <span className="suggestion-title">{err.label}</span>
                                                    </div>

                                                    <div className="suggestion-bottom">
                                                        <div className="instance-box" aria-label="Instances">
                                                            <span className={`count-badge ${count > 0 ? 'active' : ''}`}>x{count}</span>
                                                            <div className="count-controls" aria-label="Adjust count">
                                                                <button
                                                                    type="button"
                                                                    className="count-btn plus"
                                                                    disabled={selectedRange === null}
                                                                    onClick={() => {
                                                                        if (selectedRange === null) return
                                                                        bumpErrorCount(selectedRange.start, selectedRange.end, err.id, 1)
                                                                    }}
                                                                    aria-label="Increase count"
                                                                    title="Increase count"
                                                                >
                                                                    +
                                                                </button>
                                                                {selectedRange !== null && count > 0 && (
                                                                    <button
                                                                        type="button"
                                                                        className="count-btn minus"
                                                                        onClick={() => bumpErrorCount(selectedRange.start, selectedRange.end, err.id, -1)}
                                                                        aria-label="Decrease count"
                                                                        title="Decrease count"
                                                                    >
                                                                        −
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </div>

                                                        <div className="points-box" aria-label="Point deduction">
                                                            <span className="deduction-value">-{shownDeduction}</span>
                                                            <div className="points-controls" aria-label="Adjust points">
                                                                <button
                                                                    type="button"
                                                                    className="points-btn plus"
                                                                    onClick={() => bumpErrorPoints(err.id, 1)}
                                                                    aria-label="Increase points for this error type"
                                                                    title="Increase points"
                                                                >
                                                                    +
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    className="points-btn minus"
                                                                    onClick={() => bumpErrorPoints(err.id, -1)}
                                                                    disabled={err.points <= 0}
                                                                    aria-label="Decrease points for this error type"
                                                                    title="Decrease points"
                                                                >
                                                                    −
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </div>
                                </div>
                            </details>

                            {selectedRange === null && <div className="muted small">Select a line to enable adjusting.</div>}
                        </div>

                        <div className="grading-section">
                            <div className="section-label">Errors on selected line(s)</div>

                            {selectedRange === null && <div className="muted">No line selected.</div>}

                            {selectedRange !== null && selectedRangeErrors.length === 0 && <div className="muted">No errors on this line.</div>}

                            {selectedRange !== null && selectedRangeErrors.length > 0 && (
                                <div className="line-error-list">
                                    {selectedRangeErrors.map((err, idx) => {
                                        const meta = ERROR_MAP[err.errorId]
                                        const label = meta?.label ?? err.errorId
                                        const desc = meta?.description ?? ''
                                        const count = Math.max(1, err.count ?? 1)
                                        const shownDeduction = computeDeduction(err.errorId, count)
                                        const ptsNow = meta?.points ?? 0
                                        const rangeLabel = err.startLine === err.endLine ? `Line ${err.startLine}` : `Lines ${err.startLine}-${err.endLine}`

                                        return (
                                            <div key={`${err.startLine}-${err.endLine}-${err.errorId}-${idx}`} className="suggestion-card" title={desc}>
                                                <div className="suggestion-top">
                                                    <span className="suggestion-title">{label}</span>
                                                    <span className="muted small">{rangeLabel}</span>
                                                </div>

                                                <div className="suggestion-bottom">
                                                    <div className="instance-box" aria-label="Instances">
                                                        <span className={`count-badge ${count > 0 ? 'active' : ''}`}>x{count}</span>
                                                        <div className="count-controls" aria-label="Adjust count">
                                                            <button
                                                                type="button"
                                                                className="count-btn plus"
                                                                onClick={() => bumpErrorCount(err.startLine, err.endLine, err.errorId, 1)}
                                                                aria-label="Increase count"
                                                                title="Increase count"
                                                            >
                                                                +
                                                            </button>
                                                            {getErrorCount(err.startLine, err.endLine, err.errorId) > 0 && (
                                                                <button
                                                                    type="button"
                                                                    className="count-btn minus"
                                                                    onClick={() => bumpErrorCount(err.startLine, err.endLine, err.errorId, -1)}
                                                                    aria-label="Decrease count"
                                                                    title="Decrease count"
                                                                >
                                                                    −
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>

                                                    <div className="points-box" aria-label="Point deduction">
                                                        <span className="deduction-value">-{shownDeduction}</span>
                                                        <div className="points-controls" aria-label="Adjust points">
                                                            <button
                                                                type="button"
                                                                className="points-btn plus"
                                                                onClick={() => bumpErrorPoints(err.errorId, 1)}
                                                                aria-label="Increase points for this error type"
                                                                title="Increase points"
                                                            >
                                                                +
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="points-btn minus"
                                                                onClick={() => bumpErrorPoints(err.errorId, -1)}
                                                                disabled={ptsNow <= 0}
                                                                aria-label="Decrease points for this error type"
                                                                title="Decrease points"
                                                            >
                                                                −
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
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