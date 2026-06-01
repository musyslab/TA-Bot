import {
    CSSProperties,
    KeyboardEvent,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import axios from "axios";
import { Helmet } from "react-helmet";
import { useNavigate, useParams } from "react-router-dom";
import {
    FaCheck,
    FaFlagCheckered,
    FaLock,
    FaPlay,
    FaStar,
    FaTrophy,
} from "react-icons/fa";

import MenuComponent from "../components/MenuComponent";
import DirectoryBreadcrumbs from "../components/DirectoryBreadcrumbs";
import "../../styling/StudentModuleDetails.scss";

interface ModuleObject {
    Id: number;
    ClassId: number;
    Name: string;
    Start: string;
    End: string;
    MainProjectId?: number;
    MainProjectName?: string;
    TotalSubmissions?: number;
    CheckpointTotalSubmissions?: number;
    CheckpointsEnabled?: boolean;
    MainCompleted?: boolean;
}

interface ClassAccessResponse {
    id?: number;
    name?: string;
    school_id?: number;
    school_name?: string;
}

interface Checkpoint {
    id: number;
    number: number;
    name: string;
    enabled: boolean;
    solved: boolean;
    rewarded: boolean;
}

interface PathSegment {
    key: string;
    d: string;
    completed: boolean;
}

interface PathSvgState {
    width: number;
    height: number;
    segments: PathSegment[];
}

const authHeader = () => ({
    Authorization: `Bearer ${localStorage.getItem("AUTOTA_AUTH_TOKEN")}`,
});

export default function StudentModuleDetails() {
    const { school_id, class_id, module_id } = useParams<{
        school_id: string;
        class_id: string;
        module_id: string;
    }>();

    const navigate = useNavigate();

    const schoolId = school_id || "";
    const classId = class_id || "";
    const moduleId = Number(module_id || 0);

    const [className, setClassName] = useState("");
    const [module, setModule] = useState<ModuleObject | null>(null);
    const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [errorMessage, setErrorMessage] = useState("");
    const [pathSvgState, setPathSvgState] = useState<PathSvgState>({
        width: 0,
        height: 0,
        segments: [],
    });

    const modulePathTrackRef = useRef<HTMLDivElement | null>(null);

    const mainProjectId = module?.MainProjectId || 0;
    const mainProjectName = module?.MainProjectName?.trim() || "Main Project";

    const parseDate = (value: string): Date | null => {
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? null : d;
    };

    const formatDate12h = (value: string): string => {
        const d = parseDate(value);
        if (!d) return value;

        return new Intl.DateTimeFormat("en-US", {
            year: "numeric",
            month: "short",
            day: "2-digit",
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
        }).format(d);
    };

    const getModuleStatus = (
        currentModule: ModuleObject,
    ): "active" | "upcoming" | "ended" => {
        const startMs = Date.parse(currentModule.Start);
        const endMs = Date.parse(currentModule.End);

        if (Number.isNaN(startMs) || Number.isNaN(endMs)) return "upcoming";

        const now = Date.now();

        if (now >= startMs && now <= endMs) return "active";
        return now < startMs ? "upcoming" : "ended";
    };

    const statusLabel = module ? getModuleStatus(module) : "upcoming";

    const sortedCheckpoints = useMemo(() => {
        return [...checkpoints].sort((a, b) => {
            if (a.number !== b.number) return a.number - b.number;
            return a.id - b.id;
        });
    }, [checkpoints]);

    const completedCheckpointCount = sortedCheckpoints.filter(
        (problem) => problem.solved,
    ).length;
    const totalCheckpointCount = sortedCheckpoints.length;
    const mainCompleted = Boolean(module?.MainCompleted);
    const totalAssignmentCount = totalCheckpointCount + 1;
    const completedAssignmentCount =
        completedCheckpointCount + (mainCompleted ? 1 : 0);
    const allCheckpointSolved =
        totalCheckpointCount === 0 ||
        completedCheckpointCount === totalCheckpointCount;
    const firstUnsolvedIndex = sortedCheckpoints.findIndex(
        (problem) => !problem.solved,
    );
    const activeCheckpointIndex =
        firstUnsolvedIndex === -1 ? totalCheckpointCount : firstUnsolvedIndex;
    const progressPercent = Math.round(
        (completedAssignmentCount / totalAssignmentCount) * 100,
    );

    const pathCompletionStates = useMemo(() => {
        return [
            ...sortedCheckpoints.map((problem) => problem.solved),
            mainCompleted,
        ];
    }, [sortedCheckpoints, mainCompleted]);

    const recalculatePathConnectors = useCallback(() => {
        const trackElement = modulePathTrackRef.current;

        if (!trackElement) {
            setPathSvgState({ width: 0, height: 0, segments: [] });
            return;
        }

        const nodeElements = Array.from(
            trackElement.querySelectorAll<HTMLElement>(
                "[data-module-path-node='true']",
            ),
        );

        if (nodeElements.length <= 1) {
            setPathSvgState({
                width: trackElement.offsetWidth,
                height: trackElement.offsetHeight,
                segments: [],
            });
            return;
        }

        const trackRect = trackElement.getBoundingClientRect();
        const nodeRects = nodeElements.map((nodeElement) => {
            const rect = nodeElement.getBoundingClientRect();

            return {
                left: rect.left - trackRect.left,
                right: rect.right - trackRect.left,
                top: rect.top - trackRect.top,
                bottom: rect.bottom - trackRect.top,
                width: rect.width,
                height: rect.height,
                centerX: rect.left - trackRect.left + rect.width / 2,
                centerY: rect.top - trackRect.top + rect.height / 2,
            };
        });

        const segments: PathSegment[] = [];

        for (let i = 0; i < nodeRects.length - 1; i += 1) {
            const current = nodeRects[i];
            const next = nodeRects[i + 1];

            const sameRow =
                Math.abs(current.centerY - next.centerY) <
                Math.min(current.height, next.height) * 0.45;
            let d = "";

            if (sameRow) {
                d = `M ${current.right} ${current.centerY} L ${next.left} ${next.centerY}`;
            } else {
                const routeY =
                    current.bottom + Math.max(12, (next.top - current.bottom) / 2);

                d = [
                    `M ${current.centerX} ${current.bottom}`,
                    `L ${current.centerX} ${routeY}`,
                    `L ${next.centerX} ${routeY}`,
                    `L ${next.centerX} ${next.top}`,
                ].join(" ");
            }

            segments.push({
                key: `module-path-connector-${i}`,
                d,
                completed: Boolean(pathCompletionStates[i]),
            });
        }

        setPathSvgState({
            width: trackRect.width,
            height: trackRect.height,
            segments,
        });
    }, [pathCompletionStates]);

    const loadClassName = () => {
        if (!classId) {
            setClassName("");
            return;
        }

        axios
            .get<ClassAccessResponse>(
                `${import.meta.env.VITE_API_URL}/class/id/${classId}/access`,
                {
                    headers: authHeader(),
                    params: {
                        ...(schoolId ? { school_id: schoolId } : {}),
                        role_context: "student",
                    },
                },
            )
            .then((res) => {
                setClassName(res.data?.name || "");
            })
            .catch((err) => {
                console.log(err);
                setClassName("");
            });
    };

    const loadModuleDetails = () => {
        if (!classId || !moduleId) {
            setErrorMessage("Could not find this module.");
            setIsLoading(false);
            return;
        }

        setIsLoading(true);
        setErrorMessage("");

        axios
            .get(
                `${import.meta.env.VITE_API_URL}/projects/get_module_overview_student?module_id=${moduleId}`,
                {
                    headers: authHeader(),
                },
            )
            .then((res) => {
                const selectedModule = res.data?.module || null;

                if (!selectedModule) {
                    setModule(null);
                    setCheckpoints([]);
                    setErrorMessage("Could not find this module.");
                    setIsLoading(false);
                    return;
                }

                setModule(selectedModule);
                setCheckpoints(res.data?.checkpoints || []);
                setIsLoading(false);
            })
            .catch((err) => {
                console.log(err);
                setModule(null);
                setCheckpoints([]);
                setErrorMessage("Could not load this module.");
                setIsLoading(false);
            });
    };

    useEffect(() => {
        loadClassName();
        loadModuleDetails();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [schoolId, classId, moduleId]);

    useLayoutEffect(() => {
        recalculatePathConnectors();

        const trackElement = modulePathTrackRef.current;
        if (!trackElement) return;

        const resizeObserver = new ResizeObserver(() => {
            recalculatePathConnectors();
        });

        resizeObserver.observe(trackElement);

        Array.from(
            trackElement.querySelectorAll<HTMLElement>(
                "[data-module-path-node='true']",
            ),
        ).forEach((nodeElement) => {
            resizeObserver.observe(nodeElement);
        });

        window.addEventListener("resize", recalculatePathConnectors);

        return () => {
            resizeObserver.disconnect();
            window.removeEventListener("resize", recalculatePathConnectors);
        };
    }, [
        recalculatePathConnectors,
        sortedCheckpoints.length,
        mainCompleted,
        allCheckpointSolved,
        isLoading,
        module?.Id,
    ]);

    const goBackToModules = () => {
        navigate(`/student/school/${schoolId}/class/${classId}/modules`);
    };

    const openCheckpoint = (checkpointId: number) => {
        if (!mainProjectId) return;

        navigate(
            `/student/school/${schoolId}/class/${classId}/module/${moduleId}/project/${mainProjectId}/checkpoint/${checkpointId}/upload`,
        );
    };

    const openMainProject = () => {
        if (!mainProjectId || !allCheckpointSolved) return;

        navigate(
            `/student/school/${schoolId}/class/${classId}/module/${moduleId}/project/${mainProjectId}/upload`,
        );
    };

    const handleCheckpointKeyDown = (
        event: KeyboardEvent<HTMLElement>,
        checkpointId: number,
        locked: boolean,
    ) => {
        if (locked || (event.key !== "Enter" && event.key !== " ")) return;

        event.preventDefault();
        openCheckpoint(checkpointId);
    };

    return (
        <div className="student-module-details-page">
            <Helmet>
                <title>MAAT</title>
            </Helmet>

            <MenuComponent
                showUpload={true}
                showAdminUpload={false}
                showHelp={false}
                showCreate={false}
                showLast={false}
                showReviewButton={false}
            />

            <DirectoryBreadcrumbs
                items={[
                    { label: "School Selection", to: "/schools" },
                    {
                        label: "Class Selection",
                        to: schoolId
                            ? `/student/school/${schoolId}/classes`
                            : "/schools",
                    },
                    {
                        label: "Module List",
                        to: `/student/school/${schoolId}/class/${classId}/modules`,
                    },
                    { label: "Module Details" },
                ]}
            />

            <div className="pageTitle">
                {className ? `${className} Student Module Details` : "Student Module Details"}
            </div>

            <div className="student-module-details-shell">
                {isLoading ? (
                    <div className="module-details-message">Loading module path...</div>
                ) : null}

                {!isLoading && errorMessage ? (
                    <div className="module-details-message is-error">{errorMessage}</div>
                ) : null}

                {!isLoading && module ? (
                    <>
                        <section className={`module-quest-hero is-${statusLabel}`}>
                            <div className="module-quest-hero-copy">
                                <h1>{module.Name}</h1>
                                <div className="module-quest-meta-row">
                                    <span>{formatDate12h(module.Start)}</span>
                                    <span>to</span>
                                    <span>{formatDate12h(module.End)}</span>
                                </div>
                            </div>

                            <div className="module-quest-progress-card">
                                <div
                                    className="module-quest-progress-ring"
                                    style={
                                        {
                                            "--progress-percent": `${progressPercent}%`,
                                        } as CSSProperties
                                    }
                                >
                                    <span>{progressPercent}%</span>
                                </div>

                                <div>
                                    <div className="module-quest-progress-title">
                                        {completedAssignmentCount} / {totalAssignmentCount}{" "}
                                        assignments completed
                                    </div>
                                </div>
                            </div>
                        </section>

                        <section
                            className="module-path-section"
                            aria-label="Checkpoint unlock path"
                        >
                            <div className="module-path-header">
                                <div>
                                    <h2>Checkpoint Path</h2>
                                    <p>Complete the checkpoints to unlock the main project.</p>
                                </div>
                            </div>

                            <div className="module-path-track" ref={modulePathTrackRef}>
                                <svg
                                    className="module-path-connector-layer"
                                    width={pathSvgState.width}
                                    height={pathSvgState.height}
                                    viewBox={`0 0 ${pathSvgState.width} ${pathSvgState.height}`}
                                    aria-hidden="true"
                                    focusable="false"
                                >
                                    {pathSvgState.segments.map((segment) => (
                                        <path
                                            className={[
                                                "module-path-connector-line",
                                                segment.completed ? "is-complete" : "",
                                            ]
                                                .join(" ")
                                                .trim()}
                                            d={segment.d}
                                            key={segment.key}
                                        />
                                    ))}
                                </svg>

                                {sortedCheckpoints.length === 0 ? (
                                    <div className="module-path-empty">
                                        No checkpoints are available yet. The main project is open.
                                    </div>
                                ) : null}

                                {sortedCheckpoints.map((problem, index) => {
                                    const locked =
                                        !problem.solved && index > activeCheckpointIndex;
                                    const available = !problem.solved && !locked;
                                    const completed = problem.solved;

                                    return (
                                        <article
                                            className={[
                                                "module-path-node",
                                                completed ? "is-complete" : "",
                                                available ? "is-active" : "",
                                                locked ? "is-locked" : "",
                                            ]
                                                .join(" ")
                                                .trim()}
                                            key={problem.id}
                                            data-module-path-node="true"
                                            role={locked ? "article" : "button"}
                                            tabIndex={locked ? -1 : 0}
                                            onClick={() => {
                                                if (!locked) openCheckpoint(problem.id);
                                            }}
                                            onKeyDown={(event) =>
                                                handleCheckpointKeyDown(event, problem.id, locked)
                                            }
                                            aria-label={`${problem.name} ${completed ? "completed" : locked ? "locked" : "available"}`}
                                        >
                                            <div className="module-path-node-icon">
                                                {completed ? (
                                                    <FaCheck aria-hidden="true" />
                                                ) : locked ? (
                                                    <FaLock aria-hidden="true" />
                                                ) : (
                                                    <FaPlay aria-hidden="true" />
                                                )}
                                            </div>

                                            <div className="module-path-node-content">
                                                <div className="module-path-node-label">
                                                    Checkpoint {problem.number}
                                                </div>
                                                <h3>{problem.name}</h3>
                                                <p>
                                                    {completed
                                                        ? "Cleared"
                                                        : locked
                                                            ? "Locked until earlier checkpoints are cleared"
                                                            : "Ready to attempt"}
                                                </p>
                                            </div>

                                            {problem.rewarded ? (
                                                <div className="module-path-node-reward">
                                                    <FaStar aria-hidden="true" />
                                                    +1
                                                </div>
                                            ) : null}
                                        </article>
                                    );
                                })}

                                <article
                                    className={[
                                        "module-path-node",
                                        "module-path-main-node",
                                        mainCompleted
                                            ? "is-complete"
                                            : allCheckpointSolved
                                                ? "is-active"
                                                : "is-locked",
                                    ]
                                        .join(" ")
                                        .trim()}
                                    data-module-path-node="true"
                                    role={allCheckpointSolved ? "button" : "article"}
                                    tabIndex={allCheckpointSolved ? 0 : -1}
                                    onClick={openMainProject}
                                    onKeyDown={(event) => {
                                        if (
                                            !allCheckpointSolved ||
                                            (event.key !== "Enter" && event.key !== " ")
                                        )
                                            return;

                                        event.preventDefault();
                                        openMainProject();
                                    }}
                                    aria-label={`${mainProjectName} ${mainCompleted ? "completed" : allCheckpointSolved ? "unlocked" : "locked"}`}
                                >
                                    <div className="module-path-node-icon">
                                        {mainCompleted ? (
                                            <FaCheck aria-hidden="true" />
                                        ) : allCheckpointSolved ? (
                                            <FaTrophy aria-hidden="true" />
                                        ) : (
                                            <FaLock aria-hidden="true" />
                                        )}
                                    </div>

                                    <div className="module-path-node-content">
                                        <div className="module-path-node-label">Main Project</div>
                                        <h3>{mainProjectName}</h3>
                                        <p>
                                            {mainCompleted
                                                ? "Completed"
                                                : allCheckpointSolved
                                                    ? "Unlocked. Submit your main solution."
                                                    : "Locked until all checkpoints are cleared."}
                                        </p>
                                    </div>

                                    <div className="module-path-main-flag">
                                        <FaFlagCheckered aria-hidden="true" />
                                    </div>
                                </article>
                            </div>
                        </section>
                    </>
                ) : null}
            </div>
        </div>
    );
}