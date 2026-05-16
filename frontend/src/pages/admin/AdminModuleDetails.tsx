
import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import axios from "axios";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { eachDayOfInterval } from "date-fns";
import { Helmet } from "react-helmet";
import { Link, useParams } from "react-router-dom";
import {
    FaCheck,
    FaCheckCircle,
    FaEdit,
    FaExclamationCircle,
    FaExclamationTriangle,
    FaEye,
    FaFlagCheckered,
    FaArrowDown,
    FaArrowUp,
    FaPlus,
    FaPlay,
    FaSave,
    FaTasks,
    FaTimes,
    FaTrash,
    FaWrench,
} from "react-icons/fa";

import MenuComponent from "../components/MenuComponent";
import DirectoryBreadcrumbs from "../components/DirectoryBreadcrumbs";
import "../../styling/AdminModuleDetails.scss";

interface ModuleObject {
    Id: number;
    ClassId: number;
    Name: string;
    Start: string;
    End: string;
    MainProjectId?: number;
}

interface ProjectObject {
    Id: number;
    Name: string;
    Start: string;
    End: string;
    TotalSubmissions: number;
    PracticeTotalSubmissions?: number;
    PracticeProblemsEnabled?: boolean;
    HasSolutionProgram?: boolean;
    HasTestcases?: boolean;
    TestcaseCount?: number;
}

type PracticeProblemRow = {
    id: number;
    number: number;
    name: string;
    enabled: boolean;
    submissions?: number;
    hasSolutionProgram?: boolean;
    hasTestcases?: boolean;
    testcaseCount?: number;
};

type ProjectSetupStatus = {
    hasSolutionProgram: boolean;
    hasTestcases: boolean;
    testcaseCount: number;
};

type ModuleOverviewResponse = {
    module: ModuleObject;
    project: ProjectObject;
    practiceProblems: PracticeProblemRow[];
};

type DateRange = {
    start: Date;
    end: Date;
};

type DateTimeFieldProps = {
    label: string;
    value: string;
    onChange: (value: string) => void;
    highlightedDates: Date[];
    blockedDates: Date[];
    timeClassName: (time: Date) => string | null;
    selectsStart?: boolean;
    selectsEnd?: boolean;
    startDate: Date | null;
    endDate: Date | null;
    hasError: boolean;
};

type PathSegment = {
    key: string;
    d: string;
    state: "complete" | "missing" | "incomplete";
};

type PathSvgState = {
    width: number;
    height: number;
    segments: PathSegment[];
};

const authHeader = () => ({
    Authorization: `Bearer ${localStorage.getItem("AUTOTA_AUTH_TOKEN")}`,
});

const pad = (n: number) => n.toString().padStart(2, "0");

const formatDateTimeLocal = (value: string | Date): string => {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return "";

    return [
        d.getFullYear(),
        "-",
        pad(d.getMonth() + 1),
        "-",
        pad(d.getDate()),
        "T",
        pad(d.getHours()),
        ":",
        pad(d.getMinutes()),
    ].join("");
};

const parseDateTimeLocal = (value: string): Date | null => {
    if (!value) return null;

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
};

const getInjectedTimes = (dateValue: Date | null): Date[] => {
    if (!dateValue) return [];

    const endOfDay = new Date(dateValue.getTime());
    endOfDay.setHours(23, 59, 0, 0);

    return [endOfDay];
};

const getDateRangeHighlightDates = (start: Date | null, end: Date | null): Date[] => {
    if (!start || !end || start.getTime() > end.getTime()) return [];

    return eachDayOfInterval({ start, end });
};

const getFullyBlockedDates = (ranges: DateRange[]): Date[] => {
    const dates: Date[] = [];

    ranges.forEach((range) => {
        const currentDay = new Date(range.start);
        currentDay.setHours(0, 0, 0, 0);

        const lastDay = new Date(range.end);
        lastDay.setHours(0, 0, 0, 0);

        while (currentDay <= lastDay) {
            const dayStart = new Date(currentDay);
            dayStart.setHours(0, 0, 0, 0);

            const dayEnd = new Date(currentDay);
            dayEnd.setHours(23, 59, 0, 0);

            if (range.start <= dayStart && range.end >= dayEnd) {
                dates.push(new Date(currentDay));
            }

            currentDay.setDate(currentDay.getDate() + 1);
        }
    });

    return dates;
};

const dateOverlapsRange = (date: Date, ranges: DateRange[]): boolean => (
    ranges.some((range) => date > range.start && date < range.end)
);

const dateRangeOverlapsRanges = (start: Date | null, end: Date | null, ranges: DateRange[]): boolean => {
    if (!start || !end) return false;

    return ranges.some((range) => start < range.end && end > range.start);
};

const moveDateToFirstAvailableTime = (date: Date | null, ranges: DateRange[]): Date | null => {
    if (!date || !dateOverlapsRange(date, ranges)) return date;

    const candidate = new Date(date);
    candidate.setHours(0, 0, 0, 0);

    while (candidate.toDateString() === date.toDateString()) {
        if (!dateOverlapsRange(candidate, ranges)) {
            return candidate;
        }

        candidate.setMinutes(candidate.getMinutes() + 15);
    }

    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 0, 0);

    return dateOverlapsRange(endOfDay, ranges) ? date : endOfDay;
};

function DateTimeField({
    label,
    value,
    onChange,
    highlightedDates,
    blockedDates,
    timeClassName,
    selectsStart,
    selectsEnd,
    startDate,
    endDate,
    hasError,
}: DateTimeFieldProps) {
    const selectedDate = parseDateTimeLocal(value);

    return (
        <div className={`form-field input-field datetime-field${hasError ? " input-error" : ""}`}>
            <label>{label}</label>

            <DatePicker
                selected={selectedDate}
                onChange={(date: Date | null) => onChange(date ? formatDateTimeLocal(date) : "")}
                showTimeSelect
                timeFormat="h:mm aa"
                timeIntervals={15}
                injectTimes={getInjectedTimes(selectedDate || new Date())}
                timeCaption="Time"
                dateFormat="yyyy-MM-dd h:mm aa"
                highlightDates={[
                    {
                        "react-datepicker__day--highlighted": highlightedDates,
                    },
                    {
                        "react-datepicker__day--highlighted-red": blockedDates,
                    },
                ]}
                timeClassName={timeClassName}
                selectsStart={selectsStart}
                selectsEnd={selectsEnd}
                startDate={startDate}
                endDate={endDate}
                placeholderText={`Select ${label.toLowerCase()}`}
            />
        </div>
    );
}


