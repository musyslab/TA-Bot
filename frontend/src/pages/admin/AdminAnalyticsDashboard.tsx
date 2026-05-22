import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { Helmet } from "react-helmet";
import { Link, useParams } from "react-router-dom";
import {
    FaCheckCircle,
    FaClipboardCheck,
    FaExclamationTriangle,
    FaEye,
    FaFilter,
    FaFolderOpen,
    FaSearch,
    FaSortAlphaDown,
    FaTimesCircle,
} from "react-icons/fa";

import MenuComponent from "../components/MenuComponent";
import DirectoryBreadcrumbs from "../components/DirectoryBreadcrumbs";
import LoadingAnimation from "../components/LoadingAnimation";
import "../../styling/Selection.scss";
import "../../styling/AdminAnalyticsDashboard.scss";

const API_URL = import.meta.env.VITE_API_URL;

type RouteParams = {
    school_id: string;
    class_id: string;
};

type RawModule = {
    Id: number;
    ClassId: number;
    Name: string;
    Start?: string;
    End?: string;
    MainProjectId?: number | null;
    MainProjectName?: string;
};

type RawProject = {
    Id: number;
    Name: string;
    Start?: string;
    End?: string;
    TotalSubmissions?: number;
    CheckpointTotalSubmissions?: number;
    ModuleId?: number | null;
};

type RawCheckpoint = {
    id?: number;
    Id?: number;
    checkpointId?: number;
    CheckpointId?: number;
    number?: number;
    Number?: number;
    name?: string;
    Name?: string;
    enabled?: boolean;
    Enabled?: boolean;
};

type DashboardItemKind = "main" | "checkpoint";

type DashboardItem = {
    id: string;
    kind: DashboardItemKind;
    projectId: number;
    projectName: string;
    moduleId: number;
    moduleName: string;
    isFirstInModule: boolean;
    checkpointId?: number;
    checkpointNumber?: number;
    checkpointName?: string;
    label: string;
    shortLabel: string;
};

type StudentSummary = {
    userId: number;
    firstName: string;
    lastName: string;
    fullName: string;
    studentNumber: string;
    lecture: string;
    lab: string;
    isLocked: boolean;
};

type ProgressCell = {
    studentUserId: number;
    itemId: string;
    item: DashboardItem;
    attempts: number;
    lastSubmitted: string;
    passed: boolean | null;
    submissionId: number | null;
    grade: string;
};

type StudentProgressRow = StudentSummary & {
    cells: Record<string, ProgressCell>;
    completed: number;
    attempted: number;
    total: number;
    percentComplete: number;
};

type SortMode = "last-asc" | "last-desc";

type AnalyticsDashboardPayload = {
    modules: RawModule[];
    projects: RawProject[];
    checkpointsByProjectId: Record<string, RawCheckpoint[]>;
    submissionsByItemId: Record<string, Record<string, unknown>>;
};

function authHeaders() {
    const rawToken = localStorage.getItem("AUTOTA_AUTH_TOKEN") || "";
    const token = rawToken.trim();

    return {
        Authorization: token.startsWith("Bearer ")
            ? token
            : `Bearer ${token}`,
    };
}

function parseMaybeJson<T>(value: unknown, fallback: T): T {
    if (typeof value === "string") {
        try {
            return JSON.parse(value) as T;
        } catch {
            return fallback;
        }
    }

    return (value as T) ?? fallback;
}


function asNumber(value: unknown, fallback = 0): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function asString(value: unknown, fallback = ""): string {
    if (value === null || value === undefined) {
        return fallback;
    }

    return String(value);
}

function isRealSubmissionId(value: unknown): boolean {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0;
}

function isPassingValue(value: unknown): boolean | null {
    if (
        value === true ||
        value === "true" ||
        value === "True" ||
        value === 1 ||
        value === "1"
    ) {
        return true;
    }

    if (
        value === false ||
        value === "false" ||
        value === "False" ||
        value === 0 ||
        value === "0"
    ) {
        return false;
    }

    return null;
}

