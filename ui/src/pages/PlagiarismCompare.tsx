import React, { useEffect, useMemo, useState } from "react";
import { useLocation, Link } from "react-router-dom";
import axios from "axios";
import "../css/PlagiarismCompare.scss";
import { diffChars } from "diff";
import { Icon } from "semantic-ui-react";
import MenuComponent from '../components/MenuComponent'
import { Helmet } from 'react-helmet'

type CodeSide = { code: string; label: string };

function useQuery() {
    const { search } = useLocation();
    return useMemo(() => new URLSearchParams(search), [search]);
}

type Seg = { text: string; similar: boolean };

export default function PlagiarismCompare() {
    const q = useQuery();
    const ac = q.get("ac");
    const asid = q.get("as");
    const bc = q.get("bc");
    const bsid = q.get("bs");
    const an = q.get("an");
    const bn = q.get("bn");

    const initialALabel = useMemo(() => (an && an.trim() !== "" ? an : "Submission A"), [an]);
    const initialBLabel = useMemo(() => (bn && bn.trim() !== "" ? bn : "Submission B"), [bn]);

    const [left, setLeft] = useState<CodeSide>({ code: "", label: initialALabel });
    const [right, setRight] = useState<CodeSide>({ code: "", label: initialBLabel });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [simEnabled, setSimEnabled] = useState<boolean>(false);
    const [stacked, setStacked] = useState<boolean>(false); // false = side-by-side, true = top/bottom

    useEffect(() => {
        async function fetchCode(classId: string | null, subId: string | null): Promise<string> {
            if (!classId || !subId) return "";
            const url = `${import.meta.env.VITE_API_URL}/submissions/codefinder?id=${subId}&class_id=${classId}`;
            const res = await axios.get<string | string[]>(url, {
                headers: { Authorization: `Bearer ${localStorage.getItem("AUTOTA_AUTH_TOKEN")}` },
                responseType: "text",
            });
            return Array.isArray(res.data) ? res.data[0] ?? "" : res.data ?? "";
        }
        (async () => {
            try {
                setLoading(true);
                setError(null);
                const [aCode, bCode] = await Promise.all([fetchCode(ac, asid), fetchCode(bc, bsid)]);
                setLeft({ code: aCode ?? "", label: initialALabel });
                setRight({ code: bCode ?? "", label: initialBLabel });
            } catch (_e) {
                setError("Failed to load one or both submissions.");
            } finally {
                setLoading(false);
            }
        })();
    }, [ac, asid, bc, bsid, initialALabel, initialBLabel]);

    const toLines = (s: string) => (s || "").replace(/\r\n/g, "\n").split("\n");

    // Similarity Finder (highlights common substrings on both sides)
    function wrapPlainLines(s: string): Seg[][] {
        return toLines(s).map((line) => [{ text: line, similar: false }]);
    }

    function buildSimilarityLines(a: string, b: string): { left: Seg[][]; right: Seg[][] } {
        const parts = diffChars(a || "", b || "");
        const leftArr: Seg[][] = [];
        const rightArr: Seg[][] = [];

        const push = (arr: Seg[][], text: string, similar: boolean) => {
            const chunks = (text ?? "").split("\n");
            if (arr.length === 0) arr.push([]);
            for (let i = 0; i < chunks.length; i++) {
                if (i > 0) arr.push([]);
                arr[arr.length - 1].push({ text: chunks[i], similar });
            }
        };

        for (const p of parts) {
            if (p.added) {
                push(rightArr, p.value, false);
            } else if (p.removed) {
                push(leftArr, p.value, false);
            } else {
                // common segment -> highlight on both sides
                push(leftArr, p.value, true);
                push(rightArr, p.value, true);
            }
        }
        return { left: leftArr, right: rightArr };
    }

    const simData = useMemo(
        () => (simEnabled ? buildSimilarityLines(left.code, right.code) : null),
        [simEnabled, left.code, right.code]
    );

    const leftLines: Seg[][] = simData ? simData.left : wrapPlainLines(left.code);
    const rightLines: Seg[][] = simData ? simData.right : wrapPlainLines(right.code);

    return (
        <div className="plagiarism-container">
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
                showAdminForum={true}
            />
            <div className="back-btn">
                <Link to="/admin/classes" className="back-link">
                    Return to Class Selection
                </Link>
            </div>

            <div className="title-outline">
                <h1 className="title-text">Side-by-Side Submission Viewer</h1>
            </div>

            <div className="sim-toolbar">
                <button
                    type="button"
                    className={`btn toggle-sim ${simEnabled ? "on" : "off"}`}
                    aria-pressed={simEnabled}
                    onClick={() => setSimEnabled((v) => !v)}
                    title="Toggle similarity highlighting"
                >
                    Similarity Finder: {simEnabled ? "On" : "Off"}
                </button>

                <button
                    type="button"
                    className={`btn toggle-layout ${stacked ? "stacked" : "side"}`}
                    aria-pressed={stacked}
                    onClick={() => setStacked((v) => !v)}
                    title="Toggle layout: side-by-side vs top/bottom"
                >
                    <span className="btn-icon neutral-icon" aria-hidden="true">
                        <Icon name={stacked ? "list layout" : "columns"} />
                    </span>
                    Layout: {stacked ? "Top/Bottom" : "Side-by-Side"}
                </button>
            </div>

            {loading && <div className="no-data-message">Loading code…</div>}
            {error && <div className="no-data-message">{error}</div>}

            {!loading && !error && (
                <div className={`panels ${stacked ? "stacked" : "side"}`}>
                    <div>
                        <h2 className="section-title">{left.label}</h2>
                        <div className="code-block code-viewer" role="region" aria-label={`${left.label} source code`}>
                            <ol className="code-list">
                                {leftLines.map((segs, i) => (
                                    <li key={`a-${i + 1}`} className="code-line">
                                        <span className="gutter">
                                            <span className="line-number">{i + 1}</span>
                                        </span>
                                        <span className="code-text">
                                            {segs.length === 0
                                                ? "\u00A0"
                                                : segs.map((seg, idx) =>
                                                    seg.similar ? (
                                                        <span key={idx} className="similar-ch">
                                                            {seg.text || "\u00A0"}
                                                        </span>
                                                    ) : (
                                                        <span key={idx}>{seg.text || "\u00A0"}</span>
                                                    )
                                                )}
                                        </span>
                                    </li>
                                ))}
                            </ol>
                        </div>
                    </div>

                    <div>
                        <h2 className="section-title">{right.label}</h2>
                        <div className="code-block code-viewer" role="region" aria-label={`${right.label} source code`}>
                            <ol className="code-list">
                                {rightLines.map((segs, i) => (
                                    <li key={`b-${i + 1}`} className="code-line">
                                        <span className="gutter">
                                            <span className="line-number">{i + 1}</span>
                                        </span>
                                        <span className="code-text">
                                            {segs.length === 0
                                                ? "\u00A0"
                                                : segs.map((seg, idx) =>
                                                    seg.similar ? (
                                                        <span key={idx} className="similar-ch">
                                                            {seg.text || "\u00A0"}
                                                        </span>
                                                    ) : (
                                                        <span key={idx}>{seg.text || "\u00A0"}</span>
                                                    )
                                                )}
                                        </span>
                                    </li>
                                ))}
                            </ol>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}