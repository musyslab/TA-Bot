// AdminGrading.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import { useParams } from 'react-router-dom'
import { Helmet } from 'react-helmet'
import MenuComponent from '../components/MenuComponent'
import { FaRegCheckSquare, FaChevronDown } from 'react-icons/fa'
import "../../styling/AdminGrading.scss";
import { diffChars } from 'diff'
import { Highlight, themes } from "prism-react-renderer";
import DirectoryBreadcrumbs from '../components/DirectoryBreadcrumbs'

const defaultpagenumber = -1

type DiffMode = 'short' | 'long'

type NewJsonResult = {
    name: string
    description?: string
    passed: boolean
    shortDiff?: string
    longDiff?: string
    shortDiffSameAsLong?: boolean
}

type LegacyJsonTest = {
    output?: Array<string>
    type?: number
    description?: string
    name?: string
}

type LegacyJsonResult = {
    skipped?: boolean
    passed?: boolean
    test?: LegacyJsonTest
}

type AnyPayload = {
    results?: any[]
}

type DiffEntry = {
    id: string
    num: number
    test: string
    description: string
    status: string
    passed: boolean
    skipped: boolean
    shortDiff: string
    longDiff: string
    shortDiffSameAsLong: boolean
}

type CodeFile = {
    name: string
    content: string
}
type BackendError = {
    line: number;
    errorId: string;
}
type Seg = { text: string; changed: boolean }
const MAX_CHANGE_RATIO_FOR_INTRA = 0.7

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