function formatDateTime(value: string): string {
    if (!value || value === "N/A") {
        return "";
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return value;
    }

    return parsed.toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
    });
}

function normalizeAttempts(value: unknown): number {
    if (value === "N/A" || value === null || value === undefined) {
        return 0;
    }

    return asNumber(value, 0);
}

function normalizeCheckpoint(
    row: RawCheckpoint,
    index: number,
): {
    checkpointId: number;
    checkpointNumber: number;
    checkpointName: string;
} | null {
    const checkpointId = asNumber(
        row.id ?? row.Id ?? row.checkpointId ?? row.CheckpointId,
        0,
    );

    if (checkpointId <= 0) {
        return null;
    }

    const checkpointNumber = asNumber(row.number ?? row.Number, index + 1);
    const checkpointName = asString(
        row.name ?? row.Name,
        `Checkpoint ${checkpointNumber}`,
    );

    return {
        checkpointId,
        checkpointNumber,
        checkpointName,
    };
}

function normalizeStudentAndCell(
    userIdRaw: string,
    rawRow: unknown,
    item: DashboardItem,
): {
    student: StudentSummary;
    cell: ProgressCell;
} | null {
    if (!Array.isArray(rawRow)) {
        return null;
    }

    const userId = asNumber(userIdRaw, 0);
    if (userId <= 0) {
        return null;
    }

    const lastName = asString(rawRow[0]);
    const firstName = asString(rawRow[1]);
    const lecture = asString(rawRow[2]);
    const lab = asString(rawRow[3]);
    const attempts = normalizeAttempts(rawRow[4]);
    const lastSubmitted = asString(rawRow[5]);
    const passed = isPassingValue(rawRow[6]);
    const submissionId = isRealSubmissionId(rawRow[7]) ? asNumber(rawRow[7]) : null;

    const rowHasSubmissionShape = submissionId !== null;
    const grade = rowHasSubmissionShape
        ? asString(rawRow[9], "0")
        : asString(rawRow[10], "0");
    const studentNumber = rowHasSubmissionShape
        ? asString(rawRow[10])
        : asString(rawRow[11]);
    const isLocked = rowHasSubmissionShape
        ? Boolean(rawRow[11])
        : Boolean(rawRow[12]);

    return {
        student: {
            userId,
            firstName,
            lastName,
            fullName: `${firstName} ${lastName}`.trim() || `Student ${userId}`,
            studentNumber,
            lecture,
            lab,
            isLocked,
        },
        cell: {
            studentUserId: userId,
            itemId: item.id,
            item,
            attempts,
            lastSubmitted,
            passed,
            submissionId,
            grade,
        },
    };
}

function cellStatus(cell: ProgressCell | undefined): "complete" | "in-progress" | "not-started" {
    if (!cell || cell.attempts <= 0 || !cell.submissionId) {
        return "not-started";
    }

    if (cell.passed === true) {
        return "complete";
    }

    return "in-progress";
}

function statusLabel(status: ReturnType<typeof cellStatus>): string {
    if (status === "complete") {
        return "Complete";
    }

    if (status === "in-progress") {
        return "Attempted";
    }

    return "Not started";
}

function statusIcon(status: ReturnType<typeof cellStatus>) {
    if (status === "complete") {
        return <FaCheckCircle aria-hidden="true" />;
    }

    if (status === "in-progress") {
        return <FaExclamationTriangle aria-hidden="true" />;
    }

    return <FaTimesCircle aria-hidden="true" />;
}

function compareStudents(a: StudentProgressRow, b: StudentProgressRow, sortMode: SortMode) {
    const lastCompare = a.lastName.localeCompare(b.lastName);
    const firstCompare = a.firstName.localeCompare(b.firstName);

    if (sortMode === "last-desc") {
        return lastCompare !== 0 ? -lastCompare : -firstCompare;
    }

    return lastCompare !== 0 ? lastCompare : firstCompare;
}

