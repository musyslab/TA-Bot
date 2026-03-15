import React, { useEffect, useMemo, useState } from "react";
import { useLocation, Link } from "react-router-dom";
import axios from "axios";
import "../../styling/AdminPlagiarism.scss";
import { FaColumns, FaList } from "react-icons/fa";
import { diffChars } from "diff";
import MenuComponent from "../components/MenuComponent";
import { Helmet } from "react-helmet";
import { Highlight, themes, Prism } from "prism-react-renderer";

// Ensure Prism languages are registered once for this page.
let prismLangsLoaded = false;
let prismLangsPromise: Promise<void> | null = null;
function ensurePrismLangsLoaded() {
    if (prismLangsLoaded) return Promise.resolve();
    if (prismLangsPromise) return prismLangsPromise;

    (globalThis as any).Prism = (globalThis as any).Prism ?? Prism;
    prismLangsPromise = Promise.all([
        import("prismjs/components/prism-java"),
        import("prismjs/components/prism-python"),
    ]).then(() => {
        prismLangsLoaded = true;
    });

    return prismLangsPromise;
}

type CodeSide = { code: string; label: string };

function useQuery() {
    const { search } = useLocation();
    return useMemo(() => new URLSearchParams(search), [search]);
}

type Seg = { text: string; similar: boolean };

