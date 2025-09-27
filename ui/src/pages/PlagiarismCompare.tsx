import React, { useEffect, useMemo, useState } from "react";
import { useLocation, Link } from "react-router-dom";
import axios from "axios";
import '../css/PlagiarismCompare.scss'

type CodeSide = { code: string; label: string };

function useQuery() {
    const { search } = useLocation();
    return useMemo(() => new URLSearchParams(search), [search]);
}

export default function PlagiarismCompare() {
    const q = useQuery();
    const ac = q.get("ac");
    const asid = q.get("as");
    const bc = q.get("bc");
    const bsid = q.get("bs");
    const [left, setLeft] = useState<CodeSide>({ code: "", label: "Submission A" });
    const [right, setRight] = useState<CodeSide>({ code: "", label: "Submission B" });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        async function fetchCode(classId: string | null, subId: string | null): Promise<string> {
            if (!classId || !subId) return "";
            const url = `${import.meta.env.VITE_API_URL}/submissions/codefinder?id=${subId}&class_id=${classId}`;
            const res = await axios.get<string | string[]>(url, {
                headers: { Authorization: `Bearer ${localStorage.getItem("AUTOTA_AUTH_TOKEN")}` },
                responseType: "text",
            });
            return Array.isArray(res.data) ? (res.data[0] ?? "") : (res.data ?? "");
        }
        (async () => {
            try {
                setLoading(true);
                setError(null);
                const [aCode, bCode] = await Promise.all([fetchCode(ac, asid), fetchCode(bc, bsid)]);
                setLeft({ code: aCode ?? "", label: "Submission A" });
                setRight({ code: bCode ?? "", label: "Submission B" });
            } catch (_e) {
                setError("Failed to load one or both submissions.");
            } finally {
                setLoading(false);
            }
        })();
    }, [ac, asid, bc, bsid]);

    const toLines = (s: string) => (s || "").replace(/\r\n/g, "\n").split("\n");

    return (
        <div className="admin-project-config-container">
            <div className="page-header">
                <Link to="/admin/classes" className="back-link">Return to Class Selection</Link>
            </div>
            <div className="title-row">
                <h1 className="page-title">Side-by-Side Submission Viewer</h1>
            </div>
            {loading && <div className="no-data-message">Loading code…</div>}
            {error && <div className="no-data-message">{error}</div>}
            {!loading && !error && (
                <div>
                    <div>
                        <h2 className="section-title">{left.label}</h2>
                        <div className="code-block code-viewer" role="region" aria-label={`${left.label} source code`}>
                            <ol className="code-list">
                                {toLines(left.code).map((text, i) => (
                                    <li key={`a-${i + 1}`} className="code-line">
                                        <span className="gutter"><span className="line-number">{i + 1}</span></span>
                                        <span className="code-text">{text || "\u00A0"}</span>
                                    </li>
                                ))}
                            </ol>
                        </div>
                    </div>
                    <div>
                        <h2 className="section-title">{right.label}</h2>
                        <div className="code-block code-viewer" role="region" aria-label={`${right.label} source code`}>
                            <ol className="code-list">
                                {toLines(right.code).map((text, i) => (
                                    <li key={`b-${i + 1}`} className="code-line">
                                        <span className="gutter"><span className="line-number">{i + 1}</span></span>
                                        <span className="code-text">{text || "\u00A0"}</span>
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
