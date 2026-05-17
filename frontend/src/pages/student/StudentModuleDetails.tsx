import {
    CSSProperties,
    KeyboardEvent,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState
} from "react"
import axios from "axios"
import { Helmet } from "react-helmet"
import { useNavigate, useParams } from "react-router-dom"
import {
    FaCheck,
    FaFlagCheckered,
    FaLock,
    FaPlay,
    FaStar,
    FaTrophy
} from "react-icons/fa"

import MenuComponent from "../components/MenuComponent"
import DirectoryBreadcrumbs from "../components/DirectoryBreadcrumbs"
import "../../styling/StudentModuleDetails.scss"

interface ModuleObject {
    Id: number
    ClassId: number
    Name: string
    Start: string
    End: string
    MainProjectId?: number
    TotalSubmissions?: number
    PracticeTotalSubmissions?: number
    PracticeProblemsEnabled?: boolean
    MainCompleted?: boolean
}

interface PracticeProblem {
    id: number
    number: number
    name: string
    enabled: boolean
    solved: boolean
    rewarded: boolean
}

interface PathSegment {
    key: string
    d: string
    completed: boolean
}

interface PathSvgState {
    width: number
    height: number
    segments: PathSegment[]
}

const authHeader = () => ({
    Authorization: `Bearer ${localStorage.getItem("AUTOTA_AUTH_TOKEN")}`
})

