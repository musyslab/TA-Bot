import React, { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { useParams } from 'react-router-dom'
import { Helmet } from 'react-helmet'
import MenuComponent from '../components/MenuComponent'
import '../css/CodeViews.scss'

const defaultpagenumber = -1;

interface JsonTestResponseBody {
    output: Array<string>;
    type: number;
    description: string;
    name: string;
    suite: string;
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
    suite: string;
    test: string;
    status: string;
    passed: boolean;
    skipped: boolean;
    expected: string;
    actual: string;
    unified: string;
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
    const [code, setCode] = useState<string>('');
    const [score] = useState<number>(0);
    const [hasScoreEnabled] = useState<boolean>(false);

    // UI
    const [activeView, setActiveView] = useState<'table' | 'diff'>('table');

    // Diff view UI state
    const [selectedDiffId, setSelectedDiffId] = useState<string | null>(null);

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
            .then(res => setCode(res.data as string))
            .catch(err => console.log(err));
    }, [submissionId, cid]);

    // Group tests by suite
    const suites = Array.from(new Set(json.results.map(item => item.test.suite)));
    const suiteGroups = suites.map(s => {
        const suiteItems = json.results.filter(r => r.test.suite === s);
        const visible = suiteItems.filter(r => r.test.hidden !== 'True');
        const hiddenCount = suiteItems.length - visible.length;
        return { suite: s, visible, hiddenCount };
    });

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

    // Disable intra-line highlighting when two lines are too different.
    const NO_INTRA_THRESHOLD = 0.3;
    // If the two lines are almost identical once whitespace is ignored,
    // prefer the older space-aware aligner (keeps nice [ ]-only diffs).
    const SPACE_BIAS_THRESHOLD = 0.97;

    function diceCoefficient(a: string, b: string): number {
        if (a === b) return 1;
        const ax = a.length - 1, bx = b.length - 1;
        if (ax < 1 || bx < 1) return 0;
        const counts = new Map<string, number>();
        for (let i = 0; i < ax; i++) {
            const bg = a.slice(i, i + 2);
            counts.set(bg, (counts.get(bg) || 0) + 1);
        }
        let matches = 0;
        for (let i = 0; i < bx; i++) {
            const bg = b.slice(i, i + 2);
            const c = counts.get(bg) || 0;
            if (c > 0) { counts.set(bg, c - 1); matches++; }
        }
        return (2 * matches) / (ax + bx);
    }

    // Helper: longest common prefix/suffix to coalesce a single contiguous change.
    function commonPrefixLen(a: string, b: string): number {
        const n = Math.min(a.length, b.length);
        let i = 0;
        while (i < n && a[i] === b[i]) i++;
        return i;
    }
    function commonSuffixLen(a: string, b: string, minIdx: number): number {
        let i = a.length - 1, j = b.length - 1, k = 0;
        while (i >= minIdx && j >= minIdx && a[i] === b[j]) { i--; j--; k++; }
        return k;
    }

    // Older, space-aware greedy aligner (good for mostly spacing differences).
    function spaceAwareSegments(a: string, b: string): { a: Seg[]; b: Seg[] } {
        const A: Seg[] = [], B: Seg[] = [];
        let i = 0, j = 0;
        let sameA = '', sameB = '', diffA = '', diffB = '';
        const flushSame = () => {
            if (sameA || sameB) {
                A.push({ text: sameA, changed: false });
                B.push({ text: sameB, changed: false });
                sameA = sameB = '';
            }
        };
        const flushDiff = () => {
            if (diffA || diffB) {
                A.push({ text: diffA, changed: true });
                B.push({ text: diffB, changed: true });
                diffA = diffB = '';
            }
        };
        while (i < a.length || j < b.length) {
            const ca = i < a.length ? a[i] : '';
            const cb = j < b.length ? b[j] : '';
            if (ca && cb && ca === cb) { flushDiff(); sameA += ca; sameB += cb; i++; j++; continue; }
            // Prefer aligning by skipping spaces so space-only diffs are obvious
            if (ca === ' ' && cb !== '') { flushSame(); diffA += ca; i++; continue; }
            if (cb === ' ' && ca !== '') { flushSame(); diffB += cb; j++; continue; }
            // General mismatch: mark both
            flushSame();
            if (ca) { diffA += ca; i++; }
            if (cb) { diffB += cb; j++; }
        }
        flushSame(); flushDiff();
        return { a: A, b: B };
    }

    function intralineSegments(a: string, b: string): { a: Seg[]; b: Seg[] } {
        if (a === b) return { a: [{ text: a, changed: false }], b: [{ text: b, changed: false }] };

        // If nearly identical ignoring whitespace, use the space-aware aligner
        // to preserve the older, finer-grained behavior for spacing tweaks.
        const ai = a.replace(/\s+/g, '');
        const bi = b.replace(/\s+/g, '');
        const simNoWS = diceCoefficient(ai, bi);
        if (simNoWS >= SPACE_BIAS_THRESHOLD) {
            return spaceAwareSegments(a, b);
        }

        // Otherwise, coalesce to a single contiguous change using prefix/suffix.
        const A: Seg[] = [], B: Seg[] = [];
        const p = commonPrefixLen(a, b);
        const s = commonSuffixLen(a, b, p);
        const pref = a.slice(0, p);
        const coreA = a.slice(p, a.length - s);
        const coreB = b.slice(p, b.length - s);
        const suf = a.slice(a.length - s);
        if (pref) { A.push({ text: pref, changed: false }); B.push({ text: pref, changed: false }); }
        if (coreA.length || coreB.length) { A.push({ text: coreA, changed: true }); B.push({ text: coreB, changed: true }); }
        if (suf) { A.push({ text: suf, changed: false }); B.push({ text: suf, changed: false }); }
        return { a: A, b: B };
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
        suiteGroups.forEach(g => {
            g.visible.forEach(r => {
                const rawOut = (r.skipped ? friendlySkipMessage() : (r.test.output || [])).join('\n');
                const { expected, actual } = parseOutputs(rawOut);
                const title = `${r.test.suite}/${r.test.name}`;
                const unified = buildUnifiedDiff(expected, actual, title);
                entries.push({
                    id: `${r.test.suite}__${r.test.name}`,
                    suite: r.test.suite,
                    test: r.test.name,
                    status: labelFor(r),
                    passed: r.passed,
                    skipped: r.skipped,
                    expected,
                    actual,
                    unified,
                });
            });
        });
        // Prefer failed first in sidebar ordering
        return entries.sort((a, b) => Number(a.passed) - Number(b.passed) || a.suite.localeCompare(b.suite) || a.test.localeCompare(b.test));
    }, [suiteGroups]);

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

    const codeLines = useMemo(
        () => (code ? code.replace(/\r\n/g, '\n').split('\n') : []),
        [code]
    );



    // Flatten table rows for tests (table view)
    type TestRow =
        | { kind: 'info'; suite: string; note?: string }
        | {
            kind: 'result';
            suite: string;
            test: string;
            status: string;
            passed: boolean;
            description: string;
            expectedExcerpt: string;
            outputExcerpt: string;
            note?: string;
        };

    const testRows: TestRow[] = [];
    suiteGroups.forEach(g => {
        if (g.hiddenCount > 0) {
            testRows.push({ kind: 'info', suite: g.suite, note: `Hidden tests not shown: ${g.hiddenCount}` });
        }
        g.visible.forEach(r => {
            const status = labelFor(r);
            const rawOut = (r.skipped ? friendlySkipMessage() : (r.test.output || [])).join('\n');
            const { expected, actual, hadDiff } = parseOutputs(rawOut);
            const expTrunc = truncateLines(r.passed ? actual : expected);
            const actTrunc = truncateLines(actual);
            testRows.push({
                kind: 'result',
                suite: r.test.suite,
                test: r.test.name,
                status,
                passed: r.passed,
                description: r.test.description || '',
                expectedExcerpt: r.passed ? expTrunc.text : (expTrunc.text || '—'),
                outputExcerpt: actTrunc.text || '—',
                note: !r.passed && !hadDiff ? 'Grader did not provide a separate expected block.' : undefined,
            });
        });
    });

    return (
        <div className="page-container" id="code-page">
            <Helmet>
                <title>Submission | TA-Bot</title>
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
                    onClick={() => setActiveView('table')}
                >
                    Table View
                </button>
                <button
                    className={`menu-item-diff ${activeView === 'diff' ? 'active' : ''}`}
                    onClick={() => setActiveView('diff')}
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
                                        <th>Difficulty Level</th>
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
                                            <td className="no-data-message" colSpan={6}>Fetching tests…</td>
                                        </tr>
                                    )}
                                    {testsLoaded && testRows.length === 0 && (
                                        <tr>
                                            <td className="no-data-message" colSpan={6}>No tests were returned for this submission.</td>
                                        </tr>
                                    )}
                                    {testsLoaded && testRows.map((row, i) => {
                                        if (row.kind === 'info') {
                                            return (
                                                <tr className="info-row" key={`info-${row.suite}-${i}`}>
                                                    <td>{row.suite}</td>
                                                    <td colSpan={5}>—</td>
                                                </tr>
                                            );
                                        }
                                        const isPass = row.passed;
                                        return (
                                            <tr key={`res-${row.suite}-${row.test}-${i}`}>
                                                <td>{row.suite}</td>
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
                                        title={`${f.suite} / ${f.test}`}
                                    >
                                        <div className="file-name">{f.test}</div>
                                        <div className="file-sub">
                                            <span className={'status-dot ' + (f.passed ? 'is-pass' : 'is-fail')} />
                                            {f.suite} • {f.status}
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </aside>

                        <div className="diff-pane">
                            <div className="diff-toolbar">
                                <div className="diff-title">
                                    {selectedFile
                                        ? `Difficulty: ${selectedFile.suite} Testcase Name: ${selectedFile.test}`
                                        : 'No selection'}
                                </div>
                                <div className="spacer" />
                            </div>

                            <div className="diff-code">
                                {!selectedFile && <div className="muted">Select a test on the left to view its diff.</div>}

                                {selectedFile && (
                                    selectedFile.passed ? (
                                        <div className="diff-content">
                                            <div className="diff-line ctx">No differences.</div>
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
                                                        const sim = diceCoefficient(delText, addText);
                                                        if (sim < NO_INTRA_THRESHOLD) {
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
                {!code && <div className="no-data-message">Fetching submitted code…</div>}
                {!!code && (
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
                )}
            </section>
        </div>
    );
}

export default CodePage;