const getSetupMissingItems = (status: ProjectSetupStatus): string[] => {
    const missingItems: string[] = [];

    if (!status.hasSolutionProgram) {
        missingItems.push("solution");
    }

    if (status.testcaseCount <= 1) {
        missingItems.push("test cases");
    }

    return missingItems;
};

const getSetupState = (status: ProjectSetupStatus): "complete" | "missing" => (
    getSetupMissingItems(status).length === 0 ? "complete" : "missing"
);

const formatMissingSetupText = (missingItems: string[]): string => {
    if (missingItems.length === 0) return "";

    return `Missing ${missingItems.join(" + ")}`;
};

export default function AdminModuleDetails() {
    const { school_id, class_id, id, module_id } = useParams<{
        school_id: string;
        class_id: string;
        id?: string;
        module_id: string;
    }>();

    const schoolId = school_id || "";
    const classId = class_id || "";
    const routeProjectId = Number(id || 0);
    const routeModuleId = Number(module_id || 0);

    const [module, setModule] = useState<ModuleObject | null>(null);
    const [project, setProject] = useState<ProjectObject | null>(null);
    const [practiceProblems, setPracticeProblems] = useState<PracticeProblemRow[]>([]);
    const [loading, setLoading] = useState(true);

    const [moduleNameDraft, setModuleNameDraft] = useState("");
    const [moduleStartDraft, setModuleStartDraft] = useState("");
    const [moduleEndDraft, setModuleEndDraft] = useState("");
    const [mainProjectNameDraft, setMainProjectNameDraft] = useState("");
    const [practiceNameDrafts, setPracticeNameDrafts] = useState<Record<number, string>>({});

    const [editingModule, setEditingModule] = useState(false);
    const [editingMainProjectName, setEditingMainProjectName] = useState(false);
    const [editingPracticeNames, setEditingPracticeNames] = useState<Record<number, boolean>>({});

    const [savingModule, setSavingModule] = useState(false);
    const [savingProjectName, setSavingProjectName] = useState(false);
    const [savingPracticeNameId, setSavingPracticeNameId] = useState<number | null>(null);
    const [moduleConflicts, setModuleConflicts] = useState<ModuleObject[]>([]);
    const [overlapError, setOverlapError] = useState(false);
    const [pathSvgState, setPathSvgState] = useState<PathSvgState>({
        width: 0,
        height: 0,
        segments: [],
    });
    const [checkpointManagerOpen, setCheckpointManagerOpen] = useState(false);
    const [checkpointDrafts, setCheckpointDrafts] = useState<PracticeProblemRow[]>([]);
    const [savingCheckpointOrder, setSavingCheckpointOrder] = useState(false);
    const [addingCheckpoint, setAddingCheckpoint] = useState(false);
    const [deletingCheckpointId, setDeletingCheckpointId] = useState<number | null>(null);

    const checkpointPathTrackRef = useRef<HTMLDivElement | null>(null);

    const formatDate12h = (value: string): string => {
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return value;

        return new Intl.DateTimeFormat("en-US", {
            year: "numeric",
            month: "short",
            day: "2-digit",
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
        }).format(d);
    };

    const getModuleStatus = (m: ModuleObject): "active" | "upcoming" | "ended" => {
        const startMs = Date.parse(m.Start);
        const endMs = Date.parse(m.End);
        if (Number.isNaN(startMs) || Number.isNaN(endMs)) return "upcoming";

        const now = Date.now();
        if (now >= startMs && now <= endMs) return "active";
        return now < startMs ? "upcoming" : "ended";
    };

    const parseTestcasePayloadCount = (payload: unknown): number => {
        if (!payload || typeof payload !== "object") return 0;

        return Object.keys(payload as Record<string, unknown>).length;
    };

    const fetchProjectSetupStatus = async (projectId: number, practiceProblemId?: number): Promise<ProjectSetupStatus> => {
        const practice = !!practiceProblemId;
        const practiceProblemQuery = practice ? `&practice_problem_id=${practiceProblemId}` : "";

        try {
            const [solutionRes, testcaseRes] = await Promise.all([
                axios.get(
                    `${import.meta.env.VITE_API_URL}/projects/list_solution_files?id=${projectId}&practice=${practice ? "true" : "false"}${practiceProblemQuery}`,
                    { headers: authHeader() }
                ),
                axios.get(
                    `${import.meta.env.VITE_API_URL}/projects/get_testcases?id=${projectId}&practice=${practice ? "true" : "false"}${practiceProblemQuery}`,
                    { headers: authHeader() }
                ),
            ]);

            const testcaseCount = parseTestcasePayloadCount(testcaseRes.data);

            return {
                hasSolutionProgram: Array.isArray(solutionRes.data) && solutionRes.data.length > 0,
                hasTestcases: testcaseCount > 0,
                testcaseCount,
            };
        } catch (err) {
            console.log(err);
            return {
                hasSolutionProgram: false,
                hasTestcases: false,
                testcaseCount: 0,
            };
        }
    };

    const hydrateState = (nextModule: ModuleObject | null, nextProject: ProjectObject | null, nextPractice: PracticeProblemRow[]) => {
        setModule(nextModule);
        setProject(nextProject);
        setPracticeProblems(nextPractice);
        setModuleNameDraft(nextModule?.Name || "");
        setModuleStartDraft(nextModule ? formatDateTimeLocal(nextModule.Start) : "");
        setModuleEndDraft(nextModule ? formatDateTimeLocal(nextModule.End) : "");
        setMainProjectNameDraft(nextProject?.Name || "");
        setPracticeNameDrafts(
            nextPractice.reduce<Record<number, string>>((acc, pp) => {
                acc[pp.id] = pp.name;
                return acc;
            }, {})
        );
        setEditingModule(false);
        setEditingMainProjectName(false);
        setEditingPracticeNames({});
        setOverlapError(false);
    };

    const loadOverview = () => {
        if (!classId || (!routeModuleId && !routeProjectId)) {
            hydrateState(null, null, []);
            setLoading(false);
            return;
        }

        setLoading(true);

        const url = routeModuleId
            ? `${import.meta.env.VITE_API_URL}/projects/get_module_overview?module_id=${routeModuleId}`
            : `${import.meta.env.VITE_API_URL}/projects/get_module_overview?project_id=${routeProjectId}`;

        axios
            .get(url, { headers: authHeader() })
            .then(async (res) => {
                const data = res.data as ModuleOverviewResponse;
                const rows = Array.isArray(data.practiceProblems) ? data.practiceProblems : [];
                const nextProject = data.project || null;

                if (!nextProject) {
                    hydrateState(data.module || null, null, rows);
                    setLoading(false);
                    return;
                }

                const [mainStatus, practiceStatuses] = await Promise.all([
                    fetchProjectSetupStatus(nextProject.Id),
                    Promise.all(rows.map((pp) => fetchProjectSetupStatus(nextProject.Id, pp.id))),
                ]);

                hydrateState(
                    data.module || null,
                    {
                        ...nextProject,
                        HasSolutionProgram: mainStatus.hasSolutionProgram,
                        HasTestcases: mainStatus.hasTestcases,
                        TestcaseCount: mainStatus.testcaseCount,
                    },
                    rows.map((pp, index) => ({
                        ...pp,
                        hasSolutionProgram: practiceStatuses[index]?.hasSolutionProgram || false,
                        hasTestcases: practiceStatuses[index]?.hasTestcases || false,
                        testcaseCount: practiceStatuses[index]?.testcaseCount || 0,
                    }))
                );
                setLoading(false);
            })
            .catch((err) => {
                console.log(err);
                hydrateState(null, null, []);
                setLoading(false);
            });
    };

    const loadModuleConflicts = () => {
        if (!classId) {
            setModuleConflicts([]);
            return;
        }

        axios
            .get(`${import.meta.env.VITE_API_URL}/projects/get_modules_by_class_id?id=${classId}`, {
                headers: authHeader(),
            })
            .then((res) => {
                const parsed: ModuleObject[] = (res.data as any[]).map(
                    (item: any) => typeof item === "string" ? JSON.parse(item) as ModuleObject : item as ModuleObject
                );

                setModuleConflicts(parsed);
            })
            .catch((err) => {
                console.log(err);
                setModuleConflicts([]);
            });
    };

    useEffect(() => {
        loadOverview();
        loadModuleConflicts();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [classId, routeProjectId, routeModuleId]);

    const sortedCheckpoints = useMemo(() => {
        return [...practiceProblems].sort((a, b) => {
            if (a.number !== b.number) return a.number - b.number;
            return a.id - b.id;
        });
    }, [practiceProblems]);

    const checkpointOrderChanged = checkpointDrafts.length !== sortedCheckpoints.length
        || checkpointDrafts.some((pp, index) => pp.id !== sortedCheckpoints[index]?.id);

    const checkpointModalBusy = savingCheckpointOrder || addingCheckpoint || deletingCheckpointId !== null;

    useEffect(() => {
        if (checkpointManagerOpen && !checkpointOrderChanged) {
            setCheckpointDrafts(sortedCheckpoints);
        }
    }, [checkpointManagerOpen, checkpointOrderChanged, sortedCheckpoints]);

    useEffect(() => {
        if (!checkpointManagerOpen) return;

        const previousBodyOverflow = document.body.style.overflow;
        const previousHtmlOverflow = document.documentElement.style.overflow;
        document.body.style.overflow = "hidden";
        document.documentElement.style.overflow = "hidden";
        document.body.classList.add("checkpoint-manager-scroll-lock");
        document.documentElement.classList.add("checkpoint-manager-scroll-lock");

        return () => {
            document.body.style.overflow = previousBodyOverflow;
            document.documentElement.style.overflow = previousHtmlOverflow;
            document.body.classList.remove("checkpoint-manager-scroll-lock");
            document.documentElement.classList.remove("checkpoint-manager-scroll-lock");
        };
    }, [checkpointManagerOpen]);

    const moduleConflictRanges = useMemo<DateRange[]>(() => {
        return moduleConflicts
            .filter((m) => !module || m.Id !== module.Id)
            .map((m) => {
                const start = parseDateTimeLocal(m.Start);
                const end = parseDateTimeLocal(m.End);

                return start && end ? { start, end } : null;
            })
            .filter((range): range is DateRange => !!range);
    }, [moduleConflicts, module]);

    const moduleStartDate = useMemo(() => parseDateTimeLocal(moduleStartDraft), [moduleStartDraft]);
    const moduleEndDate = useMemo(() => parseDateTimeLocal(moduleEndDraft), [moduleEndDraft]);

    const highlightedModuleDates = useMemo(() => (
        getDateRangeHighlightDates(moduleStartDate, moduleEndDate)
    ), [moduleStartDate, moduleEndDate]);

    const blockedModuleDates = useMemo(() => (
        getFullyBlockedDates(moduleConflictRanges)
    ), [moduleConflictRanges]);

    const handleModuleTimeColors = (time: Date): string | null => (
        dateOverlapsRange(time, moduleConflictRanges) ? "react-datepicker__time--highlighted-red" : null
    );

    const setModuleDate = (dateValue: string, isStart: boolean) => {
        let finalDate = parseDateTimeLocal(dateValue);
        const previousDate = parseDateTimeLocal(isStart ? moduleStartDraft : moduleEndDraft);
        const isNewDay = !previousDate || (finalDate && finalDate.toDateString() !== previousDate.toDateString());

        if (finalDate && isNewDay) {
            finalDate = moveDateToFirstAvailableTime(finalDate, moduleConflictRanges);
        }

        if (isStart) {
            setModuleStartDraft(finalDate ? formatDateTimeLocal(finalDate) : "");
        } else {
            setModuleEndDraft(finalDate ? formatDateTimeLocal(finalDate) : "");
        }

        const startToCheck = isStart ? finalDate : moduleStartDate;
        const endToCheck = isStart ? moduleEndDate : finalDate;
        setOverlapError(
            !!finalDate
            && (
                dateOverlapsRange(finalDate, moduleConflictRanges)
                || dateRangeOverlapsRanges(startToCheck, endToCheck, moduleConflictRanges)
            )
        );
    };

    const mainProjectReady = useMemo(() => {
        return !!project?.HasSolutionProgram && Number(project?.TestcaseCount || 0) > 1;
    }, [project]);

    const pathNodeStates = useMemo<("complete" | "missing" | "incomplete")[]>(() => {
        return [
            ...sortedCheckpoints.map((pp) => {
                const status = {
                    hasSolutionProgram: !!pp.hasSolutionProgram,
                    hasTestcases: !!pp.hasTestcases,
                    testcaseCount: Number(pp.testcaseCount || 0),
                };

                if (getSetupState(status) === "missing") return "missing";
                return pp.enabled ? "complete" : "incomplete";
            }),
            getSetupState({
                hasSolutionProgram: !!project?.HasSolutionProgram,
                hasTestcases: !!project?.HasTestcases,
                testcaseCount: Number(project?.TestcaseCount || 0),
            }) === "missing" ? "missing" : "complete",
        ];
    }, [sortedCheckpoints, project]);

    const recalculatePathConnectors = useCallback(() => {
        const trackElement = checkpointPathTrackRef.current;

        if (!trackElement) {
            setPathSvgState({ width: 0, height: 0, segments: [] });
            return;
        }

        const nodeElements = Array.from(
            trackElement.querySelectorAll<HTMLElement>("[data-admin-path-node='true']")
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
            const sameRow = Math.abs(current.centerY - next.centerY) < Math.min(current.height, next.height) * 0.45;
            let d = "";

            if (sameRow) {
                d = `M ${current.right} ${current.centerY} L ${next.left} ${next.centerY}`;
            } else {
                const routeY = current.bottom + Math.max(12, (next.top - current.bottom) / 2);

                d = [
                    `M ${current.centerX} ${current.bottom}`,
                    `L ${current.centerX} ${routeY}`,
                    `L ${next.centerX} ${routeY}`,
                    `L ${next.centerX} ${next.top}`,
                ].join(" ");
            }

            segments.push({
                key: `admin-checkpoint-connector-${i}`,
                d,
                state: pathNodeStates[i] || "incomplete",
            });
        }

        setPathSvgState({
            width: trackRect.width,
            height: trackRect.height,
            segments,
        });
    }, [pathNodeStates]);

    useLayoutEffect(() => {
        recalculatePathConnectors();

        const trackElement = checkpointPathTrackRef.current;
        if (!trackElement) return;

        const resizeObserver = new ResizeObserver(() => {
            recalculatePathConnectors();
        });

        resizeObserver.observe(trackElement);

        Array.from(
            trackElement.querySelectorAll<HTMLElement>("[data-admin-path-node='true']")
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
        editingMainProjectName,
        editingPracticeNames,
        loading,
        module?.Id,
    ]);

    const saveModule = async () => {
        if (!module) return;

        if (!moduleNameDraft.trim() || !moduleStartDraft || !moduleEndDraft) {
            window.alert("Please enter a module name, start date, and end date.");
            return;
        }

        const start = new Date(moduleStartDraft);
        const end = new Date(moduleEndDraft);

        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
            window.alert("Please enter valid module dates.");
            return;
        }

        if (start.getTime() >= end.getTime()) {
            window.alert("The module end date must be after the start date.");
            return;
        }

        if (dateRangeOverlapsRanges(start, end, moduleConflictRanges)) {
            window.alert("The selected dates overlap with an existing module. Please adjust your dates.");
            setOverlapError(true);
            return;
        }

        try {
            setSavingModule(true);
            await axios.post(
                `${import.meta.env.VITE_API_URL}/projects/update_module`,
                {
                    module_id: module.Id,
                    name: moduleNameDraft.trim(),
                    start_date: moduleStartDraft,
                    end_date: moduleEndDraft,
                },
                { headers: authHeader() }
            );
            setOverlapError(false);
            await Promise.resolve(loadOverview());
            loadModuleConflicts();
        } catch (err) {
            console.log(err);
            window.alert("Could not save the module.");
        } finally {
            setSavingModule(false);
        }
    };

    const resetModuleDraft = () => {
        if (!module) return;
        setModuleNameDraft(module.Name);
        setModuleStartDraft(formatDateTimeLocal(module.Start));
        setModuleEndDraft(formatDateTimeLocal(module.End));
        setOverlapError(false);
        setEditingModule(false);
    };

    const saveMainProjectName = async () => {
        if (!project) return;

        const trimmed = mainProjectNameDraft.trim();
        if (!trimmed) {
            window.alert("Please enter a project name.");
            return;
        }

        try {
            setSavingProjectName(true);
            await axios.post(
                `${import.meta.env.VITE_API_URL}/projects/update_project_name`,
                {
                    project_id: project.Id,
                    name: trimmed,
                },
                { headers: authHeader() }
            );
            setProject((current) => current ? { ...current, Name: trimmed } : current);
            setEditingMainProjectName(false);
        } catch (err) {
            console.log(err);
            window.alert("Could not save the project name.");
        } finally {
            setSavingProjectName(false);
        }
    };

    const cancelMainProjectEdit = () => {
        if (!project) return;
        setMainProjectNameDraft(project.Name);
        setEditingMainProjectName(false);
    };

    const beginPracticeNameEdit = (practiceProblemId: number, currentName: string) => {
        setPracticeNameDrafts((current) => ({
            ...current,
            [practiceProblemId]: current[practiceProblemId] ?? currentName,
        }));
        setEditingPracticeNames((current) => ({
            ...current,
            [practiceProblemId]: true,
        }));
    };

    const cancelPracticeNameEdit = (practiceProblemId: number, currentName: string) => {
        setPracticeNameDrafts((current) => ({
            ...current,
            [practiceProblemId]: currentName,
        }));
        setEditingPracticeNames((current) => ({
            ...current,
            [practiceProblemId]: false,
        }));
    };

    const savePracticeProblemName = async (practiceProblemId: number) => {
        const trimmed = (practiceNameDrafts[practiceProblemId] || "").trim();
        if (!trimmed) {
            window.alert("Please enter a checkpoint name.");
            return;
        }

        try {
            setSavingPracticeNameId(practiceProblemId);
            await axios.post(
                `${import.meta.env.VITE_API_URL}/projects/update_practice_problem_name`,
                {
                    practice_problem_id: practiceProblemId,
                    name: trimmed,
                },
                { headers: authHeader() }
            );

            setPracticeProblems((current) => (
                current.map((pp) => pp.id === practiceProblemId ? { ...pp, name: trimmed } : pp)
            ));
            setCheckpointDrafts((current) => (
                current.map((pp) => pp.id === practiceProblemId ? { ...pp, name: trimmed } : pp)
            ));
            setEditingPracticeNames((current) => ({
                ...current,
                [practiceProblemId]: false,
            }));
        } catch (err) {
            console.log(err);
            window.alert("Could not save the checkpoint name.");
        } finally {
            setSavingPracticeNameId(null);
        }
    };

    const openCheckpointManager = () => {
        setCheckpointDrafts(sortedCheckpoints);
        setCheckpointManagerOpen(true);
    };

    const closeCheckpointManager = () => {
        if (checkpointModalBusy) return;

        if (checkpointOrderChanged && !window.confirm("You have unsaved checkpoint order changes. Close without saving?")) {
            return;
        }

        setCheckpointDrafts(sortedCheckpoints);
        setCheckpointManagerOpen(false);
    };

    const moveCheckpointDraft = (index: number, direction: -1 | 1) => {
        const nextIndex = index + direction;
        if (nextIndex < 0 || nextIndex >= checkpointDrafts.length) return;

        setCheckpointDrafts((current) => {
            const next = [...current];
            [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
            return next;
        });
    };

    const saveCheckpointOrder = async () => {
        if (!project || !checkpointOrderChanged) return;

        try {
            setSavingCheckpointOrder(true);
            const orderedIds = checkpointDrafts.map((pp) => pp.id);

            await axios.post(
                `${import.meta.env.VITE_API_URL}/projects/reorder_practice_problems`,
                {
                    project_id: project.Id,
                    ordered_ids: orderedIds,
                },
                { headers: authHeader() }
            );

            setPracticeProblems((current) => (
                orderedIds
                    .map((idValue, index) => {
                        const existing = current.find((pp) => pp.id === idValue);
                        return existing ? { ...existing, number: index + 1 } : null;
                    })
                    .filter((pp): pp is PracticeProblemRow => !!pp)
            ));
            loadOverview();
        } catch (err) {
            console.log(err);
            window.alert("Could not save the checkpoint order.");
        } finally {
            setSavingCheckpointOrder(false);
        }
    };

    const addCheckpoint = async () => {
        if (!project) return;

        const nextNumber = sortedCheckpoints.length + 1;
        const generatedName = `Checkpoint ${nextNumber}`;

        try {
            setAddingCheckpoint(true);
            await axios.post(
                `${import.meta.env.VITE_API_URL}/projects/create_practice_problem`,
                {
                    project_id: project.Id,
                    name: generatedName,
                },
                { headers: authHeader() }
            );
            loadOverview();
        } catch (err) {
            console.log(err);
            window.alert("Could not add a checkpoint.");
        } finally {
            setAddingCheckpoint(false);
        }
    };

    const deleteCheckpoint = async (practiceProblemId: number, checkpointName: string) => {
        if (!window.confirm(`Delete "${checkpointName}"? Students will no longer see this checkpoint.`)) {
            return;
        }

        try {
            setDeletingCheckpointId(practiceProblemId);
            await axios.post(
                `${import.meta.env.VITE_API_URL}/projects/delete_practice_problem`,
                {
                    practice_problem_id: practiceProblemId,
                },
                { headers: authHeader() }
            );

            setPracticeProblems((current) => (
                current
                    .filter((pp) => pp.id !== practiceProblemId)
                    .map((pp, index) => ({ ...pp, number: index + 1 }))
            ));
            setCheckpointDrafts((current) => (
                current
                    .filter((pp) => pp.id !== practiceProblemId)
                    .map((pp, index) => ({ ...pp, number: index + 1 }))
            ));
            loadOverview();
        } catch (err) {
            console.log(err);
            window.alert("Could not delete the checkpoint.");
        } finally {
            setDeletingCheckpointId(null);
        }
    };

    const formatTestcaseCount = (count: number): string => (
        `${count} testcase${count === 1 ? "" : "s"}`
    );

    const renderSetupIndicators = (status: ProjectSetupStatus, manageUrl: string) => {
        const testcasesReady = status.testcaseCount > 1;

        const items = [
            {
                key: "solution",
                label: "Solution Program",
                complete: status.hasSolutionProgram,
                completeText: "Ready",
                missingText: "Missing",
                countBadgeText: undefined,
                to: `${manageUrl}?step=files`,
                icon: status.hasSolutionProgram ? <FaCheckCircle /> : <FaExclamationCircle />,
                actionText: "Open Menu",
            },
            {
                key: "testcases",
                label: "Test Cases",
                complete: testcasesReady,
                completeText: "Ready",
                missingText: "Missing",
                countBadgeText: formatTestcaseCount(status.testcaseCount),
                to: `${manageUrl}?step=testcases`,
                icon: testcasesReady ? <FaCheckCircle /> : <FaExclamationCircle />,
                actionText: "Open Menu",
            },
        ];

        return (
            <div className="project-setup-indicators" aria-label="Project setup status">
                {items.map((item) => (
                    <Link
                        key={item.key}
                        className={`setup-indicator-card setup-indicator-link is-${item.key}${item.complete ? " is-complete" : " is-missing"}`}
                        to={item.to}
                    >
                        <span className="setup-indicator-icon" aria-hidden="true">
                            {item.icon}
                        </span>
                        <span className="setup-indicator-copy">
                            <span className="setup-indicator-label-row">
                                <span className="setup-indicator-label">{item.label}</span>
                                {item.countBadgeText && (
                                    <span className="setup-indicator-count-badge">
                                        {item.countBadgeText}
                                    </span>
                                )}
                            </span>
                            <span className="setup-indicator-status">
                                {item.complete ? item.completeText : item.missingText}
                            </span>
                        </span>
                        <span className="setup-indicator-action" aria-hidden="true">
                            {item.actionText}
                        </span>
                    </Link>
                ))}
            </div>
        );
    };

    if (loading) {
        return (
            <div className="project-detail-page">
                <Helmet>
                    <title>[Admin] MAAT</title>
                </Helmet>

                <MenuComponent
                    showUpload={false}
                    showAdminUpload={true}
                    showHelp={false}
                    showCreate={false}
                    showLast={false}
                    showReviewButton={false}
                />

                <div className="project-detail-loading">Loading module path...</div>
            </div>
        );
    }

    if (!module || !project) {
        return (
            <div className="project-detail-page">
                <Helmet>
                    <title>[Admin] MAAT</title>
                </Helmet>

                <MenuComponent
                    showUpload={false}
                    showAdminUpload={true}
                    showHelp={false}
                    showCreate={false}
                    showLast={false}
                    showReviewButton={false}
                />

                <DirectoryBreadcrumbs
                    items={[
                        { label: "School Selection", to: "/admin/schools" },
                        { label: "Class Selection", to: `/admin/school/${schoolId}/classes` },
                        { label: "Module List", to: `/admin/school/${schoolId}/class/${classId}/modules` },
                        { label: "Module Details" },
                    ]}
                />

                <div className="project-detail-empty">
                    Module not found.
                </div>
            </div>
        );
    }

    const moduleStatus = getModuleStatus(module);
    const moduleChanged =
        moduleNameDraft.trim() !== module.Name.trim()
        || moduleStartDraft !== formatDateTimeLocal(module.Start)
        || moduleEndDraft !== formatDateTimeLocal(module.End);

    const mainProjectNameChanged = mainProjectNameDraft.trim() !== project.Name.trim();
    const moduleBaseUrl = `/admin/school/${schoolId}/class/${classId}/module/${module.Id}`;
    const projectBaseUrl = `${moduleBaseUrl}/project/${project.Id}`;
    const mainProjectSetupStatus = {
        hasSolutionProgram: !!project.HasSolutionProgram,
        hasTestcases: !!project.HasTestcases,
        testcaseCount: Number(project.TestcaseCount || 0),
    };
    const mainProjectMissingSetupItems = getSetupMissingItems(mainProjectSetupStatus);
    const mainProjectHasMissingSetup = mainProjectMissingSetupItems.length > 0;

    return (
        <div className="project-detail-page">
            <Helmet>
                <title>[Admin] MAAT</title>
            </Helmet>

            <MenuComponent
                showUpload={false}
                showAdminUpload={true}
                showHelp={false}
                showCreate={false}
                showLast={false}
                showReviewButton={false}
            />

            <DirectoryBreadcrumbs
                items={[
                    { label: "School Selection", to: "/admin/schools" },
                    { label: "Class Selection", to: `/admin/school/${schoolId}/classes` },
                    { label: "Module List", to: `/admin/school/${schoolId}/class/${classId}/modules` },
                    { label: "Module Details" },
                ]}
            />

            <div className="pageTitle">Admin Module Details</div>

            <div className={`project-detail-hero is-${moduleStatus}${editingModule ? " is-editing-module" : ""}`}>
                <div className="project-detail-hero-copy">
                    <div className="project-detail-title-row">
                        <h1 className="project-detail-title">{module.Name}</h1>
                        <span className={`badge-module-status is-${moduleStatus}`}>
                            ● {moduleStatus}
                        </span>
                    </div>

                    <div className="project-detail-dates">
                        {formatDate12h(module.Start)} to {formatDate12h(module.End)}
                    </div>
                </div>

                {!editingModule ? (
                    <button
                        type="button"
                        className="project-action project-action-secondary module-edit-button"
                        onClick={() => setEditingModule(true)}
                    >
                        <FaEdit aria-hidden="true" />
                        Edit Module
                    </button>
                ) : (
                    <div className="hero-module-settings" aria-label="Module Settings">
                        <div className="hero-module-settings-header">
                            <div>
                                <span className="hero-settings-eyebrow">Module Settings</span>
                                <h2>Edit module</h2>
                            </div>
                        </div>

                        <div className="module-settings-grid">
                            <div className="form-field input-field module-name-field">
                                <label>Module Name</label>
                                <input
                                    type="text"
                                    value={moduleNameDraft}
                                    onChange={(e) => setModuleNameDraft(e.currentTarget.value)}
                                />
                            </div>

                            <DateTimeField
                                label="Start Date"
                                value={moduleStartDraft}
                                onChange={(value) => setModuleDate(value, true)}
                                highlightedDates={highlightedModuleDates}
                                blockedDates={blockedModuleDates}
                                timeClassName={handleModuleTimeColors}
                                selectsStart
                                startDate={moduleStartDate}
                                endDate={moduleEndDate}
                                hasError={overlapError}
                            />

                            <DateTimeField
                                label="End Date"
                                value={moduleEndDraft}
                                onChange={(value) => setModuleDate(value, false)}
                                highlightedDates={highlightedModuleDates}
                                blockedDates={blockedModuleDates}
                                timeClassName={handleModuleTimeColors}
                                selectsEnd
                                startDate={moduleStartDate}
                                endDate={moduleEndDate}
                                hasError={overlapError}
                            />
                        </div>

                        <div className="project-detail-edit-actions hero-edit-actions">
                            <button
                                type="button"
                                className="project-action project-action-primary"
                                onClick={saveModule}
                                disabled={savingModule || !moduleChanged}
                            >
                                <FaSave aria-hidden="true" />
                                {savingModule ? "Saving..." : "Save Module"}
                            </button>

                            <button
                                type="button"
                                className="project-action project-action-secondary"
                                onClick={resetModuleDraft}
                                disabled={savingModule}
                            >
                                <FaTimes aria-hidden="true" />
                                Cancel
                            </button>
                        </div>
                    </div>
                )}
            </div>

            <main className="project-workspace">
                <section className="checkpoint-path-section" aria-label="Checkpoint path editor">
                    <div className="checkpoint-path-header">
                        <div>
                            <h2>Checkpoint Path</h2>
                            <p>Students see these as checkpoints that lead into the main project. Use this page to edit names, setup files, test cases, and review submissions.</p>
                        </div>

                        <button
                            type="button"
                            className="project-action project-action-secondary manage-practice-link"
                            onClick={openCheckpointManager}
                        >
                            <FaWrench aria-hidden="true" />
                            Manage Checkpoints
                        </button>
                    </div>

                    <div className="checkpoint-path-track" ref={checkpointPathTrackRef}>
                        <svg
                            className="checkpoint-path-connector-layer"
                            width={pathSvgState.width}
                            height={pathSvgState.height}
                            viewBox={`0 0 ${pathSvgState.width} ${pathSvgState.height}`}
                            aria-hidden="true"
                            focusable="false"
                        >
                            {pathSvgState.segments.map((segment) => (
                                <path
                                    className={[
                                        "checkpoint-path-connector-line",
                                        segment.state === "complete" ? "is-complete" : "",
                                        segment.state === "missing" ? "is-missing" : "",
                                    ].join(" ").trim()}
                                    d={segment.d}
                                    key={segment.key}
                                />
                            ))}
                        </svg>

                        {sortedCheckpoints.length === 0 ? (
                            <div className="checkpoint-path-empty">
                                No checkpoints are available yet. The main project remains the final path item.
                            </div>
                        ) : null}

                        {sortedCheckpoints.map((pp) => {
                            const submissionCount = pp.submissions ?? 0;
                            const draftName = practiceNameDrafts[pp.id] ?? pp.name;
                            const nameChanged = draftName.trim() !== pp.name.trim();
                            const isEditingPracticeName = !!editingPracticeNames[pp.id];
                            const checkpointSetupStatus = {
                                hasSolutionProgram: !!pp.hasSolutionProgram,
                                hasTestcases: !!pp.hasTestcases,
                                testcaseCount: Number(pp.testcaseCount || 0),
                            };
                            const missingSetupItems = getSetupMissingItems(checkpointSetupStatus);
                            const hasMissingSetup = missingSetupItems.length > 0;
                            const checkpointReady = pp.enabled && !hasMissingSetup;

                            return (
                                <article
                                    className={[
                                        "checkpoint-path-node",
                                        "checkpoint-card",
                                        hasMissingSetup ? "is-missing-setup" : checkpointReady ? "is-complete" : "is-active",
                                        !pp.enabled ? "is-disabled" : "",
                                    ].join(" ").trim()}
                                    key={pp.id}
                                    data-admin-path-node="true"
                                >
                                    <div className="checkpoint-node-topline">
                                        <div className="checkpoint-node-icon practice-number-badge" aria-hidden="true">
                                            {hasMissingSetup ? <FaExclamationTriangle /> : checkpointReady ? <FaCheck /> : <FaPlay />}
                                        </div>

                                        <div className="checkpoint-node-status-stack">
                                            <span className="checkpoint-node-label">Checkpoint {pp.number}</span>
                                            {hasMissingSetup ? (
                                                <span className="project-status-badge setup-warning-badge">
                                                    <FaExclamationTriangle aria-hidden="true" />
                                                    {formatMissingSetupText(missingSetupItems)}
                                                </span>
                                            ) : null}
                                            {!pp.enabled ? (
                                                <span className="project-status-badge">Disabled</span>
                                            ) : null}
                                        </div>
                                    </div>

                                    <div className="project-title-editor checkpoint-title-editor">
                                        {!isEditingPracticeName ? (
                                            <div className="read-only-name-row">
                                                <h3 className="project-display-name">{pp.name}</h3>
                                                <button
                                                    type="button"
                                                    className="project-action project-action-secondary compact-edit-button"
                                                    onClick={() => beginPracticeNameEdit(pp.id, pp.name)}
                                                >
                                                    <FaEdit aria-hidden="true" />
                                                    Edit Name
                                                </button>
                                            </div>
                                        ) : (
                                            <>
                                                <input
                                                    className="project-inline-name-input practice-name-input"
                                                    type="text"
                                                    value={draftName}
                                                    onChange={(e) => {
                                                        const next = e.currentTarget.value;
                                                        setPracticeNameDrafts((current) => ({
                                                            ...current,
                                                            [pp.id]: next,
                                                        }));
                                                    }}
                                                />

                                                <div className="name-edit-actions">
                                                    <button
                                                        type="button"
                                                        className="project-action project-action-primary inline-save-button"
                                                        onClick={() => savePracticeProblemName(pp.id)}
                                                        disabled={savingPracticeNameId === pp.id || !nameChanged}
                                                    >
                                                        <FaSave aria-hidden="true" />
                                                        {savingPracticeNameId === pp.id ? "Saving..." : "Save Name"}
                                                    </button>

                                                    <button
                                                        type="button"
                                                        className="project-action project-action-secondary inline-save-button"
                                                        onClick={() => cancelPracticeNameEdit(pp.id, pp.name)}
                                                        disabled={savingPracticeNameId === pp.id}
                                                    >
                                                        <FaTimes aria-hidden="true" />
                                                        Cancel
                                                    </button>
                                                </div>
                                            </>
                                        )}
                                    </div>

                                    <div className="checkpoint-node-actions">
                                        <div className="project-submission-pill">
                                            <strong>{submissionCount}</strong>
                                            <span>
                                                submission{submissionCount === 1 ? "" : "s"}
                                            </span>
                                        </div>

                                        <Link
                                            className="review-submissions-action"
                                            to={`${projectBaseUrl}/practice/${pp.id}/submissions`}
                                        >
                                            <FaEye aria-hidden="true" />
                                            Review Submissions
                                        </Link>
                                    </div>

                                    {renderSetupIndicators(checkpointSetupStatus, `${projectBaseUrl}/practice/${pp.id}/manage`)}
                                </article>
                            );
                        })}

                        <article
                            className={[
                                "checkpoint-path-node",
                                "checkpoint-main-node",
                                mainProjectHasMissingSetup ? "is-missing-setup" : mainProjectReady ? "is-complete" : "is-active",
                            ].join(" ").trim()}
                            data-admin-path-node="true"
                        >
                            <div className="checkpoint-node-topline">
                                <div className="checkpoint-node-icon main-project-icon" aria-hidden="true">
                                    {mainProjectHasMissingSetup ? <FaExclamationTriangle /> : mainProjectReady ? <FaCheck /> : <FaTasks />}
                                </div>

                                <div className="checkpoint-node-status-stack">
                                    <span className="checkpoint-node-label">Main Project</span>
                                    <span className="checkpoint-node-final-badge">
                                        <FaFlagCheckered aria-hidden="true" />
                                        Final submission
                                    </span>
                                    {mainProjectHasMissingSetup ? (
                                        <span className="project-status-badge setup-warning-badge">
                                            <FaExclamationTriangle aria-hidden="true" />
                                            {formatMissingSetupText(mainProjectMissingSetupItems)}
                                        </span>
                                    ) : null}
                                </div>
                            </div>

                            <div className="project-title-editor checkpoint-title-editor">
                                {!editingMainProjectName ? (
                                    <div className="read-only-name-row">
                                        <h3 className="project-display-name">{project.Name}</h3>
                                        <button
                                            type="button"
                                            className="project-action project-action-secondary compact-edit-button"
                                            onClick={() => {
                                                setMainProjectNameDraft(project.Name);
                                                setEditingMainProjectName(true);
                                            }}
                                        >
                                            <FaEdit aria-hidden="true" />
                                            Edit Name
                                        </button>
                                    </div>
                                ) : (
                                    <>
                                        <input
                                            className="project-inline-name-input"
                                            type="text"
                                            value={mainProjectNameDraft}
                                            onChange={(e) => setMainProjectNameDraft(e.currentTarget.value)}
                                        />

                                        <div className="name-edit-actions">
                                            <button
                                                type="button"
                                                className="project-action project-action-primary inline-save-button"
                                                onClick={saveMainProjectName}
                                                disabled={savingProjectName || !mainProjectNameChanged}
                                            >
                                                <FaSave aria-hidden="true" />
                                                {savingProjectName ? "Saving..." : "Save Name"}
                                            </button>

                                            <button
                                                type="button"
                                                className="project-action project-action-secondary inline-save-button"
                                                onClick={cancelMainProjectEdit}
                                                disabled={savingProjectName}
                                            >
                                                <FaTimes aria-hidden="true" />
                                                Cancel
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>

                            <div className="checkpoint-node-actions">
                                <div className="project-submission-pill">
                                    <strong>{project.TotalSubmissions}</strong>
                                    <span>
                                        submission{project.TotalSubmissions === 1 ? "" : "s"}
                                    </span>
                                </div>

                                <Link
                                    className="review-submissions-action"
                                    to={`${projectBaseUrl}/submissions`}
                                >
                                    <FaEye aria-hidden="true" />
                                    Review Submissions
                                </Link>
                            </div>

                            {renderSetupIndicators(mainProjectSetupStatus, `${projectBaseUrl}/manage`)}
                        </article>
                    </div>
                </section>
            </main>

            {checkpointManagerOpen ? (
                <div
                    className="checkpoint-manager-modal-backdrop"
                    role="presentation"
                    onMouseDown={(event) => {
                        if (event.target === event.currentTarget) {
                            closeCheckpointManager();
                        }
                    }}
                >
                    <section
                        className="checkpoint-manager-modal"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="checkpoint-manager-title"
                    >
                        <div className="checkpoint-manager-header">
                            <div>
                                <span className="hero-settings-eyebrow">Checkpoint Manager</span>
                                <h2 id="checkpoint-manager-title">Arrange checkpoints</h2>
                                <p>
                                    Add checkpoints, remove old ones, and set the order students will follow before the main project.
                                </p>
                                {checkpointOrderChanged ? (
                                    <div className="checkpoint-manager-unsaved-alert" role="status">
                                        <FaExclamationTriangle aria-hidden="true" />
                                        Unsaved order changes. Click Save Order before closing.
                                    </div>
                                ) : null}
                            </div>

                            <button
                                type="button"
                                className="checkpoint-manager-close"
                                onClick={closeCheckpointManager}
                                aria-label="Close checkpoint manager"
                                disabled={checkpointModalBusy}
                            >
                                <FaTimes aria-hidden="true" />
                            </button>
                        </div>

                        <div className="checkpoint-manager-body">
                            {checkpointDrafts.length === 0 ? (
                                <div className="checkpoint-manager-empty">
                                    No checkpoints have been added yet. Add one to create the first step before the main project.
                                </div>
                            ) : (
                                <div className="checkpoint-manager-list">
                                    {checkpointDrafts.map((pp, index) => (
                                        <article className="checkpoint-manager-row" key={pp.id}>
                                            <div className="checkpoint-manager-number">
                                                {index + 1}
                                            </div>

                                            <div className="checkpoint-manager-row-copy">
                                                <strong>{pp.name}</strong>
                                                <span>
                                                    {pp.submissions ?? 0} submission{(pp.submissions ?? 0) === 1 ? "" : "s"}
                                                </span>
                                            </div>

                                            <div className="checkpoint-manager-row-actions">
                                                <button
                                                    type="button"
                                                    className="project-action project-action-secondary checkpoint-manager-icon-button"
                                                    onClick={() => moveCheckpointDraft(index, -1)}
                                                    disabled={index === 0 || checkpointModalBusy}
                                                    aria-label={`Move ${pp.name} up`}
                                                >
                                                    <FaArrowUp aria-hidden="true" />
                                                </button>

                                                <button
                                                    type="button"
                                                    className="project-action project-action-secondary checkpoint-manager-icon-button"
                                                    onClick={() => moveCheckpointDraft(index, 1)}
                                                    disabled={index === checkpointDrafts.length - 1 || checkpointModalBusy}
                                                    aria-label={`Move ${pp.name} down`}
                                                >
                                                    <FaArrowDown aria-hidden="true" />
                                                </button>

                                                <button
                                                    type="button"
                                                    className="project-action project-action-danger checkpoint-manager-icon-button"
                                                    onClick={() => deleteCheckpoint(pp.id, pp.name)}
                                                    disabled={checkpointModalBusy}
                                                    aria-label={`Delete ${pp.name}`}
                                                >
                                                    <FaTrash aria-hidden="true" />
                                                    {deletingCheckpointId === pp.id ? "Deleting..." : "Delete"}
                                                </button>
                                            </div>
                                        </article>
                                    ))}
                                </div>
                            )}

                            <article className="checkpoint-manager-row checkpoint-manager-main-row">
                                <div className="checkpoint-manager-number checkpoint-manager-main-number">
                                    <FaFlagCheckered aria-hidden="true" />
                                </div>

                                <div className="checkpoint-manager-row-copy">
                                    <strong>{project.Name}</strong>
                                    <span>Main program, always final · {project.TotalSubmissions} submission{project.TotalSubmissions === 1 ? "" : "s"}</span>
                                </div>

                                <div className="checkpoint-manager-row-actions checkpoint-manager-main-actions">
                                    <span className="checkpoint-manager-fixed-pill">Fixed final step</span>
                                    <Link
                                        className="project-action project-action-secondary checkpoint-manager-main-link"
                                        to={`${projectBaseUrl}/manage`}
                                        onClick={() => setCheckpointManagerOpen(false)}
                                    >
                                        <FaWrench aria-hidden="true" />
                                        Manage Main Program
                                    </Link>
                                </div>
                            </article>
                        </div>

                        <div className="checkpoint-manager-footer">
                            <div className="checkpoint-manager-footer-start">
                                <button
                                    type="button"
                                    className="project-action project-action-secondary"
                                    onClick={addCheckpoint}
                                    disabled={checkpointModalBusy}
                                >
                                    <FaPlus aria-hidden="true" />
                                    {addingCheckpoint ? "Adding..." : "Add Checkpoint"}
                                </button>
                                {checkpointOrderChanged ? (
                                    <span className="checkpoint-manager-unsaved-pill">Unsaved changes</span>
                                ) : null}
                            </div>

                            <div className="checkpoint-manager-footer-actions">
                                <button
                                    type="button"
                                    className="project-action project-action-secondary"
                                    onClick={closeCheckpointManager}
                                    disabled={checkpointModalBusy}
                                >
                                    Cancel
                                </button>

                                <button
                                    type="button"
                                    className="project-action project-action-primary"
                                    onClick={saveCheckpointOrder}
                                    disabled={!checkpointOrderChanged || checkpointModalBusy}
                                >
                                    <FaSave aria-hidden="true" />
                                    {savingCheckpointOrder ? "Saving..." : "Save Order"}
                                </button>
                            </div>
                        </div>
                    </section>
                </div>
            ) : null}
        </div>
    );
}