export default function AdminAnalyticsDashboard() {
    const { school_id, class_id } = useParams<RouteParams>();

    const schoolId = school_id || "";
    const classId = class_id || "";

    const [items, setItems] = useState<DashboardItem[]>([]);
    const [students, setStudents] = useState<StudentProgressRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [searchText, setSearchText] = useState("");
    const [lectureFilter, setLectureFilter] = useState("all");
    const [labFilter, setLabFilter] = useState("all");
    const [sortMode, setSortMode] = useState<SortMode>("last-asc");
    const [hoveredStudentId, setHoveredStudentId] = useState<number | null>(null);
    const [hoveredItemId, setHoveredItemId] = useState<string | null>(null);
    const tableScrollRef = useRef<HTMLDivElement | null>(null);
    const bottomScrollRef = useRef<HTMLDivElement | null>(null);
    const [bottomScrollWidth, setBottomScrollWidth] = useState(0);

    useEffect(() => {
        let cancelled = false;

        async function loadDashboard() {
            setLoading(true);
            setError("");

            const token = localStorage.getItem("AUTOTA_AUTH_TOKEN");

            if (!classId || !token) {
                setItems([]);
                setStudents([]);
                setLoading(false);
                setError("You must be logged in to view the analytics dashboard.");
                return;
            }

            try {
                const dashboardResponse = await axios.get(
                    `${API_URL}/projects/analytics_dashboard`,
                    {
                        headers: authHeaders(),
                        params: { class_id: classId },
                    },
                );

                const payload = parseMaybeJson<AnalyticsDashboardPayload>(
                    dashboardResponse.data,
                    {
                        modules: [],
                        projects: [],
                        checkpointsByProjectId: {},
                        submissionsByItemId: {},
                    },
                );

                const modules = Array.isArray(payload.modules) ? payload.modules : [];
                const projects = Array.isArray(payload.projects) ? payload.projects : [];
                const checkpointsByProjectId = payload.checkpointsByProjectId || {};
                const submissionsByItemId = payload.submissionsByItemId || {};

                const moduleById = new Map<number, RawModule>();
                modules.forEach((module) => {
                    if (Number(module.Id) > 0) {
                        moduleById.set(Number(module.Id), module);
                    }
                });

                const orderedProjects = [...projects].sort((a, b) => {
                    const moduleA = asNumber(a.ModuleId, 0);
                    const moduleB = asNumber(b.ModuleId, 0);

                    if (moduleA !== moduleB) {
                        return moduleA - moduleB;
                    }

                    return asNumber(a.Id) - asNumber(b.Id);
                });

                const dashboardItems: DashboardItem[] = [];
                let lastModuleId: number | null = null;

                orderedProjects.forEach((project) => {
                    const projectId = asNumber(project.Id, 0);

                    if (projectId <= 0) {
                        return;
                    }

                    const moduleId = asNumber(project.ModuleId, 0);
                    const module = moduleById.get(moduleId);
                    const moduleName = module?.Name || "Unassigned Module";
                    const projectName = project.Name || "Assignment";
                    const isFirstProjectInModule = lastModuleId !== moduleId;
                    const checkpointRows = checkpointsByProjectId[String(projectId)] || [];

                    const checkpoints = checkpointRows
                        .map((row, index) => normalizeCheckpoint(row, index))
                        .filter((row): row is NonNullable<typeof row> => row !== null);

                    checkpoints.forEach((checkpoint, index) => {
                        dashboardItems.push({
                            id: `checkpoint-${projectId}-${checkpoint.checkpointId}`,
                            kind: "checkpoint",
                            projectId,
                            projectName,
                            moduleId,
                            moduleName,
                            isFirstInModule: isFirstProjectInModule && index === 0,
                            checkpointId: checkpoint.checkpointId,
                            checkpointNumber: checkpoint.checkpointNumber,
                            checkpointName: checkpoint.checkpointName,
                            label: `${moduleName}: ${checkpoint.checkpointName}`,
                            shortLabel: `CP ${checkpoint.checkpointNumber}`,
                        });
                    });

                    dashboardItems.push({
                        id: `main-${projectId}`,
                        kind: "main",
                        projectId,
                        projectName,
                        moduleId,
                        moduleName,
                        isFirstInModule: isFirstProjectInModule && checkpoints.length === 0,
                        label: `${moduleName}: Main Program`,
                        shortLabel: "Main Program",
                    });

                    lastModuleId = moduleId;
                });

                const studentMap = new Map<number, StudentSummary>();
                const cellMap = new Map<number, Record<string, ProgressCell>>();

                dashboardItems.forEach((item) => {
                    const rows = submissionsByItemId[item.id] || {};

                    Object.entries(rows).forEach(([userIdRaw, rawRow]) => {
                        const normalized = normalizeStudentAndCell(
                            userIdRaw,
                            rawRow,
                            item,
                        );

                        if (!normalized) {
                            return;
                        }

                        const { student, cell } = normalized;

                        studentMap.set(student.userId, {
                            ...studentMap.get(student.userId),
                            ...student,
                        });

                        const existingCells = cellMap.get(student.userId) || {};
                        existingCells[item.id] = cell;
                        cellMap.set(student.userId, existingCells);
                    });
                });

                const rows: StudentProgressRow[] = Array.from(studentMap.values())
                    .sort((a, b) => {
                        const lastCompare = a.lastName.localeCompare(b.lastName);

                        if (lastCompare !== 0) {
                            return lastCompare;
                        }

                        return a.firstName.localeCompare(b.firstName);
                    })
                    .map((student) => {
                        const cells = cellMap.get(student.userId) || {};
                        const completed = dashboardItems.filter(
                            (item) => cellStatus(cells[item.id]) === "complete",
                        ).length;
                        const attempted = dashboardItems.filter(
                            (item) => cellStatus(cells[item.id]) !== "not-started",
                        ).length;
                        const total = dashboardItems.length;
                        const percentComplete = total > 0
                            ? Math.round((completed / total) * 100)
                            : 0;

                        return {
                            ...student,
                            cells,
                            completed,
                            attempted,
                            total,
                            percentComplete,
                        };
                    });

                if (!cancelled) {
                    setItems(dashboardItems);
                    setStudents(rows);
                }
            } catch (err) {
                if (!cancelled) {
                    console.error(err);
                    setError("Could not load the analytics dashboard.");
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        }

        loadDashboard();

        return () => {
            cancelled = true;
        };
    }, [classId]);

    const lectureOptions = useMemo(() => {
        return Array.from(
            new Set(students.map((student) => student.lecture).filter(Boolean)),
        ).sort((a, b) => a.localeCompare(b));
    }, [students]);

    const labOptions = useMemo(() => {
        return Array.from(
            new Set(students.map((student) => student.lab).filter(Boolean)),
        ).sort((a, b) => a.localeCompare(b));
    }, [students]);

    const filteredStudents = useMemo(() => {
        const normalizedSearch = searchText.trim().toLowerCase();

        return students
            .filter((student) => {
                const matchesSearch =
                    !normalizedSearch ||
                    student.fullName.toLowerCase().includes(normalizedSearch);

                if (!matchesSearch) {
                    return false;
                }

                if (lectureFilter !== "all" && student.lecture !== lectureFilter) {
                    return false;
                }

                if (labFilter !== "all" && student.lab !== labFilter) {
                    return false;
                }

                return true;
            })
            .sort((a, b) => compareStudents(a, b, sortMode));
    }, [students, searchText, lectureFilter, labFilter, sortMode]);

    const modulesForHeader = useMemo(() => {
        const groups: {
            moduleId: number;
            moduleName: string;
            span: number;
        }[] = [];

        items.forEach((item) => {
            const existing = groups[groups.length - 1];

            if (existing && existing.moduleId === item.moduleId) {
                existing.span += 1;
            } else {
                groups.push({
                    moduleId: item.moduleId,
                    moduleName: item.moduleName,
                    span: 1,
                });
            }
        });

        return groups;
    }, [items]);

    useEffect(() => {
        function updateBottomScrollWidth() {
            if (!tableScrollRef.current) {
                setBottomScrollWidth(0);
                return;
            }

            setBottomScrollWidth(tableScrollRef.current.scrollWidth);
        }

        updateBottomScrollWidth();

        window.addEventListener("resize", updateBottomScrollWidth);

        const resizeObserver = new ResizeObserver(updateBottomScrollWidth);

        if (tableScrollRef.current) {
            resizeObserver.observe(tableScrollRef.current);
        }

        return () => {
            window.removeEventListener("resize", updateBottomScrollWidth);
            resizeObserver.disconnect();
        };
    }, [items, filteredStudents.length]);

    function syncTableScroll() {
        const table = tableScrollRef.current;
        const bottom = bottomScrollRef.current;

        if (!table || !bottom) {
            return;
        }

        if (bottom.scrollLeft !== table.scrollLeft) {
            bottom.scrollLeft = table.scrollLeft;
        }
    }

    function syncBottomScroll() {
        if (!tableScrollRef.current || !bottomScrollRef.current) {
            return;
        }

        if (tableScrollRef.current.scrollLeft !== bottomScrollRef.current.scrollLeft) {
            tableScrollRef.current.scrollLeft = bottomScrollRef.current.scrollLeft;
        }
    }

    function gradePath(cell: ProgressCell): string {
        const sourceQuery = "?from=analytics";

        if (cell.item.kind === "checkpoint") {
            return `/admin/school/${schoolId}/class/${classId}/module/${cell.item.moduleId}/project/${cell.item.projectId}/checkpoint/${cell.item.checkpointId}/grade/${cell.submissionId}${sourceQuery}`;
        }

        return `/admin/school/${schoolId}/class/${classId}/module/${cell.item.moduleId}/project/${cell.item.projectId}/grade/${cell.submissionId}${sourceQuery}`;
    }

    function viewPath(cell: ProgressCell): string {
        const sourceQuery = "?from=analytics";

        if (cell.item.kind === "checkpoint") {
            return `/admin/school/${schoolId}/class/${classId}/module/${cell.item.moduleId}/project/${cell.item.projectId}/checkpoint/${cell.item.checkpointId}/codeview/${cell.submissionId}${sourceQuery}`;
        }

        return `/admin/school/${schoolId}/class/${classId}/module/${cell.item.moduleId}/project/${cell.item.projectId}/codeview/${cell.submissionId}${sourceQuery}`;
    }

    function submissionsPath(item: DashboardItem): string {
        if (item.kind === "checkpoint") {
            return `/admin/school/${schoolId}/class/${classId}/module/${item.moduleId}/project/${item.projectId}/checkpoint/${item.checkpointId}/submissions`;
        }

        return `/admin/school/${schoolId}/class/${classId}/module/${item.moduleId}/project/${item.projectId}/submissions`;
    }

    function renderProgressCell(student: StudentProgressRow, item: DashboardItem) {
        const cell = student.cells[item.id];
        const status = cellStatus(cell);
        const isHoveredRow = hoveredStudentId === student.userId;
        const isHoveredColumn = hoveredItemId === item.id;
        const isHoveredIntersection = isHoveredRow && isHoveredColumn;

        return (
            <td
                className={[
                    "analytics-cell",
                    `analytics-cell-${status}`,
                    item.isFirstInModule ? "analytics-module-start" : "",
                    isHoveredColumn ? "analytics-column-highlight" : "",
                    isHoveredIntersection ? "analytics-intersection-highlight" : "",
                ]
                    .join(" ")
                    .trim()}
                key={item.id}
                onMouseEnter={() => {
                    setHoveredStudentId(student.userId);
                    setHoveredItemId(item.id);
                }}
            >
                <div className="analytics-cell-card">
                    <div className="analytics-cell-status">
                        {statusIcon(status)}
                        <span>{statusLabel(status)}</span>
                    </div>

                    <div className="analytics-cell-meta">
                        {cell?.attempts ? (
                            <span>
                                {cell.attempts} attempt{cell.attempts === 1 ? "" : "s"}
                            </span>
                        ) : (
                            <span>No attempts</span>
                        )}

                        {cell?.lastSubmitted && cell.lastSubmitted !== "N/A" ? (
                            <span>{formatDateTime(cell.lastSubmitted)}</span>
                        ) : null}

                        {cell?.grade && cell.grade !== "0" ? (
                            <span>Grade: {cell.grade}</span>
                        ) : null}
                    </div>

                    <div className="analytics-cell-actions">
                        {cell?.submissionId ? (
                            <>
                                <Link to={viewPath(cell)} title="View submission">
                                    <FaEye aria-hidden="true" />
                                    <span>View</span>
                                </Link>

                                <Link to={gradePath(cell)} title="Open grading">
                                    <FaClipboardCheck aria-hidden="true" />
                                    <span>Grade</span>
                                </Link>
                            </>
                        ) : status !== "not-started" ? (
                            <Link to={submissionsPath(item)} title="Open submissions">
                                <FaFolderOpen aria-hidden="true" />
                                <span>Submissions</span>
                            </Link>
                        ) : null}
                    </div>
                </div>
            </td>
        );
    }

    return (
        <div className="projects-page admin-analytics-page">
            <Helmet>
                <title>[Admin] MAAT</title>
            </Helmet>

            <LoadingAnimation
                show={loading}
                message="Loading analytics dashboard..."
            />

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
                    { label: "School Selection", to: "/admin/schools" },
                    {
                        label: "Class Selection",
                        to: schoolId
                            ? `/admin/school/${schoolId}/classes`
                            : "/admin/schools",
                    },
                    {
                        label: "Admin Menu",
                        to: `/admin/school/${schoolId}/class/${classId}/menu`,
                    },
                    { label: "Analytics Dashboard" },
                ]}
                trailingSeparator={true}
            />

            <div className="pageTitle">Analytics Dashboard</div>

            <p className="analytics-subtitle">
                View each student's progress across every module checkpoint and main program in this class.
            </p>

            {error ? (
                <section className="analytics-error" role="alert">
                    <FaExclamationTriangle aria-hidden="true" />
                    <span>{error}</span>
                </section>
            ) : (
                <>
                    <section className="analytics-toolbar" aria-label="Dashboard filters">
                        <label className="analytics-search">
                            <FaSearch aria-hidden="true" />
                            <input
                                type="search"
                                value={searchText}
                                onChange={(event) => setSearchText(event.target.value)}
                                placeholder="Search student names"
                            />
                        </label>

                        <label className="analytics-filter">
                            <FaFilter aria-hidden="true" />
                            <select
                                value={lectureFilter}
                                onChange={(event) => setLectureFilter(event.target.value)}
                            >
                                <option value="all">All lectures</option>
                                {lectureOptions.map((lecture) => (
                                    <option value={lecture} key={lecture}>
                                        Lecture: {lecture}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label className="analytics-filter">
                            <FaFilter aria-hidden="true" />
                            <select
                                value={labFilter}
                                onChange={(event) => setLabFilter(event.target.value)}
                            >
                                <option value="all">All labs</option>
                                {labOptions.map((lab) => (
                                    <option value={lab} key={lab}>
                                        Lab: {lab}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label className="analytics-filter analytics-sort-filter">
                            <FaSortAlphaDown aria-hidden="true" />
                            <select
                                value={sortMode}
                                onChange={(event) => setSortMode(event.target.value as SortMode)}
                            >
                                <option value="last-asc">Last name A-Z</option>
                                <option value="last-desc">Last name Z-A</option>
                            </select>
                        </label>
                    </section>

                    {items.length === 0 && !loading ? (
                        <section className="analytics-empty">
                            No modules, checkpoints, or main programs were found for this class.
                        </section>
                    ) : filteredStudents.length === 0 && !loading ? (
                        <section className="analytics-empty">
                            No students match the current filters.
                        </section>
                    ) : (
                        <section className="analytics-table-shell" aria-label="Student progress table">
                            <div
                                className="analytics-table-scroll"
                                ref={tableScrollRef}
                                onScroll={syncTableScroll}
                            >
                                <table className="analytics-table">
                                    <thead>
                                        <tr className="analytics-module-row">
                                            <th className="analytics-student-heading" rowSpan={2}>
                                                Student
                                            </th>
                                            {modulesForHeader.map((module) => (
                                                <th
                                                    className="analytics-module-heading"
                                                    colSpan={module.span}
                                                    key={`${module.moduleId}-${module.moduleName}`}
                                                >
                                                    {module.moduleName}
                                                </th>
                                            ))}
                                        </tr>

                                        <tr className="analytics-item-row">
                                            {items.map((item) => (
                                                <th
                                                    className={[
                                                        "analytics-item-heading",
                                                        `analytics-item-heading-${item.kind}`,
                                                        item.isFirstInModule ? "analytics-module-start" : "",
                                                        hoveredItemId === item.id ? "analytics-column-header-highlight" : "",
                                                    ]
                                                        .join(" ")
                                                        .trim()}
                                                    key={item.id}
                                                    title={item.label}
                                                    onMouseEnter={() => setHoveredItemId(item.id)}
                                                    onMouseLeave={() => setHoveredItemId(null)}
                                                >
                                                    {item.shortLabel}
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>

                                    <tbody>
                                        {filteredStudents.map((student) => (
                                            <tr
                                                key={student.userId}
                                                className={hoveredStudentId === student.userId ? "analytics-row-highlight" : ""}
                                                onMouseEnter={() => setHoveredStudentId(student.userId)}
                                                onMouseLeave={() => {
                                                    setHoveredStudentId(null);
                                                    setHoveredItemId(null);
                                                }}
                                            >
                                                <th className="analytics-student-cell" scope="row">
                                                    <div className="analytics-student-name-row">
                                                        <span className="analytics-student-name">
                                                            {student.fullName}
                                                        </span>

                                                        {student.isLocked ? (
                                                            <span className="analytics-locked-pill">
                                                                Locked
                                                            </span>
                                                        ) : null}
                                                    </div>

                                                    <div className="analytics-student-meta">
                                                        {student.studentNumber ? (
                                                            <span>ID: {student.studentNumber}</span>
                                                        ) : null}

                                                        {student.lecture ? (
                                                            <span>Lecture: {student.lecture}</span>
                                                        ) : null}

                                                        {student.lab ? (
                                                            <span>Lab: {student.lab}</span>
                                                        ) : null}
                                                    </div>
                                                </th>

                                                {items.map((item) => renderProgressCell(student, item))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            <div
                                className="analytics-bottom-scrollbar"
                                ref={bottomScrollRef}
                                onScroll={syncBottomScroll}
                                aria-hidden="true"
                            >
                                <div
                                    className="analytics-bottom-scrollbar-spacer"
                                    style={{ width: `${bottomScrollWidth}px` }}
                                />
                            </div>
                        </section>
                    )}
                </>
            )}
        </div>
    );
}