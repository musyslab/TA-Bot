import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { Helmet } from "react-helmet";
import { Link, useParams } from "react-router-dom";
import {
    FaCheckCircle,
    FaClipboardCheck,
    FaExclamationTriangle,
    FaEye,
    FaEyeSlash,
    FaFilter,
    FaFolderOpen,
    FaSearch,
    FaSortAlphaDown,
    FaTimesCircle,
    FaUsers,
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

type ClassAccessResponse = {
    id?: number;
    name?: string;
    school_id?: number;
    school_name?: string;
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

type ModuleVisibilityOption = {
    moduleId: number;
    moduleName: string;
    itemCount: number;
};

type AnalyticsDashboardPayload = {
    modules: RawModule[];
    projects: RawProject[];
    checkpointsByProjectId: Record<string, RawCheckpoint[]>;
    submissionsByItemId: Record<string, Record<string, unknown>>;
    hiddenModulesByStudentId?: Record<string, unknown>;
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

function normalizeHiddenModuleMap(value: Record<string, unknown> | undefined): Record<number, number[]> {
    const normalized: Record<number, number[]> = {};

    Object.entries(value || {}).forEach(([userIdRaw, moduleIdsRaw]) => {
        const userId = asNumber(userIdRaw, 0);

        if (userId <= 0 || !Array.isArray(moduleIdsRaw)) {
            return;
        }

        const moduleIds = moduleIdsRaw
            .map((moduleId) => asNumber(moduleId, 0))
            .filter((moduleId) => moduleId > 0);

        if (moduleIds.length > 0) {
            normalized[userId] = Array.from(new Set(moduleIds));
        }
    });

    return normalized;
}

export default function AdminAnalyticsDashboard() {
    const { school_id, class_id } = useParams<RouteParams>();

    const schoolId = school_id || "";
    const classId = class_id || "";

    const [className, setClassName] = useState("");
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
    const [studentHiddenModuleIds, setStudentHiddenModuleIds] = useState<Record<number, number[]>>({});
    const tableScrollRef = useRef<HTMLDivElement | null>(null);
    const bottomScrollRef = useRef<HTMLDivElement | null>(null);
    const [bottomScrollWidth, setBottomScrollWidth] = useState(0);

    useEffect(() => {
        let cancelled = false;

        async function loadClassName() {
            const token = localStorage.getItem("AUTOTA_AUTH_TOKEN");

            if (!schoolId || !classId || !token) {
                setClassName("");
                return;
            }

            try {
                const classResponse = await axios.get<ClassAccessResponse>(
                    `${API_URL}/class/id/${classId}/access`,
                    {
                        headers: authHeaders(),
                        params: {
                            school_id: schoolId,
                            role_context: "admin",
                        },
                    },
                );

                if (!cancelled) {
                    setClassName(classResponse.data?.name || "");
                }
            } catch (err) {
                console.error(err);

                if (!cancelled) {
                    setClassName("");
                }
            }
        }

        async function loadDashboard() {
            setLoading(true);
            setError("");

            const token = localStorage.getItem("AUTOTA_AUTH_TOKEN");

            if (!classId || !token) {
                setItems([]);
                setStudents([]);
                setStudentHiddenModuleIds({});
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
                        hiddenModulesByStudentId: {},
                    },
                );

                const modules = Array.isArray(payload.modules) ? payload.modules : [];
                const projects = Array.isArray(payload.projects) ? payload.projects : [];
                const checkpointsByProjectId = payload.checkpointsByProjectId || {};
                const submissionsByItemId = payload.submissionsByItemId || {};
                const hiddenModulesByStudentId = normalizeHiddenModuleMap(
                    payload.hiddenModulesByStudentId,
                );

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
                    setStudentHiddenModuleIds(hiddenModulesByStudentId);
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

        loadClassName();
        loadDashboard();

        return () => {
            cancelled = true;
        };
    }, [schoolId, classId]);

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

    const moduleVisibilityOptions = useMemo<ModuleVisibilityOption[]>(() => {
        return modulesForHeader.map((module) => ({
            moduleId: module.moduleId,
            moduleName: module.moduleName,
            itemCount: module.span,
        }));
    }, [modulesForHeader]);

    useEffect(() => {
        const validModuleIds = new Set(
            moduleVisibilityOptions.map((module) => module.moduleId),
        );
        const validStudentIds = new Set(students.map((student) => student.userId));

        setStudentHiddenModuleIds((current) => {
            const next: Record<number, number[]> = {};

            Object.entries(current).forEach(([userIdRaw, moduleIds]) => {
                const userId = Number(userIdRaw);

                if (!validStudentIds.has(userId)) {
                    return;
                }

                const validHiddenModules = moduleIds.filter((moduleId) => (
                    validModuleIds.has(moduleId)
                ));

                if (validHiddenModules.length > 0) {
                    next[userId] = validHiddenModules;
                }
            });

            return next;
        });
    }, [moduleVisibilityOptions, students]);

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
    }, [items, filteredStudents.length, studentHiddenModuleIds]);

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

    function hasGrade(cell: ProgressCell | undefined): boolean {
        const grade = cell?.grade?.trim();

        return Boolean(
            grade &&
            grade !== "0" &&
            grade.toUpperCase() !== "N/A",
        );
    }

    function isStudentModuleHidden(userId: number, moduleId: number): boolean {
        return studentHiddenModuleIds[userId]?.includes(moduleId) ?? false;
    }

    function isModuleHiddenForEveryone(moduleId: number): boolean {
        return students.length > 0 && students.every((student) => (
            isStudentModuleHidden(student.userId, moduleId)
        ));
    }

    function confirmVisibilityChange(message: string): boolean {
        return window.confirm(message);
    }

    async function toggleStudentModuleVisibility(
        userId: number,
        moduleId: number,
        studentName: string,
        moduleName: string,
    ) {
        const currentlyHidden = isStudentModuleHidden(userId, moduleId);
        const nextHidden = !currentlyHidden;
        const action = currentlyHidden ? "show" : "hide";
        const confirmed = confirmVisibilityChange(
            [
                "Change module visibility?",
                `This will ${action} ${moduleName} for ${studentName}.`,
            ].join("\n"),
        );

        if (!confirmed) {
            return;
        }

        try {
            await axios.post(
                `${API_URL}/projects/student_module_visibility`,
                {
                    class_id: classId,
                    student_id: userId,
                    module_id: moduleId,
                    hidden: nextHidden,
                },
                { headers: authHeaders() },
            );

            setStudentHiddenModuleIds((current) => {
                const existingHiddenModules = current[userId] || [];
                const nextHiddenModules = nextHidden
                    ? Array.from(new Set([...existingHiddenModules, moduleId]))
                    : existingHiddenModules.filter((id) => id !== moduleId);

                const next = { ...current };

                if (nextHiddenModules.length > 0) {
                    next[userId] = nextHiddenModules;
                } else {
                    delete next[userId];
                }

                return next;
            });
        } catch (err) {
            console.error(err);
            setError("Could not update module visibility.");
        }
    }

    async function setModuleVisibilityForAll(
        moduleId: number,
        hidden: boolean,
        moduleName: string,
    ) {
        const action = hidden ? "hide" : "show";
        const confirmed = confirmVisibilityChange(
            [
                "Change module visibility?",
                `This will ${action} ${moduleName} for every student.`,
            ].join("\n"),
        );

        if (!confirmed) {
            return;
        }

        try {
            const response = await axios.post(
                `${API_URL}/projects/module_visibility_for_all`,
                {
                    class_id: classId,
                    module_id: moduleId,
                    hidden,
                },
                { headers: authHeaders() },
            );
            const responseStudentIds = Array.isArray(response.data?.studentIds)
                ? response.data.studentIds
                    .map((value: unknown) => asNumber(value, 0))
                    .filter((value: number) => value > 0)
                : [];
            const affectedStudentIds = responseStudentIds.length > 0
                ? responseStudentIds
                : students.map((student) => student.userId);

            setStudentHiddenModuleIds((current) => {
                const next: Record<number, number[]> = { ...current };

                affectedStudentIds.forEach((studentId) => {
                    const existingHiddenModules = next[studentId] || [];
                    const alreadyHidden = existingHiddenModules.includes(moduleId);

                    if (hidden && !alreadyHidden) {
                        next[studentId] = [...existingHiddenModules, moduleId];
                    }

                    if (!hidden && alreadyHidden) {
                        const nextHiddenModules = existingHiddenModules.filter((id) => id !== moduleId);

                        if (nextHiddenModules.length > 0) {
                            next[studentId] = nextHiddenModules;
                        } else {
                            delete next[studentId];
                        }
                    }
                });

                return next;
            });
        } catch (err) {
            console.error(err);
            setError("Could not update module visibility.");
        }
    }

    function visibleModuleCountForStudent(student: StudentProgressRow): number {
        return moduleVisibilityOptions.filter((module) => (
            !isStudentModuleHidden(student.userId, module.moduleId)
        )).length;
    }

    const modulesHiddenForEveryoneCount = useMemo(() => {
        return moduleVisibilityOptions.filter((module) => (
            students.length > 0 && students.every((student) => (
                studentHiddenModuleIds[student.userId]?.includes(module.moduleId) ?? false
            ))
        )).length;
    }, [moduleVisibilityOptions, students, studentHiddenModuleIds]);

    function renderStudentVisibilityControls(student: StudentProgressRow) {
        const visibleCount = visibleModuleCountForStudent(student);

        if (moduleVisibilityOptions.length === 0) {
            return null;
        }

        return (
            <details className="analytics-student-visibility">
                <summary className="analytics-student-visibility-summary">
                    <span className="analytics-student-visibility-label">
                        Module access
                    </span>

                    <span className="analytics-visibility-count">
                        {visibleCount}/{moduleVisibilityOptions.length} visible
                    </span>
                </summary>

                <div className="analytics-student-visibility-panel">
                    <div
                        className="analytics-student-module-list"
                        role="group"
                        aria-label={`Module access for ${student.fullName}`}
                    >
                        {moduleVisibilityOptions.map((module) => {
                            const hidden = isStudentModuleHidden(
                                student.userId,
                                module.moduleId,
                            );

                            return (
                                <button
                                    type="button"
                                    className={[
                                        "analytics-module-access-toggle",
                                        hidden ? "analytics-module-access-toggle-hidden" : "",
                                    ]
                                        .join(" ")
                                        .trim()}
                                    key={`${student.userId}-${module.moduleId}`}
                                    onClick={() => toggleStudentModuleVisibility(
                                        student.userId,
                                        module.moduleId,
                                        student.fullName,
                                        module.moduleName,
                                    )}
                                    aria-pressed={!hidden}
                                    title={
                                        hidden
                                            ? "Click to show this module for this student."
                                            : "Click to hide this module for this student."
                                    }
                                >
                                    <span className="analytics-module-access-icon">
                                        {hidden ? (
                                            <FaEyeSlash aria-hidden="true" />
                                        ) : (
                                            <FaEye aria-hidden="true" />
                                        )}
                                    </span>

                                    <span className="analytics-module-access-name">
                                        {module.moduleName}
                                    </span>

                                    <span className="analytics-module-access-state">
                                        {hidden ? "Hidden" : "Visible"}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </details>
        );
    }

    function renderProgressCell(student: StudentProgressRow, item: DashboardItem) {
        const cell = student.cells[item.id];
        const status = cellStatus(cell);
        const isHoveredRow = hoveredStudentId === student.userId;
        const isHoveredColumn = hoveredItemId === item.id;
        const isHoveredIntersection = isHoveredRow && isHoveredColumn;
        const cellHasGrade = hasGrade(cell);
        const isHidden = isStudentModuleHidden(student.userId, item.moduleId);

        return (
            <td
                className={[
                    "analytics-cell",
                    `analytics-cell-${status}`,
                    item.isFirstInModule ? "analytics-module-start" : "",
                    isHoveredColumn ? "analytics-column-highlight" : "",
                    isHoveredIntersection ? "analytics-intersection-highlight" : "",
                    isHidden ? "analytics-cell-module-hidden" : "",
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
                    {isHidden ? (
                        <div className="analytics-cell-visibility-note">
                            <FaEyeSlash aria-hidden="true" />
                            <span>Hidden</span>
                        </div>
                    ) : null}

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

                        {cellHasGrade ? (
                            <span>Grade: {cell?.grade}</span>
                        ) : cell?.submissionId ? (
                            <span>No grade yet</span>
                        ) : null}
                    </div>

                    <div className="analytics-cell-actions">
                        {cell?.submissionId ? (
                            <>
                                <Link to={viewPath(cell)} title="View submission">
                                    <FaEye aria-hidden="true" />
                                    <span>View</span>
                                </Link>

                                <Link
                                    to={gradePath(cell)}
                                    title={cellHasGrade ? "Open regrading" : "Open grading"}
                                >
                                    <FaClipboardCheck aria-hidden="true" />
                                    <span>{cellHasGrade ? "Regrade" : "Grade"}</span>
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
                    { label: "School Selection", to: "/schools" },
                    {
                        label: "Class Selection",
                        to: schoolId
                            ? `/admin/school/${schoolId}/classes`
                            : "/schools",
                    },
                    {
                        label: "Admin Menu",
                        to: `/admin/school/${schoolId}/class/${classId}/menu`,
                    },
                    { label: "Analytics Dashboard" },
                ]}
                trailingSeparator={true}
            />

            <div className="pageTitle">
                {className ? `${className} Analytics Dashboard` : "Analytics Dashboard"}
            </div>

            <p className="analytics-subtitle">
                View each student's progress across every module checkpoint and main program in this class.
                Use the visibility controls to preview which modules students can see.
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
                                                <div className="analytics-student-heading-main">
                                                    Student
                                                </div>

                                                <div className="analytics-global-visibility-summary">
                                                    <FaUsers aria-hidden="true" />
                                                    <span>
                                                        {modulesHiddenForEveryoneCount} hidden for everyone
                                                    </span>
                                                </div>
                                            </th>

                                            {modulesForHeader.map((module) => {
                                                const hiddenForEveryone = isModuleHiddenForEveryone(module.moduleId);

                                                return (
                                                    <th
                                                        className={[
                                                            "analytics-module-heading",
                                                            hiddenForEveryone ? "analytics-module-heading-hidden" : "",
                                                        ]
                                                            .join(" ")
                                                            .trim()}
                                                        colSpan={module.span}
                                                        key={`${module.moduleId}-${module.moduleName}`}
                                                    >
                                                        <div className="analytics-module-heading-inner">
                                                            <span className="analytics-module-heading-name">
                                                                {module.moduleName}
                                                            </span>

                                                            <button
                                                                type="button"
                                                                className={[
                                                                    "analytics-global-module-toggle",
                                                                    hiddenForEveryone ? "analytics-global-module-toggle-hidden" : "",
                                                                ]
                                                                    .join(" ")
                                                                    .trim()}
                                                                onClick={() => setModuleVisibilityForAll(
                                                                    module.moduleId,
                                                                    !hiddenForEveryone,
                                                                    module.moduleName,
                                                                )}
                                                                aria-pressed={!hiddenForEveryone}
                                                                title={
                                                                    hiddenForEveryone
                                                                        ? "Click to show this module for everyone."
                                                                        : "Click to hide this module for everyone."
                                                                }
                                                            >
                                                                {hiddenForEveryone ? (
                                                                    <FaEyeSlash aria-hidden="true" />
                                                                ) : (
                                                                    <FaEye aria-hidden="true" />
                                                                )}
                                                                <span>
                                                                    {hiddenForEveryone ? "Show all" : "Hide all"}
                                                                </span>
                                                            </button>
                                                        </div>
                                                    </th>
                                                );
                                            })}
                                        </tr>

                                        <tr className="analytics-item-row">
                                            {items.map((item) => {
                                                const hiddenForEveryone = isModuleHiddenForEveryone(item.moduleId);

                                                return (
                                                    <th
                                                        className={[
                                                            "analytics-item-heading",
                                                            `analytics-item-heading-${item.kind}`,
                                                            item.isFirstInModule ? "analytics-module-start" : "",
                                                            hoveredItemId === item.id ? "analytics-column-header-highlight" : "",
                                                            hiddenForEveryone ? "analytics-item-heading-module-hidden" : "",
                                                        ]
                                                            .join(" ")
                                                            .trim()}
                                                        key={item.id}
                                                        title={item.label}
                                                        onMouseEnter={() => setHoveredItemId(item.id)}
                                                        onMouseLeave={() => setHoveredItemId(null)}
                                                    >
                                                        <span>{item.shortLabel}</span>

                                                        {hiddenForEveryone ? (
                                                            <span className="analytics-item-hidden-pill">
                                                                Hidden
                                                            </span>
                                                        ) : null}
                                                    </th>
                                                );
                                            })}
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

                                                    {renderStudentVisibilityControls(student)}
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