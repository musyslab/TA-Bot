// AdminGrading.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import { useParams } from 'react-router-dom'
import { Helmet } from 'react-helmet'
import MenuComponent from '../components/MenuComponent'
import "../../styling/AdminGrading.scss";
import DirectoryBreadcrumbs from '../components/DirectoryBreadcrumbs'
import DiffView from '../components/CodeDiffView'

const defaultpagenumber = -1

type BackendError = {
    line: number;
    errorId: string;
}

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

export function AdminGrading() {
    const { id, class_id, project_id } = useParams<{ id: string; class_id: string; project_id: string }>()
    const submissionId = id !== undefined ? parseInt(id, 10) : defaultpagenumber
    const cid = class_id !== undefined ? parseInt(class_id, 10) : -1
    const pid = project_id !== undefined ? parseInt(project_id) : -1

    const [studentName, setStudentName] = useState<string>('');

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

                // Convert format from db to ui
                // [{line: 2, errorId: "ERROR1"}] to { "2": [{errorId: "ERROR1"}] }
                const formattedErrors: { [key: string]: { errorId: string }[] } = {};

                const totalPoints = (errors as BackendError[]).reduce((sum, item) => {
                    const lineKey = item.line.toString();
                    if (!formattedErrors[lineKey]) formattedErrors[lineKey] = [];
                    formattedErrors[lineKey].push({ errorId: item.errorId });
                    return sum + (ERRORS[item.errorId]?.points ?? 0);
                }, 0);

                setGrade(100 - totalPoints);
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
                    { label: 'Project List', to: `/admin/${cid}/projects` },
                    { label: 'Student List', to: `/admin/${cid}/project/${pid}` },
                    { label: 'Grade Submission' },
                ]}
            />

            <div className="pageTitle">
                Grade Submission: {studentName || 'Unknown Student'}
            </div>

            <DiffView
                submissionId={submissionId}
                classId={cid}
                codeSectionTitle="Submitted Code"
                codeContainerRef={codeContainerRef}
                lineRefs={lineRefs}
                getLineClassName={(lineNo) => {
                    const errors = observedErrors[lineNo] ?? []
                    return [
                        errors.length > 0 ? "has-error" : "",
                        hoveredLine === lineNo ? "is-hovered" : "",
                    ]
                        .filter(Boolean)
                        .join(" ")
                }}
                onLineClick={(lineNo, e) => showErrorMenu(lineNo, e)}
                onLineMouseEnter={(lineNo) => setHoveredLine(lineNo)}
                onLineMouseLeave={() => setHoveredLine(null)}
                codeRightPanel={
                    <div className={`error-container ${hasErrors ? "err-exists" : ""}`}>
                        {hasErrors && (
                            <div className="error-block">
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
                                        (sum, err) => sum + (ERRORS[err.errorId]?.points ?? 0),
                                        0
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
                                                    <div key={`${lineNo}-${error.errorId}-${idx}`} className={idx !== 0 ? "hide" : ""}>
                                                        <div className="error-header">
                                                            <span className="error-label">
                                                                {meta.label}
                                                                {multi && <span className="add-err">+{len - 1}</span>}
                                                            </span>
                                                            <button
                                                                className="error-remove"
                                                                onClick={() => removeObservedError(lineNo, error.errorId)}
                                                            >
                                                                x
                                                            </button>
                                                        </div>
                                                        <div className="error-body">{meta.description}</div>
                                                        <div className="error-footer">
                                                            <span className="arrow">{multi && ">"}</span>
                                                            <span className="error-points">-{meta.points}</span>
                                                        </div>
                                                    </div>
                                                )
                                            })}
                                            {len > 1 && <div className="error-point-total hide">Total: -{totalPoints}</div>}
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>
                }
            />

            {/* Error Menus */}
            {errorMenu.active && (
                <div ref={errorMenuRef} className="error-menu" style={{ top: errorMenu.y, left: errorMenu.x }}>
                    <div className="menu-line">Line: {errorMenu.line}</div>

                    <div className="menu-actions">
                        <div className="menu-add">
                            <button
                                className="menu-add-button"
                                onClick={() => (showSubMenu ? setShowSubMenu(false) : setShowSubMenu(true))}
                            >
                                Add Error
                            </button>
                            {showSubMenu && (
                                <div className="sub-menu">
                                    {Object.values(ERRORS).map((err) => (
                                        <button
                                            className="add-menu-item"
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
                    <button className="menu-close" onClick={() => hideErrorMenu()}>
                        Close
                    </button>
                </div>
            )}

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