export default function StudentModuleDetails() {
    const { school_id, class_id, module_id } = useParams<{
        school_id: string
        class_id: string
        module_id: string
    }>()

    const navigate = useNavigate()

    const schoolId = school_id || ""
    const classId = class_id || ""
    const moduleId = Number(module_id || 0)

    const [module, setModule] = useState<ModuleObject | null>(null)
    const [practiceProblems, setPracticeProblems] = useState<PracticeProblem[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [errorMessage, setErrorMessage] = useState("")
    const [pathSvgState, setPathSvgState] = useState<PathSvgState>({
        width: 0,
        height: 0,
        segments: []
    })

    const modulePathTrackRef = useRef<HTMLDivElement | null>(null)

    const mainProjectId = module?.MainProjectId || 0

    const parseDate = (value: string): Date | null => {
        const d = new Date(value)
        return Number.isNaN(d.getTime()) ? null : d
    }

    const formatDate12h = (value: string): string => {
        const d = parseDate(value)
        if (!d) return value

        return new Intl.DateTimeFormat("en-US", {
            year: "numeric",
            month: "short",
            day: "2-digit",
            hour: "numeric",
            minute: "2-digit",
            hour12: true
        }).format(d)
    }

    const getModuleStatus = (currentModule: ModuleObject): "active" | "upcoming" | "ended" => {
        const startMs = Date.parse(currentModule.Start)
        const endMs = Date.parse(currentModule.End)

        if (Number.isNaN(startMs) || Number.isNaN(endMs)) return "upcoming"

        const now = Date.now()

        if (now >= startMs && now <= endMs) return "active"
        return now < startMs ? "upcoming" : "ended"
    }

    const statusLabel = module ? getModuleStatus(module) : "upcoming"

    const sortedPracticeProblems = useMemo(() => {
        return [...practiceProblems].sort((a, b) => {
            if (a.number !== b.number) return a.number - b.number
            return a.id - b.id
        })
    }, [practiceProblems])

    const completedPracticeCount = sortedPracticeProblems.filter((problem) => problem.solved).length
    const totalPracticeCount = sortedPracticeProblems.length
    const mainCompleted = Boolean(module?.MainCompleted)
    const totalAssignmentCount = totalPracticeCount + 1
    const completedAssignmentCount = completedPracticeCount + (mainCompleted ? 1 : 0)
    const allPracticeSolved = totalPracticeCount === 0 || completedPracticeCount === totalPracticeCount
    const firstUnsolvedIndex = sortedPracticeProblems.findIndex((problem) => !problem.solved)
    const activePracticeIndex = firstUnsolvedIndex === -1 ? totalPracticeCount : firstUnsolvedIndex
    const progressPercent = Math.round((completedAssignmentCount / totalAssignmentCount) * 100)

    const pathCompletionStates = useMemo(() => {
        return [
            ...sortedPracticeProblems.map((problem) => problem.solved),
            mainCompleted
        ]
    }, [sortedPracticeProblems, mainCompleted])

    const recalculatePathConnectors = useCallback(() => {
        const trackElement = modulePathTrackRef.current

        if (!trackElement) {
            setPathSvgState({ width: 0, height: 0, segments: [] })
            return
        }

        const nodeElements = Array.from(
            trackElement.querySelectorAll<HTMLElement>("[data-module-path-node='true']")
        )

        if (nodeElements.length <= 1) {
            setPathSvgState({
                width: trackElement.offsetWidth,
                height: trackElement.offsetHeight,
                segments: []
            })
            return
        }

        const trackRect = trackElement.getBoundingClientRect()
        const nodeRects = nodeElements.map((nodeElement) => {
            const rect = nodeElement.getBoundingClientRect()

            return {
                left: rect.left - trackRect.left,
                right: rect.right - trackRect.left,
                top: rect.top - trackRect.top,
                bottom: rect.bottom - trackRect.top,
                width: rect.width,
                height: rect.height,
                centerX: rect.left - trackRect.left + rect.width / 2,
                centerY: rect.top - trackRect.top + rect.height / 2
            }
        })

        const segments: PathSegment[] = []

        for (let i = 0; i < nodeRects.length - 1; i += 1) {
            const current = nodeRects[i]
            const next = nodeRects[i + 1]

            const sameRow = Math.abs(current.centerY - next.centerY) < Math.min(current.height, next.height) * 0.45
            let d = ""

            if (sameRow) {
                d = `M ${current.right} ${current.centerY} L ${next.left} ${next.centerY}`
            } else {
                const routeY = current.bottom + Math.max(12, (next.top - current.bottom) / 2)

                d = [
                    `M ${current.centerX} ${current.bottom}`,
                    `L ${current.centerX} ${routeY}`,
                    `L ${next.centerX} ${routeY}`,
                    `L ${next.centerX} ${next.top}`
                ].join(" ")
            }

            segments.push({
                key: `module-path-connector-${i}`,
                d,
                completed: Boolean(pathCompletionStates[i])
            })
        }

        setPathSvgState({
            width: trackRect.width,
            height: trackRect.height,
            segments
        })
    }, [pathCompletionStates])

    const loadModuleDetails = () => {
        if (!classId || !moduleId) {
            setErrorMessage("Could not find this module.")
            setIsLoading(false)
            return
        }

        setIsLoading(true)
        setErrorMessage("")

        axios
            .get(`${import.meta.env.VITE_API_URL}/projects/get_module_overview_student?module_id=${moduleId}`, {
                headers: authHeader()
            })
            .then((res) => {
                const selectedModule = res.data?.module || null

                if (!selectedModule) {
                    setModule(null)
                    setPracticeProblems([])
                    setErrorMessage("Could not find this module.")
                    setIsLoading(false)
                    return
                }

                setModule(selectedModule)
                setPracticeProblems(res.data?.practiceProblems || [])
                setIsLoading(false)
            })
            .catch((err) => {
                console.log(err)
                setModule(null)
                setPracticeProblems([])
                setErrorMessage("Could not load this module.")
                setIsLoading(false)
            })
    }

    useEffect(() => {
        loadModuleDetails()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [classId, moduleId])

    useLayoutEffect(() => {
        recalculatePathConnectors()

        const trackElement = modulePathTrackRef.current
        if (!trackElement) return

        const resizeObserver = new ResizeObserver(() => {
            recalculatePathConnectors()
        })

        resizeObserver.observe(trackElement)

        Array.from(
            trackElement.querySelectorAll<HTMLElement>("[data-module-path-node='true']")
        ).forEach((nodeElement) => {
            resizeObserver.observe(nodeElement)
        })

        window.addEventListener("resize", recalculatePathConnectors)

        return () => {
            resizeObserver.disconnect()
            window.removeEventListener("resize", recalculatePathConnectors)
        }
    }, [
        recalculatePathConnectors,
        sortedPracticeProblems.length,
        mainCompleted,
        allPracticeSolved,
        isLoading,
        module?.Id
    ])

    const goBackToModules = () => {
        navigate(`/student/school/${schoolId}/class/${classId}/modules`)
    }

    const openPracticeProblem = (practiceProblemId: number) => {
        if (!mainProjectId) return

        navigate(
            `/student/school/${schoolId}/class/${classId}/module/${moduleId}/project/${mainProjectId}/practice/${practiceProblemId}/upload`
        )
    }

    const openMainProject = () => {
        if (!mainProjectId || !allPracticeSolved) return

        navigate(
            `/student/school/${schoolId}/class/${classId}/module/${moduleId}/project/${mainProjectId}/upload`
        )
    }

    const handlePracticeKeyDown = (
        event: KeyboardEvent<HTMLElement>,
        practiceProblemId: number,
        locked: boolean
    ) => {
        if (locked || (event.key !== "Enter" && event.key !== " ")) return

        event.preventDefault()
        openPracticeProblem(practiceProblemId)
    }

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
                    { label: "School Selection", to: "/student/schools" },
                    {
                        label: "Class Selection",
                        to: schoolId ? `/student/school/${schoolId}/classes` : "/student/schools"
                    },
                    {
                        label: "Module List",
                        to: `/student/school/${schoolId}/class/${classId}/modules`
                    },
                    { label: "Module Details" }
                ]}
            />

            <div className="pageTitle">Student Module Details</div>

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
                                    style={{ "--progress-percent": `${progressPercent}%` } as CSSProperties}
                                >
                                    <span>{progressPercent}%</span>
                                </div>

                                <div>
                                    <div className="module-quest-progress-title">
                                        {completedAssignmentCount} / {totalAssignmentCount} assignments completed
                                    </div>
                                </div>
                            </div>
                        </section>

                        <section className="module-path-section" aria-label="Practice problem unlock path">
                            <div className="module-path-header">
                                <div>
                                    <h2>Checkpoint Path</h2>
                                    <p>Complete the practice checkpoints to unlock the main project.</p>
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
                                                segment.completed ? "is-complete" : ""
                                            ].join(" ").trim()}
                                            d={segment.d}
                                            key={segment.key}
                                        />
                                    ))}
                                </svg>

                                {sortedPracticeProblems.length === 0 ? (
                                    <div className="module-path-empty">
                                        No practice checkpoints are available yet. The main project is open.
                                    </div>
                                ) : null}

                                {sortedPracticeProblems.map((problem, index) => {
                                    const locked = !problem.solved && index > activePracticeIndex
                                    const available = !problem.solved && !locked
                                    const completed = problem.solved

                                    return (
                                        <article
                                            className={[
                                                "module-path-node",
                                                completed ? "is-complete" : "",
                                                available ? "is-active" : "",
                                                locked ? "is-locked" : ""
                                            ].join(" ").trim()}
                                            key={problem.id}
                                            data-module-path-node="true"
                                            role={locked ? "article" : "button"}
                                            tabIndex={locked ? -1 : 0}
                                            onClick={() => {
                                                if (!locked) openPracticeProblem(problem.id)
                                            }}
                                            onKeyDown={(event) => handlePracticeKeyDown(event, problem.id, locked)}
                                            aria-label={`${problem.name} ${completed ? "completed" : locked ? "locked" : "available"}`}
                                        >
                                            <div className="module-path-node-icon">
                                                {completed ? <FaCheck aria-hidden="true" /> : locked ? <FaLock aria-hidden="true" /> : <FaPlay aria-hidden="true" />}
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
                                    )
                                })}

                                <article
                                    className={[
                                        "module-path-node",
                                        "module-path-main-node",
                                        mainCompleted ? "is-complete" : allPracticeSolved ? "is-active" : "is-locked"
                                    ].join(" ").trim()}
                                    data-module-path-node="true"
                                    role={allPracticeSolved ? "button" : "article"}
                                    tabIndex={allPracticeSolved ? 0 : -1}
                                    onClick={openMainProject}
                                    onKeyDown={(event) => {
                                        if (!allPracticeSolved || (event.key !== "Enter" && event.key !== " ")) return

                                        event.preventDefault()
                                        openMainProject()
                                    }}
                                    aria-label={`Main assignment ${mainCompleted ? "completed" : allPracticeSolved ? "unlocked" : "locked"}`}
                                >
                                    <div className="module-path-node-icon">
                                        {mainCompleted ? <FaCheck aria-hidden="true" /> : allPracticeSolved ? <FaTrophy aria-hidden="true" /> : <FaLock aria-hidden="true" />}
                                    </div>

                                    <div className="module-path-node-content">
                                        <div className="module-path-node-label">Main Project</div>
                                        <h3>Main Assignment</h3>
                                        <p>
                                            {mainCompleted
                                                ? "Completed"
                                                : allPracticeSolved
                                                    ? "Unlocked. Submit your main solution."
                                                    : "Locked until all practice checkpoints are cleared."}
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
    )
}