function normalizeNewlines(text: string) {
    return (text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function safeJsonParse(maybe: any): any {
    if (typeof maybe !== 'string') return maybe
    const s = maybe.trim()
    if (!s) return maybe
    if (!(s.startsWith('{') || s.startsWith('['))) return maybe
    try {
        return JSON.parse(s)
    } catch {
        return maybe
    }
}

// Legacy: older grader encoded expected/actual in output blocks
function parseLegacyOutputs(raw: string): { expected: string; actual: string; hadDiff: boolean } {
    const txt = raw ?? ''
    if (txt.includes('~~~diff~~~')) {
        const [userPart, expectedPart = ''] = txt.split('~~~diff~~~')
        return { expected: expectedPart, actual: userPart, hadDiff: true }
    }

    const lines = txt.replace(/\r\n/g, '\n').split('\n')
    const expectedLines: string[] = []
    const actualLines: string[] = []
    let sawDiffMarker = false

    for (const l of lines) {
        const t = l.trimStart()
        if (t.startsWith('---')) {
            sawDiffMarker = true
            continue
        }
        if (t.startsWith('< ')) {
            expectedLines.push(t.slice(2))
            sawDiffMarker = true
            continue
        }
        if (t.startsWith('> ')) {
            actualLines.push(t.slice(2))
            sawDiffMarker = true
            continue
        }
    }

    if (sawDiffMarker) {
        return { expected: expectedLines.join('\n'), actual: actualLines.join('\n'), hadDiff: true }
    }
    return { expected: '', actual: txt, hadDiff: false }
}

// Simple unified diff builder (legacy fallback only)
function buildUnifiedDiffLegacy(expected: string, actual: string, title: string): string {
    const e = normalizeNewlines(expected).split('\n')
    const a = normalizeNewlines(actual).split('\n')
    const lines: string[] = []
    lines.push(`--- actual:${title}`)
    lines.push(`+++ expected:${title}`)
    const max = Math.max(e.length, a.length)
    for (let i = 0; i < max; i++) {
        const el = e[i] ?? ''
        const al = a[i] ?? ''
        if (el === al) {
            lines.push(` ${el}`)
        } else {
            if (al !== '') lines.push(`-${al}`)
            if (el !== '') lines.push(`+${el}`)
            if (el === '' && al === '') lines.push(' ')
        }
    }
    return lines.join('\n')
}

function intralineSegments(a: string, b: string): { a: Seg[]; b: Seg[] } {
    const parts = diffChars(a ?? '', b ?? '')
    const A: Seg[] = []
    const B: Seg[] = []
    for (const p of parts) {
        if ((p as any).added) {
            B.push({ text: (p as any).value, changed: true })
        } else if ((p as any).removed) {
            A.push({ text: (p as any).value, changed: true })
        } else {
            A.push({ text: (p as any).value, changed: false })
            B.push({ text: (p as any).value, changed: false })
        }
    }
    return { a: A, b: B }
}

function areSimilarForIntra(a: string, b: string): boolean {
    const parts = diffChars(a ?? '', b ?? '')
    let changed = 0
    const total = Math.max((a ?? '').length, (b ?? '').length, 1)
    for (const p of parts) {
        if ((p as any).added || (p as any).removed) changed += (p as any).value.length
    }
    return changed / total <= MAX_CHANGE_RATIO_FOR_INTRA
}

function renderSegs(segs: Seg[], cls: 'add-ch' | 'del-ch') {
    return segs.map((seg, idx) =>
        seg.changed ? (
            <span key={idx} className={`intra ${cls}`}>
                {seg.text}
            </span>
        ) : (
            <span key={idx}>{seg.text}</span>
        )
    )
}

export function AdminGrading() {
    const { id, class_id, project_id } = useParams<{ id: string; class_id: string; project_id: string }>()
    const submissionId = id !== undefined ? parseInt(id, 10) : defaultpagenumber
    const cid = class_id !== undefined ? parseInt(class_id, 10) : -1
    const pid = project_id !== undefined ? parseInt(project_id) : -1

    const copyBlockHandlers = {
        onCopy: (e: React.ClipboardEvent) => e.preventDefault(),
        onCut: (e: React.ClipboardEvent) => e.preventDefault(),
    }

    const [studentName, setStudentName] = useState<string>('');

    const [testsLoaded, setTestsLoaded] = useState(false)
    const [payload, setPayload] = useState<AnyPayload>({ results: [] })

    const [codeFiles, setCodeFiles] = useState<CodeFile[]>([])
    const [selectedCodeFile, setSelectedCodeFile] = useState<string>('')

    const [selectedDiffId, setSelectedDiffId] = useState<string | null>(null)

    const [diffMode, setDiffMode] = useState<DiffMode>('short')

    // Intra-line highlight toggle
    const initialIntraRef = useRef<boolean>(Math.random() < 0.5)
    const [intraEnabled, setIntraEnabled] = useState<boolean>(initialIntraRef.current)

    // Track which lines contain errors and if errors exist
    const [observedErrors, setObservedErrors] = useState<ErrorsByLine>({})
    const hasErrors = Object.keys(observedErrors).length > 0

    // Track current grade of submission
    const [grade, setGrade] = useState<number>(100);

    // TODO: Add actual error definitions
    // Error Definitions
    const ERRORS: Record<string, ErrorDef> = {
        ERROR1: {
            id: "ERROR1",
            label: "Error 1",
            description: "Error 1 description.",
            points: 1
        },
        ERROR2: {
            id: "ERROR2",
            label: "Error 2",
            description: "Error 2 description.",
            points: 2
        },
        ERROR3: {
            id: "ERROR3",
            label: "Error 3",
            description: "Error 3 description.",
            points: 3
        }
    }

    // Error Menu UI toggle
    const [errorMenu, setErrorMenu] = useState({ active: false, line: -1, x: 0, y: 0 })
    const [showSubMenu, setShowSubMenu] = useState<boolean>(false);

    const showErrorMenu = (lineNo: number, e: any) => {
        setErrorMenu({
            active: true,
            line: lineNo,
            x: e.clientX + window.scrollX,
            y: e.clientY + window.scrollY,
        })
    }

    const hideErrorMenu = () => {
        setShowSubMenu(false)
        setErrorMenu(prev => ({ ...prev, active: false }))
    }

    // References for Error Menus
    const codeContainerRef = useRef<HTMLDivElement | null>(null)
    const errorMenuRef = useRef<HTMLDivElement | null>(null)

    const lineRefs = useRef<Record<number, HTMLLIElement | null>>({})

    // Handles clicking outside of the codeblock
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            const target = event.target as Node
            if (codeContainerRef.current?.contains(target) ||
                errorMenuRef.current?.contains(target)) {
                return
            }
            hideErrorMenu()
        }
        document.addEventListener("mousedown", handleClickOutside)
        return () => {
            document.removeEventListener("mousedown", handleClickOutside)
        }
    }, [])

    // Helps with line hovering
    const [hoveredLine, setHoveredLine] = useState<number | null>(null);

    // Track which (submissionId,cid) we've already logged to avoid duplicate logs (React StrictMode)
    const initLogKeyRef = useRef<string | null>(null)

    const logUiClick = (
        action: 'Diff Finder' | 'Diff Mode',
        startedState?: boolean,
        switchedTo?: boolean
    ) => {
        axios.post(
            `${import.meta.env.VITE_API_URL}/submissions/log_ui`,
            {
                id: submissionId,
                class_id: cid,
                action,
                started_state: startedState,
                switched_to: switchedTo,
            },
            { headers: { Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}` } }
        )
    }

    useEffect(() => {
        setTestsLoaded(false)
        setCodeFiles([])
        setSelectedCodeFile('')
        axios
            .get(
                `${import.meta.env.VITE_API_URL}/submissions/testcaseerrors?id=${submissionId}&class_id=${cid}`,
                { headers: { Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}` } }
            )
            .then((res) => {
                const maybe = safeJsonParse(res.data)
                setPayload((maybe && typeof maybe === 'object' ? maybe : { results: [] }) as AnyPayload)
                setTestsLoaded(true)
            })
            .catch((err) => {
                console.log(err)
                setPayload({ results: [] })
                setTestsLoaded(true)
            })
    }, [submissionId, cid])

    // Baseline the toggles on mount per submission/class
    useEffect(() => {
        const key = `${submissionId}:${cid}`
        if (initLogKeyRef.current === key) return
        initLogKeyRef.current = key
        logUiClick('Diff Mode', diffMode === 'long', diffMode === 'long')
        logUiClick('Diff Finder', initialIntraRef.current, initialIntraRef.current)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [submissionId, cid])

    useEffect(() => {
        axios
            .get(`${import.meta.env.VITE_API_URL}/submissions/codefinder?id=${submissionId}&class_id=${cid}&format=json`, {
                headers: { Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}` },
            })
            .then((res) => {
                const data = safeJsonParse(res.data) as any

                // New shape: { files: [{ name, content }, ...] }
                if (data && typeof data === 'object' && Array.isArray(data.files)) {
                    const files: CodeFile[] = data.files
                        .filter((f: any) => f && typeof f.name === 'string')
                        .map((f: any) => ({ name: String(f.name), content: String(f.content ?? '') }))

                    setCodeFiles(files)
                    setSelectedCodeFile((prev) =>
                        prev && files.some((ff) => ff.name === prev) ? prev : files[0]?.name ?? ''
                    )
                    return
                }

                // Backward compat: old endpoint returned a single string
                if (typeof data === 'string') {
                    setCodeFiles([{ name: 'Submission', content: data }])
                    setSelectedCodeFile('Submission')
                    return
                }

                // Last-resort fallback
                setCodeFiles([{ name: 'Submission', content: '' }])
                setSelectedCodeFile('Submission')
            })
            .catch((err) => {
                console.log(err)
                setCodeFiles([{ name: 'Submission', content: '' }])
                setSelectedCodeFile('Submission')
            })
    }, [submissionId, cid])


    useEffect(() => {
        axios
            .post(`${import.meta.env.VITE_API_URL}/submissions/recentsubproject`,
                { project_id: pid },
                {
                    headers: {
                        Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}`,
                    },
                }
            )
            .then(res => {
                const data = res.data
                const entry = Object.entries(data).find(([_, value]) => parseInt((value as Array<string>)[7]) === submissionId)
                if (entry) {
                    const studentData = entry[1] as Array<string>
                    setStudentName(`${studentData[1]} ${studentData[0]}`)
                }
            })
            .catch(err => console.log(err))
    }, [submissionId, cid, pid])

    useEffect(() => {
        axios.get(
            `${import.meta.env.VITE_API_URL}/submissions/get-grading/${submissionId}`,
            {
                headers: { Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}` }
            }
        )
            .then(response => {
                const { errors, grade } = response.data;

                // Update the Grade
                //setGrade(grade);

                // Convert format from db to ui
                // [{line: 2, errorId: "ERROR1"}] to { "2": [{errorId: "ERROR1"}] }

                const formattedErrors: { [key: string]: { errorId: string }[] } = {};

                errors.forEach((item: BackendError) => {
                    const lineKey = item.line.toString();

                    if (!formattedErrors[lineKey]) {
                        formattedErrors[lineKey] = [];
                    }

                    formattedErrors[lineKey].push({ errorId: item.errorId });
                    setGrade(prev => prev - ERRORS[item.errorId].points);
                });

                // 3. Update the Redlines State
                setObservedErrors(formattedErrors);
            })
            .catch(err => console.error("Could not load saved grading:", err));
    }, [submissionId]);

    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

    const handleSave = () => {

        setSaveStatus('saving');
        // converts { "10": [{errorId: "ERROR1"}] }  into  [{ line: 10, errorId: "ERROR1" }]
        const errorList = Object.entries(observedErrors).flatMap(([line, errors]) =>
            errors.map(err => ({
                line: parseInt(line),
                errorId: err.errorId
            }))
        );

        // sends data to backend
        axios.post(
            `${import.meta.env.VITE_API_URL}/submissions/save-grading`,
            {
                submissionId: submissionId,
                grade: grade,
                errors: errorList
            },
            {
                headers: {
                    Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}`
                }
            }
        )
            .then(response => {

                setSaveStatus('saved');
                console.log(response.data);
            })
            .catch(error => {

                console.error("Failed to save:", error);
                setSaveStatus('error');
            });
    };
    const diffFilesAll: DiffEntry[] = useMemo(() => {
        const raw = Array.isArray(payload?.results) ? payload.results : []
        const entries: DiffEntry[] = []

        const looksNew =
            raw.length > 0 &&
            raw.some((r: any) => r && typeof r === 'object' && ('shortDiff' in r || 'longDiff' in r || 'name' in r))

        if (looksNew) {
            raw.forEach((r: any, idx: number) => {
                const rr = (r ?? {}) as NewJsonResult
                const testName = String(rr.name ?? `Test ${idx + 1}`)
                const passed = Boolean(rr.passed)
                const shortDiff = String(rr.shortDiff ?? '')
                const longDiff = String(rr.longDiff ?? '')
                const shortDiffSameAsLong = Boolean((rr as any).shortDiffSameAsLong)
                const desc = String(rr.description ?? '')
                entries.push({
                    id: `${idx}__${testName}`,
                    num: idx + 1,
                    test: testName,
                    description: desc,
                    status: passed ? 'Passed' : 'Failed',
                    passed,
                    skipped: false,
                    shortDiff,
                    longDiff,
                    shortDiffSameAsLong,
                })
            })
            return entries.sort((a, b) => Number(a.passed) - Number(b.passed) || a.test.localeCompare(b.test))
        }

        // Legacy fallback (should be rare now): convert old shape into unified-ish diffs
        raw.forEach((r: any, idx: number) => {
            const rr = (r ?? {}) as LegacyJsonResult
            const skipped = Boolean(rr.skipped)
            const passed = Boolean(rr.passed)
            const t = rr.test ?? {}
            const testName = String(t.name ?? `Test ${idx + 1}`)
            const desc = String(t.description ?? '')
            const rawOut = (skipped ? ['This test did not run due to a configuration issue.'] : (t.output || [])).join('\n')
            const { expected, actual, hadDiff } = parseLegacyOutputs(rawOut)
            const unified = buildUnifiedDiffLegacy(expected, actual, testName)

            entries.push({
                id: `${idx}__${testName}`,
                num: idx + 1,
                test: testName,
                description: desc,
                status: skipped ? 'Skipped' : passed ? 'Passed' : 'Failed',
                passed,
                skipped,
                shortDiff: passed ? '' : unified,
                longDiff: passed ? '' : unified,
                shortDiffSameAsLong: !passed && !skipped,
            })

            // If there was no explicit diff, still show something readable
            if (!passed && !skipped && !hadDiff && !unified.trim()) {
                entries[entries.length - 1].shortDiff = buildUnifiedDiffLegacy('', rawOut, testName)
                entries[entries.length - 1].longDiff = entries[entries.length - 1].shortDiff
                entries[entries.length - 1].shortDiffSameAsLong = true
            }
        })

        return entries.sort((a, b) => Number(a.passed) - Number(b.passed) || a.test.localeCompare(b.test))
    }, [payload])

    useEffect(() => {
        if (!selectedDiffId && diffFilesAll.length > 0) {
            setSelectedDiffId(diffFilesAll[0].id)
        } else if (selectedDiffId && diffFilesAll.every((f) => f.id !== selectedDiffId)) {
            setSelectedDiffId(diffFilesAll[0]?.id ?? null)
        }
    }, [diffFilesAll, selectedDiffId])

    const selectedFile = useMemo(
        () => diffFilesAll.find((f) => f.id === selectedDiffId) || null,
        [diffFilesAll, selectedDiffId]
    )

    const showDiffModeToggle = useMemo(() => {
        if (!selectedFile || selectedFile.passed) return false
        return !selectedFile.shortDiffSameAsLong
    }, [selectedFile])

    // If short and long are identical, force long so we never show an empty "short".
    useEffect(() => {
        if (!selectedFile || selectedFile.passed) return
        if (selectedFile.shortDiffSameAsLong && diffMode !== 'long') {
            setDiffMode('long')
        }
    }, [selectedFile, diffMode])

    const selectedDiffText = useMemo(() => {
        if (!selectedFile) return ''
        if (selectedFile.passed) return ''
        if (selectedFile.shortDiffSameAsLong) return selectedFile.longDiff ?? ''
        return diffMode === 'short' ? (selectedFile.shortDiff ?? '') : (selectedFile.longDiff ?? '')
    }, [selectedFile, diffMode])

    const hasIntraInSelected = useMemo(() => {
        if (!selectedFile || selectedFile.passed) return false
        const txt = selectedDiffText || ''
        const lines = txt.split('\n')
        for (let i = 0; i < lines.length - 1; i++) {
            const line = lines[i] ?? ''
            if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('@@')) continue
            const next = lines[i + 1] ?? ''

            const isSingleAdd = line.startsWith('+') && !line.startsWith('+++')
            const isSingleDel = line.startsWith('-') && !line.startsWith('---')
            const nextIsSingleAdd = next.startsWith('+') && !next.startsWith('+++')
            const nextIsSingleDel = next.startsWith('-') && !next.startsWith('---')
            const pairable = (isSingleDel && nextIsSingleAdd) || (isSingleAdd && nextIsSingleDel)

            if (!pairable) continue

            const delText = (isSingleDel ? line : next).slice(1)
            const addText = (isSingleDel ? next : line).slice(1)
            if (areSimilarForIntra(delText, addText)) return true
        }
        return false
    }, [selectedFile, selectedDiffText])


    const selectedCode = useMemo(() => {
        if (codeFiles.length === 0) return null
        return codeFiles.find((f) => f.name === selectedCodeFile) ?? codeFiles[0]
    }, [codeFiles, selectedCodeFile])

    const language = selectedCode?.name.endsWith('.py') ? 'python' : 'java'; 

    const codeText = selectedCode?.content ?? ''

    const codeLines = useMemo(() => (codeText ? normalizeNewlines(codeText).split('\n') : []), [codeText])

    
    // Error helpers
    const addObservedError = (line: number, errorId: string) => {
        setObservedErrors(prev => {
            const errors = prev[line] ?? []

            // Don't add if error exists
            if (errors.some(e => e.errorId === errorId)) {
                return prev
            }
            return {
                ...prev, [
                    line]: [...errors, { errorId }],
            }
        })
        setGrade(prev => prev - ERRORS[errorId].points);
        setSaveStatus('idle');
    }

    const removeObservedError = (line: number, errorId: string) => {
        setObservedErrors(prev => {
            const remaining = prev[line]?.filter(e => e.errorId !== errorId) ?? []

            // Delete key if no errors are left
            if (remaining.length === 0) {
                const { [line]: _, ...rest } = prev
                return rest
            }

            return { ...prev, [line]: remaining }
        })
        setGrade(prev => prev + ERRORS[errorId].points);
        setSaveStatus('idle');
    }

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
                    { label: 'Project List', to: `/admin/projects/${cid}` },
                    { label: 'Project Manage', to: `/admin/project/${cid}/${pid}` },
                    { label : 'Student Submission' },
                ]}
            />

            <div className="tests-banner">Student Submission Grader</div>
            <h2 className="student-name">Student Name: <span className="name-value">{studentName}</span></h2>

            <section className="diff-view no-user-select" {...copyBlockHandlers}>
                <aside className="diff-sidebar">
                    <ul className="diff-file-list">
                        {!testsLoaded && <li className="muted">Loading…</li>}
                        {testsLoaded && diffFilesAll.length === 0 && <li className="muted">No tests.</li>}

                        {diffFilesAll.map((f) => (
                            <li
                                key={f.id}
                                className={
                                    'file-item ' +
                                    (f.id === selectedDiffId ? 'selected ' : '') +
                                    (f.passed ? 'passed' : 'failed')
                                }
                                onClick={() => setSelectedDiffId(f.id)}
                                title={`Testcase ${f.num}: ${f.test}`}
                            >
                                <div className="testcase-name">
                                    <span className="tc-num">{f.num}.</span> {f.test}
                                </div>
                                <div className="testcase-sub">
                                    <span className={'status-dot ' + (f.passed ? 'is-pass' : 'is-fail')} />
                                    {f.status}
                                </div>
                            </li>
                        ))}
                    </ul>
                </aside>

                <div className="diff-pane">
                    <div className="diff-toolbar">
                        <div className="diff-title">
                            {selectedFile ? `Testcase ${selectedFile.num}: ${selectedFile.test}` : 'No selection'}
                        </div>

                        <div className="spacer" />

                        {/* Button 1: shortDiff vs longDiff */}
                        {showDiffModeToggle && (
                            <button
                                type="button"
                                className={`btn toggle-mode ${diffMode === 'long' ? 'on' : 'off'}`}
                                aria-pressed={diffMode === 'long'}
                                onClick={() => {
                                    const next: DiffMode = diffMode === 'short' ? 'long' : 'short'
                                    logUiClick('Diff Mode', diffMode === 'long', next === 'long')
                                    setDiffMode(next)
                                }}
                                title="Toggle between shortDiff and longDiff"
                            >
                                Diff Mode: {diffMode === 'short' ? 'Short' : 'Long'}
                            </button>
                        )}

                        {/* Button 2: Diff Finder */}
                        <button
                            type="button"
                            className={`btn toggle-intra ${intraEnabled ? 'on' : 'off'}`}
                            aria-pressed={intraEnabled}
                            disabled={!hasIntraInSelected}
                            onClick={() => {
                                const next = !intraEnabled
                                logUiClick('Diff Finder', initialIntraRef.current, next)
                                setIntraEnabled(next)
                            }}
                            title={
                                hasIntraInSelected
                                    ? 'Toggle intra-line highlighting'
                                    : 'Intra-line highlighting is not available for this diff'
                            }
                        >
                            Diff Finder: {intraEnabled ? 'On' : 'Off'}
                        </button>
                    </div>

                    <div className="diff-code">
                        {!selectedFile && <div className="muted">Select a test on the left to view its diff.</div>}

                        {selectedFile && selectedFile.passed && (
                            <div className="diff-content">
                                <div className="diff-empty" role="status" aria-live="polite">
                                    <div className="empty-icon" aria-hidden="true">
                                        <FaRegCheckSquare />
                                    </div>
                                    <div className="empty-text">
                                        <div className="empty-title">No differences found</div>
                                        <div className="empty-subtitle">Your program’s output matches the expected output.</div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {selectedFile && !selectedFile.passed && (
                            <div className="diff-content">
                                {(() => {
                                    const txt = selectedDiffText || ''
                                    if (!txt.trim()) {
                                        return (
                                            <div className="muted">
                                                No diff text was provided for this test in {diffMode}.
                                            </div>
                                        )
                                    }

                                    const lines = txt.split('\n')
                                    const out: JSX.Element[] = []

                                    for (let i = 0; i < lines.length; i++) {
                                        const line = lines[i] ?? ''

                                        // Headers/hunks first so they never pair or get intra
                                        if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('@@')) {
                                            const headerCls = line.startsWith('---')
                                                ? 'del header'
                                                : line.startsWith('+++')
                                                    ? 'add header'
                                                    : 'meta header'
                                            out.push(
                                                <div key={i} className={`diff-line ${headerCls}`}>
                                                    {line || ' '}
                                                </div>
                                            )
                                            continue
                                        }

                                        const type = line[0]
                                        const content = line.slice(1)
                                        const next = lines[i + 1] ?? ''

                                        const isSingleAdd = line.startsWith('+') && !line.startsWith('+++')
                                        const isSingleDel = line.startsWith('-') && !line.startsWith('---')
                                        const nextIsSingleAdd = next.startsWith('+') && !next.startsWith('+++')
                                        const nextIsSingleDel = next.startsWith('-') && !next.startsWith('---')
                                        const pairable = (isSingleDel && nextIsSingleAdd) || (isSingleAdd && nextIsSingleDel)

                                        if (pairable) {
                                            const otherContent = next.slice(1)
                                            const addText = type === '-' ? otherContent : content
                                            const delText = type === '-' ? content : otherContent

                                            if (!intraEnabled || !areSimilarForIntra(delText, addText)) {
                                                out.push(
                                                    <div key={`d-${i}`} className="diff-line del">
                                                        <span className="diff-sign">-</span>
                                                        {delText || '\u00A0'}
                                                    </div>
                                                )
                                                out.push(
                                                    <div key={`a-${i + 1}`} className="diff-line add">
                                                        <span className="diff-sign">+</span>
                                                        {addText || '\u00A0'}
                                                    </div>
                                                )
                                                i++
                                                continue
                                            }

                                            const { a, b } = intralineSegments(delText, addText)
                                            out.push(
                                                <div key={`d-${i}`} className="diff-line del">
                                                    <span className="diff-sign">-</span>
                                                    {renderSegs(a, 'del-ch')}
                                                </div>
                                            )
                                            out.push(
                                                <div key={`a-${i + 1}`} className="diff-line add">
                                                    <span className="diff-sign">+</span>
                                                    {renderSegs(b, 'add-ch')}
                                                </div>
                                            )
                                            i++
                                            continue
                                        }

                                        const cls = line.startsWith('+')
                                            ? 'add'
                                            : line.startsWith('-')
                                                ? 'del'
                                                : 'ctx'

                                        out.push(
                                            <div key={i} className={`diff-line ${cls}`}>
                                                {line || ' '}
                                            </div>
                                        )
                                    }

                                    return out
                                })()}
                            </div>
                        )}
                    </div>
                </div>
            </section>

            {/* ==================== CODE SECTION (BOTTOM) ==================== */}
            <section className="code-section">
                <h2 className="section-title">Submitted Code</h2>
                {codeFiles.length === 0 && <div className="no-data-message">Fetching submitted code…</div>}

                {codeFiles.length > 0 && (
                    <>
                        {codeFiles.length > 1 && (
                            <div className="code-file-picker">
                                <label className="section-label" htmlFor="codefile-select">
                                    File Selection
                                </label>
                                <div className="select-wrap">
                                    <select
                                        id="codefile-select"
                                        className="select"
                                        value={selectedCodeFile}
                                        onChange={(e) => setSelectedCodeFile(e.target.value)}
                                    >
                                        {codeFiles.map((f) => (
                                            <option key={f.name} value={f.name}>
                                                {f.name}
                                            </option>
                                        ))}
                                    </select>
                                    <FaChevronDown className="select-icon" aria-hidden="true" />
                                </div>
                            </div>
                        )}

                        <div className="code-and-errors">
                            <Highlight
                                theme={themes.vsLight}
                                code={codeText}
                                language= {language}
                            >
                                {({ style, tokens, getLineProps, getTokenProps }) => (
                                    <div className="code-block code-viewer" ref={codeContainerRef}
                                        role="region" aria-label="Submitted source code"
                                    >
                                        <ol className="code-list" style={style}>
                                            {tokens.map((line, i) => {
                                                const lineNo = i + 1;
                                                const errors = observedErrors[lineNo] ?? [];
                                                const lineProps = getLineProps({ line, key: i });

                                                return (
                                                    <li 
                                                        ref={(el) => {lineRefs.current[lineNo] = el}}
                                                        {...lineProps}
                                                        className={`code-line
                                                            ${errors.length > 0 ? "has-error" : ""}
                                                            ${hoveredLine === lineNo ? "is-hovered" : ""}
                                                            ${lineProps.className}
                                                        `}
                                                        onClick={(e) => showErrorMenu(lineNo, e)}
                                                        onMouseEnter={() => setHoveredLine(lineNo)}
                                                        onMouseLeave={() => setHoveredLine(null)}
                                                    >
                                                        <span className="gutter">
                                                            <span className="line-number">{lineNo}</span>
                                                        </span>
                                                        <span className="code-text">
                                                            {line.map((token, key) => (
                                                                <span key={key} {...getTokenProps({ token, key })} />
                                                            ))}
                                                        </span>
                                                    </li>
                                                );
                                            })}
                                        </ol>
                                    </div>
                                )}
                            </Highlight>
                            <div className={`error-container ${hasErrors ? "err-exists" : ""}`}>
                                {hasErrors && (
                                    <div className="error-block" >
                                        {Object.entries(observedErrors).map(([lineStr, errors]) => {
                                            const lineNo = Number(lineStr)
                                            const lineEl = lineRefs.current[lineNo]
                                            if (!lineEl || !codeContainerRef.current) return null

                                            const rect = lineEl.getBoundingClientRect()
                                            const codeRect = codeContainerRef.current.getBoundingClientRect()
                                            const blockHeight = (rect.bottom - rect.top) * 3
                                            const top = rect.top - codeRect.top

                                            const len = errors.length
                                            const totalPoints = errors.reduce(
                                                (sum, err) => sum + ERRORS[err.errorId].points, 0
                                            )
                                            return (
                                                <div
                                                    key={lineNo}
                                                    className={`error-tag ${hoveredLine === lineNo ? "is-hovered" : ""}`}
                                                    style={{ top, minHeight: blockHeight }}
                                                    onMouseEnter={() => setHoveredLine(lineNo)}
                                                    onMouseLeave={() => setHoveredLine(null)}
                                                >
                                                    {errors.map((error, idx) => {
                                                        const meta = ERRORS[error.errorId]
                                                        const multi = idx === 0 && len > 1
                                                        return (
                                                            <div className={idx !== 0 ? "hide" : ""}>
                                                                <div className="error-header">
                                                                    <span className="error-label">
                                                                        {meta.label}
                                                                        {multi && <span className="add-err">+{len - 1}</span>}
                                                                    </span>
                                                                    <button className="error-remove"
                                                                        onClick={() => removeObservedError(lineNo, error.errorId)}
                                                                    >x</button>
                                                                </div>
                                                                <div className="error-body">{meta.description}</div>
                                                                <div className="error-footer">
                                                                    <span className="arrow">{multi && ">"}</span>
                                                                    <span className="error-points">-{meta.points}</span>
                                                                </div>
                                                            </div>
                                                        )
                                                    })}
                                                    {len > 1 &&
                                                        <div className="error-point-total hide">
                                                            Total: -{totalPoints}
                                                        </div>
                                                    }
                                                </div>
                                            )
                                        })}
                                    </div>
                                )}
                             </div>
                        </div>
                    </>
                )}
                {/* Error Menus */}
                {errorMenu.active && (
                    <div ref={errorMenuRef} className="error-menu"
                        style={{ top: errorMenu.y, left: errorMenu.x, }}
                    >
                        <div className="menu-line">Line: {errorMenu.line}</div>

                        <div className="menu-actions">
                            <div className="menu-add">
                                <button className="menu-add-button"
                                    onClick={() => showSubMenu ? setShowSubMenu(false) : setShowSubMenu(true)}
                                    >Add Error
                                </button>
                                {showSubMenu && (
                                    <div className="sub-menu">
                                        {Object.values(ERRORS).map((err) => (
                                            <button className="add-menu-item"
                                                key={err.id}
                                                onClick={() => {
                                                    addObservedError(errorMenu.line, err.id)
                                                    hideErrorMenu()
                                                }}
                                            >
                                                {err.label}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                        <button className="menu-close" onClick={() => { hideErrorMenu() }}>Close</button>
                    </div>
                )}
            </section>

            <section className="table-section">
                <h2 className="section-title">Current Observed Errors</h2>
                <div className="observed-errors-panel">
                    

                    {Object.keys(observedErrors).length === 0 && <p>No errors added yet.</p>}

                    {Object.keys(observedErrors).length > 0 && (
                        <table className="observed-errors-table">
                            <thead>
                                <tr>
                                    <th>Line</th>
                                    <th>Error</th>
                                    <th>Points</th>
                                    <th>Action</th>
                                </tr>
                            </thead>

                            <tbody>
                                {Object.entries(observedErrors)
                                    .sort(([a], [b]) => Number(a) - Number(b))
                                    .flatMap(([line, errors]) =>
                                        errors.map((err, idx) => (
                                            <tr key={`${line}-${err.errorId}-${idx}`}>
                                                <td>{line}</td>
                                                <td>{ERRORS[err.errorId]?.label ?? err.errorId}</td>
                                                <td>{ERRORS[err.errorId]?.points ?? 0}</td>
                                                <td>
                                                    <button
                                                        type="button"
                                                        onClick={() => removeObservedError(Number(line), err.errorId)}
                                                    >
                                                        Remove
                                                    </button>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                            </tbody>
                        </table>
                    )}
                </div>
            </section>

            <section className="save-section">
                <div>
                    <h3 className="current-grade">Grade: {grade}</h3>
                </div>
                <button
                    className={`save-grade ${saveStatus}`} // Adds class 'success' or 'saving'
                    onClick={handleSave}
                    disabled={saveStatus === 'saving'} // Prevent double-clicks
                >
                    {saveStatus === 'idle' && "Save"}
                    {saveStatus === 'saving' && "Saving..."}
                    {saveStatus === 'saved' && "Saved!"}
                    {saveStatus === 'error' && "Error"}
                </button>
            </section>

        </div>
    )
}

export default AdminGrading