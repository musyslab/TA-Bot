import React, { useEffect, useMemo, useState, useRef } from 'react'
import axios from 'axios'
import { useParams } from 'react-router-dom'
import { Helmet } from 'react-helmet'
import MenuComponent from '../components/MenuComponent'
import '../css/CodeViews.scss'
import { Icon } from 'semantic-ui-react'
import { diffChars } from 'diff'

const defaultpagenumber = -1;

interface JsonTestResponseBody {
    output: Array<string>;
    type: number;
    description: string;
    name: string;
    hidden: string;
}
interface JsonResponseBody {
    skipped: boolean;
    passed: boolean;
    test: JsonTestResponseBody;
}
interface JsonResponse {
    results: Array<JsonResponseBody>;
}

type DiffEntry = {
    id: string;
    test: string;
    status: string;
    passed: boolean;
    skipped: boolean;
    expected: string;
    actual: string;
    unified: string;
};

type CodeFile = {
    name: string;
    content: string;
};

export function CodePage() {
    const { id, class_id } = useParams<{ id: string; class_id: string }>();
    const submissionId = id !== undefined ? parseInt(id) : defaultpagenumber;
    const cid = class_id !== undefined ? parseInt(class_id) : -1;

    const copyBlockHandlers = {
        onCopy: (e: React.ClipboardEvent) => e.preventDefault(),
        onCut: (e: React.ClipboardEvent) => e.preventDefault(),
    };

    // Data
    const [json, setJson] = useState<JsonResponse>({ results: [] });
    const [testsLoaded, setTestsLoaded] = useState<boolean>(false);
    const [codeFiles, setCodeFiles] = useState<CodeFile[]>([]);
    const [selectedCodeFile, setSelectedCodeFile] = useState<string>('');
    const [score] = useState<number>(0);
    const [hasScoreEnabled] = useState<boolean>(false);

    // UI
    const [activeView, setActiveView] = useState<'table' | 'diff'>('table');

    // Diff view UI state
    const [selectedDiffId, setSelectedDiffId] = useState<string | null>(null);

    // Intra-line highlight toggle
    const initialIntraRef = useRef<boolean>(Math.random() < 0.5);
    const [intraEnabled, setIntraEnabled] = useState<boolean>(initialIntraRef.current);

    // Track which (submissionId,cid) we've already logged to avoid duplicate logs (e.g., React StrictMode)
    const initLogKeyRef = useRef<string | null>(null);

    // === analytics: log UI clicks ===
    const logUiClick = (
        action: 'Table View' | 'File View' | 'Diff Finder',
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
        );

    };

    // Fetch data
    useEffect(() => {
        axios
            .get(`${import.meta.env.VITE_API_URL}/submissions/testcaseerrors?id=${submissionId}&class_id=${cid}`, {
                headers: { Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}` },
            })
            .then(res => {
                setJson(res.data as JsonResponse);
                setTestsLoaded(true);
            })
            .catch(err => console.log(err));

        axios
            .get(`${import.meta.env.VITE_API_URL}/submissions/codefinder?id=${submissionId}&class_id=${cid}`, {
                headers: { Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}` },
            })
            .then(res => {
                const data = res.data as any;

                // New shape: { files: [{ name, content }, ...] }
                if (data && typeof data === 'object' && Array.isArray(data.files)) {
                    const files: CodeFile[] = data.files
                        .filter((f: any) => f && typeof f.name === 'string')
                        .map((f: any) => ({ name: String(f.name), content: String(f.content ?? '') }));

                    setCodeFiles(files);
                    setSelectedCodeFile(prev => (prev && files.some(ff => ff.name === prev)) ? prev : (files[0]?.name ?? ''));
                    return;
                }

                // Backward compat: old endpoint returned a single string
                if (typeof data === 'string') {
                    const fallback: CodeFile[] = [{ name: 'Submission', content: data }];
                    setCodeFiles(fallback);
                    setSelectedCodeFile('Submission');
                    return;
                }

                // Last-resort fallback
                setCodeFiles([{ name: 'Submission', content: '' }]);
                setSelectedCodeFile('Submission');
            })
            .catch(err => console.log(err));
    }, [submissionId, cid]);

    // Log initial UI state on first load (and when navigating to a different submission/class)
    useEffect(() => {
        const key = `${submissionId}:${cid}`;
        if (initLogKeyRef.current === key) return;
        initLogKeyRef.current = key;
        // Default tab on mount
        logUiClick('Table View');
        // Baseline the Diff Finder toggle’s initial state
        logUiClick('Diff Finder', initialIntraRef.current, initialIntraRef.current);
    }, [submissionId, cid]);

    // Filter out hidden tests (and keep a single summary count)
    const visibleResults = useMemo(
        () => json.results.filter(r => r.test.hidden !== 'True'),
        [json.results]
    );
    const hiddenTestsCount = useMemo(
        () => json.results.filter(r => r.test.hidden === 'True').length,
        [json.results]
    );

    // Helpers
    const labelFor = (r: JsonResponseBody) => (r.skipped ? 'Skipped' : r.passed ? 'Passed' : 'Failed');

    function parseOutputs(raw: string): { expected: string; actual: string; hadDiff: boolean } {
        if (raw.includes('~~~diff~~~')) {
            const [userPart, expectedPart = ''] = raw.split('~~~diff~~~');
            return { expected: expectedPart, actual: userPart, hadDiff: true };
        }
        const lines = raw.replace(/\r\n/g, '\n').split('\n');
        const expectedLines: string[] = [];
        const actualLines: string[] = [];
        let sawDiffMarker = false;

        for (const l of lines) {
            const t = l.trimStart();
            if (t.startsWith('---')) { sawDiffMarker = true; continue; }
            if (t.startsWith('< ')) { expectedLines.push(t.slice(2)); sawDiffMarker = true; continue; }
            if (t.startsWith('> ')) { actualLines.push(t.slice(2)); sawDiffMarker = true; continue; }
        }

        if (sawDiffMarker) {
            return { expected: expectedLines.join('\n'), actual: actualLines.join('\n'), hadDiff: true };
        }
        return { expected: '', actual: raw, hadDiff: false };
    }

    function truncateLines(text: string, maxLines = 30) {
        const arr = text ? text.replace(/\r\n/g, '\n').split('\n') : [];
        const total = arr.length;
        const truncated = total > maxLines;
        const shown = truncated ? arr.slice(0, maxLines) : arr;
        return {
            text: shown.join('\n'),
            total,
            truncated,
            omitted: truncated ? total - maxLines : 0,
        };
    }

    function friendlySkipMessage(): string[] {
        return [
            'This test did not run due to a configuration issue.',
            'If this keeps happening, contact your TA or instructor.',
        ];
    }

    // ===== Diff helpers =====
    function buildUnifiedDiff(expected: string, actual: string, title: string): string {
        const e = (expected ?? '').replace(/\r\n/g, '\n').split('\n');
        const a = (actual ?? '').replace(/\r\n/g, '\n').split('\n');
        const lines: string[] = [];
        lines.push(`--- actual:${title}`);
        lines.push(`+++ expected:${title}`);
        const max = Math.max(e.length, a.length);
        for (let i = 0; i < max; i++) {
            const el = e[i] ?? '';
            const al = a[i] ?? '';
            if (el === al) {
                lines.push(` ${el}`);
            } else {
                if (al !== '') lines.push(`-${al}`);
                if (el !== '') lines.push(`+${el}`);
                if (el === '' && al === '') lines.push(' ');
            }
        }
        return lines.join('\n');
    }

    type Seg = { text: string; changed: boolean };
    // Upper bound on how much of a line may change before we drop intra-highlighting
    const MAX_CHANGE_RATIO_FOR_INTRA = 0.7;

    function intralineSegments(a: string, b: string): { a: Seg[]; b: Seg[] } {
        // Use jsdiff to split text into changed/unchanged chunks
        const parts = diffChars(a ?? '', b ?? '');
        const A: Seg[] = [];
        const B: Seg[] = [];
        for (const p of parts) {
            if (p.added) {
                B.push({ text: p.value, changed: true });
            } else if (p.removed) {
                A.push({ text: p.value, changed: true });
            } else {
                A.push({ text: p.value, changed: false });
                B.push({ text: p.value, changed: false });
            }
        }
        return { a: A, b: B };
    }

    function areSimilarForIntra(a: string, b: string): boolean {
        const parts = diffChars(a ?? '', b ?? '');
        let changed = 0;
        let total = Math.max((a ?? '').length, (b ?? '').length, 1);
        for (const p of parts) {
            if (p.added || p.removed) changed += p.value.length;
        }
        return (changed / total) <= MAX_CHANGE_RATIO_FOR_INTRA;
    }

    function renderSegs(segs: Seg[], cls: 'add-ch' | 'del-ch') {
        return segs.map((seg, idx) =>
            seg.changed
                ? <span key={idx} className={`intra ${cls}`}>{seg.text}</span>
                : <span key={idx}>{seg.text}</span>
        );
    }

    // Build diff "files" for the Diff File View
    const diffFilesAll: DiffEntry[] = useMemo(() => {
        const entries: DiffEntry[] = [];
        visibleResults.forEach((r, idx) => {
            const rawOut = (r.skipped ? friendlySkipMessage() : (r.test.output || [])).join('\n');
            const { expected, actual } = parseOutputs(rawOut);
            const title = `${r.test.name}`;
            const unified = buildUnifiedDiff(expected, actual, title);
            entries.push({
                id: `${idx}__${r.test.name}`,
                test: r.test.name,
                status: labelFor(r),
                passed: r.passed,
                skipped: r.skipped,
                expected,
                actual,
                unified,
            });
        });
        // Prefer failed first in sidebar ordering
        return entries.sort((a, b) => Number(a.passed) - Number(b.passed) || a.test.localeCompare(b.test));
    }, [visibleResults]);

    // Ensure there is a selected file
    useEffect(() => {
        if (!selectedDiffId && diffFilesAll.length > 0) {
            setSelectedDiffId(diffFilesAll[0].id);
        } else if (selectedDiffId && diffFilesAll.every(f => f.id !== selectedDiffId)) {
            setSelectedDiffId(diffFilesAll[0]?.id ?? null);
        }
    }, [diffFilesAll, selectedDiffId]);

    const selectedFile = useMemo(
        () => diffFilesAll.find(f => f.id === selectedDiffId) || null,
        [diffFilesAll, selectedDiffId]
    );

    const hasIntraInSelected = useMemo(() => {
        if (!selectedFile || selectedFile.passed) return false;
        const lines = selectedFile.unified.split('\n');
        for (let i = 0; i < lines.length - 1; i++) {
            const line = lines[i] ?? '';
            if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('@@')) continue;
            const next = lines[i + 1] ?? '';
            const isSingleAdd = line.startsWith('+') && !line.startsWith('+++');
            const isSingleDel = line.startsWith('-') && !line.startsWith('---');
            const nextIsSingleAdd = next.startsWith('+') && !next.startsWith('+++');
            const nextIsSingleDel = next.startsWith('-') && !next.startsWith('---');
            const pairable = (isSingleDel && nextIsSingleAdd) || (isSingleAdd && nextIsSingleDel);
            if (pairable) {
                const delText = (isSingleDel ? line : next).slice(1);
                const addText = (isSingleDel ? next : line).slice(1);
                if (areSimilarForIntra(delText, addText)) return true;
            }
        }
        return false;
    }, [selectedFile]);

    const selectedCode = useMemo(() => {
        if (codeFiles.length === 0) return null;
        return codeFiles.find(f => f.name === selectedCodeFile) ?? codeFiles[0];
    }, [codeFiles, selectedCodeFile]);

    const codeText = selectedCode?.content ?? '';

    const codeLines = useMemo(
        () => (codeText ? codeText.replace(/\r\n/g, '\n').split('\n') : []),
        [codeText]
    );

    // Flatten table rows for tests (table view)
    type TestRow =
        | { kind: 'info'; note?: string }
        | {
            kind: 'result';
            test: string;
            status: string;
            passed: boolean;
            description: string;
            expectedExcerpt: string;
            outputExcerpt: string;
            note?: string;
        };

    const testRows: TestRow[] = [];

    if (hiddenTestsCount > 0) {
        testRows.push({ kind: 'info', note: `Hidden tests not shown: ${hiddenTestsCount}` });
    }
    visibleResults.forEach(r => {
        const status = labelFor(r);
        const rawOut = (r.skipped ? friendlySkipMessage() : (r.test.output || [])).join('\n');
        const { expected, actual, hadDiff } = parseOutputs(rawOut);
        const expTrunc = truncateLines(r.passed ? actual : expected);
        const actTrunc = truncateLines(actual);
        testRows.push({
            kind: 'result',
            test: r.test.name,
            status,
            passed: r.passed,
            description: r.test.description || '',
            expectedExcerpt: r.passed ? expTrunc.text : (expTrunc.text || '—'),
            outputExcerpt: actTrunc.text || '—',
            note: !r.passed && !hadDiff ? 'Grader did not provide a separate expected block.' : undefined,
        });
    });

    return (
        <div className="page-container" id="code-page">
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

            {/* ======== VIEW SWITCH (Table View / Diff File View) ======== */}
            <div className="tests-banner">Test Case Results</div>
            <div className="tab-menu view-switch">
                <button
                    className={activeView === 'table' ? 'active menu-item-table' : 'menu-item-table'}
                    onClick={() => { logUiClick('Table View'); setActiveView('table'); }}
                >
                    Table View
                </button>
                <button
                    className={`menu-item-diff ${activeView === 'diff' ? 'active' : ''}`}
                    onClick={() => { logUiClick('File View'); setActiveView('diff'); }}
                >
                    File View
                </button>
            </div>

            {/* ==================== TAB CONTENT (ABOVE CODE) ==================== */}
            <div className="tab-content">
                {activeView === 'table' && (
                    <>
                        {hasScoreEnabled && (
                            <section className="score-section">
                                <h2 className="section-title">Score</h2>
                                <table className="score-table">
                                    <tbody>
                                        <tr>
                                            <td>Submission score</td>
                                            <td>{score}</td>
                                        </tr>
                                        <tr>
                                            <td>Notes</td>
                                            <td>Score is a weighted blend of tests and pylint; it is not a final grade.</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </section>
                        )}

                        <section className="tests-section no-user-select" {...copyBlockHandlers}>
                            <table className="results-table">
                                <thead>
                                    <tr>
                                        <th>Test Name</th>
                                        <th>Description</th>
                                        <th>Status</th>
                                        <th>Your Program's Output</th>
                                        <th>Expected Output</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {!testsLoaded && (
                                        <tr>
                                            <td className="no-data-message" colSpan={5}>Fetching tests…</td>
                                        </tr>
                                    )}
                                    {testsLoaded && testRows.length === 0 && (
                                        <tr>
                                            <td className="no-data-message" colSpan={5}>No tests were returned for this submission.</td>
                                        </tr>
                                    )}
                                    {testsLoaded && testRows.map((row, i) => {
                                        if (row.kind === 'info') {
                                            return (
                                                <tr className="info-row" key={`info-${i}`}>
                                                    <td colSpan={5}>{row.note || '—'}</td>
                                                </tr>
                                            );
                                        }
                                        const isPass = row.passed;
                                        return (
                                            <tr key={`res-${row.test}-${i}`}>
                                                <td>{row.test}</td>
                                                <td><pre className="cell-pre">{row.description || '—'}</pre></td>
                                                <td
                                                    className={`status-cell status ${/^(pass|passed|ok|success)$/i.test(row.status) ? 'passed' : 'failed'}`}
                                                >
                                                    {row.status}
                                                </td>
                                                <td className={isPass ? 'status-cell passed' : undefined}>
                                                    {isPass ? row.status : <pre className="cell-pre">{row.outputExcerpt}</pre>}
                                                </td>
                                                <td className={isPass ? 'status-cell passed' : undefined}>
                                                    {isPass ? row.status : <pre className="cell-pre">{row.expectedExcerpt}</pre>}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </section>
                    </>
                )}

                {activeView === 'diff' && (
                    <section className="diff-view no-user-select" {...copyBlockHandlers}>
                        <aside className="diff-sidebar">
                            <ul className="diff-file-list">
                                {!testsLoaded && <li className="muted">Loading…</li>}
                                {testsLoaded && diffFilesAll.length === 0 && (
                                    <li className="muted">No tests.</li>
                                )}
                                {diffFilesAll.map(f => (
                                    <li
                                        key={f.id}
                                        className={
                                            'file-item ' +
                                            (f.id === selectedDiffId ? 'selected ' : '') +
                                            (f.passed ? 'passed' : 'failed')
                                        }
                                        onClick={() => setSelectedDiffId(f.id)}
                                        title={`${f.test}`}
                                    >
                                        <div className="file-name">{f.test}</div>
                                        <div className="file-sub">
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
                                    {selectedFile
                                        ? `Testcase Name: ${selectedFile.test}`
                                        : 'No selection'}
                                </div>
                                <div className="spacer" />
                                {hasIntraInSelected && (
                                    <button
                                        type="button"
                                        className={`btn toggle-intra ${intraEnabled ? 'on' : 'off'}`}
                                        aria-pressed={intraEnabled}
                                        onClick={() => { const next = !intraEnabled; logUiClick('Diff Finder', initialIntraRef.current, next); setIntraEnabled(next); }}
                                        title="Toggle intra-line highlighting"
                                    >
                                        Diff Finder: {intraEnabled ? 'On' : 'Off'}
                                    </button>
                                )}
                            </div>

                            <div className="diff-code">
                                {!selectedFile && <div className="muted">Select a test on the left to view its diff.</div>}

                                {selectedFile && (
                                    selectedFile.passed ? (
                                        <div className="diff-content">
                                            <div className="diff-empty" role="status" aria-live="polite">
                                                <div className="empty-icon" aria-hidden="true">
                                                    <Icon name="check square" />
                                                </div>
                                                <div className="empty-text">
                                                    <div className="empty-title">No differences found</div>
                                                    <div className="empty-subtitle">Your program’s output matches the expected output.</div>
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="diff-content">
                                            {(() => {
                                                const lines = selectedFile.unified.split('\n');
                                                const out: JSX.Element[] = [];

                                                for (let i = 0; i < lines.length; i++) {
                                                    const line = lines[i] ?? '';
                                                    // Treat diff headers/hunk markers as meta FIRST so they never pair or get intra
                                                    if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('@@')) {
                                                        // Header lines: no intraline. Use del for '---', add for '+++', meta for '@@'.
                                                        const headerCls =
                                                            line.startsWith('---') ? 'del header' :
                                                                line.startsWith('+++') ? 'add header' :
                                                                    'meta header';
                                                        out.push(
                                                            <div key={i} className={`diff-line ${headerCls}`}>
                                                                {line || ' '}
                                                            </div>
                                                        );
                                                        continue;
                                                    }

                                                    const type = line[0];
                                                    const content = line.slice(1);
                                                    const next = lines[i + 1] ?? '';
                                                    // Only pair single-line +/- edits; exclude headers like '---'/'+++'
                                                    const isSingleAdd = line.startsWith('+') && !line.startsWith('+++');
                                                    const isSingleDel = line.startsWith('-') && !line.startsWith('---');
                                                    const nextIsSingleAdd = next.startsWith('+') && !next.startsWith('+++');
                                                    const nextIsSingleDel = next.startsWith('-') && !next.startsWith('---');
                                                    const pairable = (isSingleDel && nextIsSingleAdd) || (isSingleAdd && nextIsSingleDel);

                                                    if (pairable) {
                                                        const otherContent = next.slice(1);
                                                        // Normalize which one is deletion vs addition
                                                        const addText = type === '-' ? otherContent : content;
                                                        const delText = type === '-' ? content : otherContent;
                                                        // If lines are too different, show full-line changes (no intra).
                                                        if (!intraEnabled || !areSimilarForIntra(delText, addText)) {
                                                            out.push(
                                                                <div key={`d-${i}`} className="diff-line del">
                                                                    <span className="diff-sign">-</span>
                                                                    {delText || '\u00A0'}
                                                                </div>
                                                            );
                                                            out.push(
                                                                <div key={`a-${i + 1}`} className="diff-line add">
                                                                    <span className="diff-sign">+</span>
                                                                    {addText || '\u00A0'}
                                                                </div>
                                                            );
                                                            i++; // consume the pair
                                                            continue;
                                                        }
                                                        // Otherwise, keep intra-line highlighting.
                                                        const { a, b } = intralineSegments(delText, addText);
                                                        out.push(
                                                            <div key={`d-${i}`} className="diff-line del">
                                                                <span className="diff-sign">-</span>
                                                                {renderSegs(a, 'del-ch')}
                                                            </div>
                                                        );
                                                        out.push(
                                                            <div key={`a-${i + 1}`} className="diff-line add">
                                                                <span className="diff-sign">+</span>
                                                                {renderSegs(b, 'add-ch')}
                                                            </div>
                                                        );
                                                        i++; // consume the pair
                                                        continue;
                                                    }

                                                    const cls =
                                                        line.startsWith('+') ? 'add' :
                                                            line.startsWith('-') ? 'del' : 'ctx';
                                                    out.push(
                                                        <div key={i} className={`diff-line ${cls}`}>
                                                            {line || ' '}
                                                        </div>
                                                    );
                                                }
                                                return out;
                                            })()}
                                        </div>
                                    )
                                )}
                            </div>

                        </div>
                    </section>
                )}
            </div>

            {/* ==================== CODE SECTION (BELOW TABLES) ==================== */}
            <section className="code-section">
                <h2 className="section-title">Submitted Code</h2>
                {codeFiles.length === 0 && <div className="no-data-message">Fetching submitted code…</div>}

                {codeFiles.length > 0 && (
                    <>
                        {codeFiles.length > 1 && (
                            <div className="code-file-picker">
                                <label className="section-label" htmlFor="codefile-select">File</label>
                                <select
                                    id="codefile-select"
                                    className="select"
                                    value={selectedCodeFile}
                                    onChange={(e) => setSelectedCodeFile(e.target.value)}
                                >
                                    {codeFiles.map(f => (
                                        <option key={f.name} value={f.name}>{f.name}</option>
                                    ))}
                                </select>
                            </div>
                        )}
                        <div className="code-block code-viewer" role="region" aria-label="Submitted source code">
                            <ol className="code-list">
                                {codeLines.map((text, idx) => {
                                    const lineNo = idx + 1;
                                    return (
                                        <li key={lineNo} className="code-line">
                                            <span className="gutter">
                                                <span className="line-number">{lineNo}</span>
                                            </span>
                                            <span className="code-text">{text || '\u00A0'}</span>
                                        </li>
                                    );
                                })}
                            </ol>
                        </div>
                    </>
                )}
            </section>
        </div>
    );
}

export default CodePage;