export default function AdminPlagiarism() {
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

    // Force a rerender after Prism languages load so Highlight can use the grammar.
    const [, forcePrismRefresh] = useState(0);
    useEffect(() => {
        ensurePrismLangsLoaded().then(() => forcePrismRefresh((v) => v + 1));
    }, []);

    useEffect(() => {
        async function fetchCode(classId: string | null, subId: string | null): Promise<string> {
            if (!classId || !subId) return "";
            const baseUrl = `${import.meta.env.VITE_API_URL}/submissions/codefinder?id=${subId}&class_id=${classId}`;

            // Try text first (works for single-file submissions)
            const res = await axios.get<string | string[]>(baseUrl, {
                headers: { Authorization: `Bearer ${localStorage.getItem("AUTOTA_AUTH_TOKEN")}` },
                responseType: "text",
            });

            const first = Array.isArray(res.data) ? res.data[0] ?? "" : res.data ?? "";

            if (typeof first === "string" && first.startsWith("PK")) {
                const res2 = await axios.get<any>(baseUrl + "&format=json", {
                    headers: { Authorization: `Bearer ${localStorage.getItem("AUTOTA_AUTH_TOKEN")}` },
                });

                const data = res2.data as any;

                if (data && typeof data === "object" && Array.isArray(data.files)) {
                    return data.files
                        .map((f: any) => `// ===== ${String(f.name ?? "file")} =====\n${String(f.content ?? "")}`)
                        .join("\n\n");
                }

                if (typeof data === "string") return data;
                return "";
            }

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

    function detectLanguageFromCombinedCode(code: string): "python" | "java" | "clike" {
        const txt = code ?? "";
        const m = txt.match(/^\/\/ =====\s*(.+?)\s*=====\s*$/m);
        const name = (m?.[1] ?? "").toLowerCase();
        if (name.endsWith(".py")) return "python";
        if (name.endsWith(".java")) return "java";
        return "clike";
    }

    const leftLanguage = useMemo(() => detectLanguageFromCombinedCode(left.code), [left.code]);
    const rightLanguage = useMemo(() => detectLanguageFromCombinedCode(right.code), [right.code]);

    function renderInlineHighlighted(text: string, language: "python" | "java" | "clike") {
        const t = text ?? "";
        if (!t) return "\u00A0";
        return (
            <Highlight theme={themes.vsLight} code={t} language={language as any}>
                {({ tokens, getTokenProps }) => (
                    <>
                        {(tokens[0] ?? []).map((token, key) => {
                            const { key: tokenKey, ...tokenProps } = getTokenProps({ token, key });
                            return <span key={tokenKey ?? key} {...tokenProps} />;
                        })}
                    </>
                )}
            </Highlight>
        );
    }

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
            if ((p as any).added) {
                push(rightArr, (p as any).value, false);
            } else if ((p as any).removed) {
                push(leftArr, (p as any).value, false);
            } else {
                // common segment -> highlight on both sides
                push(leftArr, (p as any).value, true);
                push(rightArr, (p as any).value, true);
            }
        }
        return { left: leftArr, right: rightArr };
    }

    const simData = useMemo(() => (simEnabled ? buildSimilarityLines(left.code, right.code) : null), [simEnabled, left.code, right.code]);

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
                        {stacked ? <FaList /> : <FaColumns />}
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

                        {!simEnabled ? (
                            <Highlight theme={themes.vsLight} code={left.code ?? ""} language={leftLanguage as any}>
                                {({ style, tokens, getLineProps, getTokenProps }) => (
                                    <div
                                        className="code-block code-viewer"
                                        style={style}
                                        role="region"
                                        aria-label={`${left.label} source code`}
                                    >
                                        <ol className="code-list">
                                            {tokens.map((line, i) => {
                                                const { key: lineKey, ...lineProps } = getLineProps({ line, key: i });
                                                return (
                                                    <li key={lineKey ?? `a-${i + 1}`} {...lineProps} className="code-line">
                                                        <span className="gutter">
                                                            <span className="line-number">{i + 1}</span>
                                                        </span>
                                                        <span className="code-text">
                                                            {line.map((token, key) => {
                                                                const { key: tokenKey, ...tokenProps } = getTokenProps({ token, key });
                                                                return <span key={tokenKey ?? key} {...tokenProps} />;
                                                            })}
                                                        </span>
                                                    </li>
                                                );
                                            })}
                                        </ol>
                                    </div>
                                )}
                            </Highlight>
                        ) : (
                            <Highlight theme={themes.vsLight} code={left.code ?? ""} language={leftLanguage as any}>
                                {({ style }) => (
                                    <div
                                        className="code-block code-viewer"
                                        style={style}
                                        role="region"
                                        aria-label={`${left.label} source code`}
                                    >
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
                                                                          {renderInlineHighlighted(seg.text, leftLanguage)}
                                                                      </span>
                                                                  ) : (
                                                                      <span key={idx}>{renderInlineHighlighted(seg.text, leftLanguage)}</span>
                                                                  )
                                                              )}
                                                    </span>
                                                </li>
                                            ))}
                                        </ol>
                                    </div>
                                )}
                            </Highlight>
                        )}
                    </div>

                    <div>
                        <h2 className="section-title">{right.label}</h2>

                        {!simEnabled ? (
                            <Highlight theme={themes.vsLight} code={right.code ?? ""} language={rightLanguage as any}>
                                {({ style, tokens, getLineProps, getTokenProps }) => (
                                    <div
                                        className="code-block code-viewer"
                                        style={style}
                                        role="region"
                                        aria-label={`${right.label} source code`}
                                    >
                                        <ol className="code-list">
                                            {tokens.map((line, i) => {
                                                const { key: lineKey, ...lineProps } = getLineProps({ line, key: i });
                                                return (
                                                    <li key={lineKey ?? `b-${i + 1}`} {...lineProps} className="code-line">
                                                        <span className="gutter">
                                                            <span className="line-number">{i + 1}</span>
                                                        </span>
                                                        <span className="code-text">
                                                            {line.map((token, key) => {
                                                                const { key: tokenKey, ...tokenProps } = getTokenProps({ token, key });
                                                                return <span key={tokenKey ?? key} {...tokenProps} />;
                                                            })}
                                                        </span>
                                                    </li>
                                                );
                                            })}
                                        </ol>
                                    </div>
                                )}
                            </Highlight>
                        ) : (
                            <Highlight theme={themes.vsLight} code={right.code ?? ""} language={rightLanguage as any}>
                                {({ style }) => (
                                    <div
                                        className="code-block code-viewer"
                                        style={style}
                                        role="region"
                                        aria-label={`${right.label} source code`}
                                    >
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
                                                                          {renderInlineHighlighted(seg.text, rightLanguage)}
                                                                      </span>
                                                                  ) : (
                                                                      <span key={idx}>
                                                                          {renderInlineHighlighted(seg.text, rightLanguage)}
                                                                      </span>
                                                                  )
                                                              )}
                                                    </span>
                                                </li>
                                            ))}
                                        </ol>
                                    </div>
                                )}
                            </Highlight>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}