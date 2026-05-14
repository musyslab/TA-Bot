
import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { eachDayOfInterval } from "date-fns";
import { Helmet } from "react-helmet";
import { Link, useParams } from "react-router-dom";
import {
    FaCheckCircle,
    FaEdit,
    FaExclamationCircle,
    FaEye,
    FaSave,
    FaTasks,
    FaTimes,
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
}

type PracticeProblemRow = {
    id: number;
    number: number;
    name: string;
    enabled: boolean;
    submissions?: number;
    hasSolutionProgram?: boolean;
    hasTestcases?: boolean;
};

type ProjectSetupStatus = {
    hasSolutionProgram: boolean;
    hasTestcases: boolean;
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

export default function AdminModuleDetails() {
    const { class_id, id, module_id } = useParams<{ class_id: string; id?: string; module_id: string }>();
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

    const isModuleActive = (m: ModuleObject): boolean => {
        const startMs = Date.parse(m.Start);
        const endMs = Date.parse(m.End);
        if (Number.isNaN(startMs) || Number.isNaN(endMs)) return false;

        const now = Date.now();
        return now >= startMs && now <= endMs;
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

            return {
                hasSolutionProgram: Array.isArray(solutionRes.data) && solutionRes.data.length > 0,
                hasTestcases: parseTestcasePayloadCount(testcaseRes.data) > 0,
            };
        } catch (err) {
            console.log(err);
            return {
                hasSolutionProgram: false,
                hasTestcases: false,
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
                    },
                    rows.map((pp, index) => ({
                        ...pp,
                        hasSolutionProgram: practiceStatuses[index]?.hasSolutionProgram || false,
                        hasTestcases: practiceStatuses[index]?.hasTestcases || false,
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

    const totalPracticeSubmissions = useMemo(() => {
        return practiceProblems.reduce((sum, pp) => sum + Number(pp.submissions || 0), 0);
    }, [practiceProblems]);

    const enabledPracticeCount = useMemo(() => {
        return practiceProblems.filter((pp) => pp.enabled).length;
    }, [practiceProblems]);

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
            window.alert("Please enter a practice problem name.");
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
            setEditingPracticeNames((current) => ({
                ...current,
                [practiceProblemId]: false,
            }));
        } catch (err) {
            console.log(err);
            window.alert("Could not save the practice problem name.");
        } finally {
            setSavingPracticeNameId(null);
        }
    };

    const renderSetupIndicators = (status: ProjectSetupStatus) => {
        const items = [
            {
                key: "solution",
                label: "Solution Program",
                complete: status.hasSolutionProgram,
                completeText: "Ready",
                missingText: "Missing",
            },
            {
                key: "testcases",
                label: "Test Cases",
                complete: status.hasTestcases,
                completeText: "Ready",
                missingText: "Missing",
            },
        ];

        return (
            <div className="project-setup-indicators" aria-label="Project setup status">
                {items.map((item) => (
                    <div
                        key={item.key}
                        className={`setup-indicator-card${item.complete ? " is-complete" : " is-missing"}`}
                    >
                        <span className="setup-indicator-icon" aria-hidden="true">
                            {item.complete ? <FaCheckCircle /> : <FaExclamationCircle />}
                        </span>
                        <span className="setup-indicator-copy">
                            <span className="setup-indicator-label">{item.label}</span>
                            <span className="setup-indicator-status">
                                {item.complete ? item.completeText : item.missingText}
                            </span>
                        </span>
                    </div>
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

                <div className="project-detail-loading">Loading module...</div>
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
                        { label: "School Selection", to: "/admin/classes" },
                        { label: "Class Selection", to: "/admin/classes" },
                        { label: "Module Calendar", to: `/admin/${classId}/modules` },
                        { label: "Module Details" },
                    ]}
                />

                <div className="project-detail-empty">
                    Module not found.
                </div>
            </div>
        );
    }

    const active = isModuleActive(module);
    const moduleChanged =
        moduleNameDraft.trim() !== module.Name.trim()
        || moduleStartDraft !== formatDateTimeLocal(module.Start)
        || moduleEndDraft !== formatDateTimeLocal(module.End);

    const mainProjectNameChanged = mainProjectNameDraft.trim() !== project.Name.trim();
    const moduleBaseUrl = `/admin/${classId}/module/${module.Id}`;
    const projectBaseUrl = `${moduleBaseUrl}/project/${project.Id}`;

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
                    { label: "School Selection", to: "/admin/classes" },
                    { label: "Class Selection", to: "/admin/classes" },
                    { label: "Module Calendar", to: `/admin/${classId}/modules` },
                    { label: module.Name },
                ]}
            />

            <div className="pageTitle">Module Details</div>

            <div className={`project-detail-hero${editingModule ? " is-editing-module" : ""}`}>
                <div className="project-detail-hero-copy">
                    <div className="project-detail-title-row">
                        <h1 className="project-detail-title">{module.Name}</h1>
                        {active && <span className="badge-active">● Active</span>}
                    </div>

                    <div className="project-detail-dates">
                        {formatDate12h(module.Start)} - {formatDate12h(module.End)}
                    </div>
                </div>

                {!editingModule ? (
                    <div className="project-detail-hero-actions">
                        <button
                            type="button"
                            className="project-action project-action-secondary"
                            onClick={() => setEditingModule(true)}
                        >
                            <FaEdit aria-hidden="true" />
                            Edit Module
                        </button>
                    </div>
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
                <section className="project-work-section main-project-section">
                    <div className="work-section-header">
                        <div>
                            <h2>Main Project</h2>
                            <p>Edit the project name here. File and testcase setup stays in Project Manage.</p>
                        </div>
                    </div>

                    <div className="project-card-row main-project-row">
                        <article className="project-tile-card project-tile-main">
                            <div className="project-tile-top">
                                <div className="project-tile-identity">
                                    <div className="project-type-icon" aria-hidden="true">
                                        <FaTasks />
                                    </div>

                                    <div className="project-title-editor">
                                        <div className="project-card-meta">
                                            <span>Main Project</span>
                                        </div>

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
                                                    Edit
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
                                </div>

                                <div className="project-submission-pill">
                                    <strong>{project.TotalSubmissions}</strong>
                                    <span>
                                        submission{project.TotalSubmissions === 1 ? "" : "s"}
                                    </span>
                                </div>
                            </div>

                            {renderSetupIndicators({
                                hasSolutionProgram: !!project.HasSolutionProgram,
                                hasTestcases: !!project.HasTestcases,
                            })}

                            <div className="project-tile-footer">
                                <Link
                                    className="project-action project-action-primary"
                                    to={`${projectBaseUrl}/submissions`}
                                >
                                    <FaEye aria-hidden="true" />
                                    Review Submissions
                                </Link>

                                <Link
                                    className="project-action project-action-secondary"
                                    to={`${projectBaseUrl}/manage`}
                                >
                                    <FaEdit aria-hidden="true" />
                                    Manage Files and Tests
                                </Link>
                            </div>
                        </article>
                    </div>
                </section>

                <section className="project-work-section practice-project-section">
                    <div className="work-section-header">
                        <div>
                            <h2>Practice Problems</h2>
                            <p>
                                {enabledPracticeCount} enabled, {totalPracticeSubmissions} total practice submission{totalPracticeSubmissions === 1 ? "" : "s"}.
                            </p>
                        </div>

                        <Link
                            className="project-action project-action-secondary manage-practice-link"
                            to={`${projectBaseUrl}/practice/select`}
                        >
                            Manage Practice Problems
                        </Link>
                    </div>

                    {practiceProblems.length === 0 ? (
                        <div className="practice-empty">
                            <div className="practice-empty-title">No practice problems found</div>
                            <p>
                                Add practice problems to give students extra attempts before submitting the main
                                project.
                            </p>
                        </div>
                    ) : (
                        <div className="project-card-row practice-board">
                            {practiceProblems.map((pp) => {
                                const submissionCount = pp.submissions ?? 0;
                                const draftName = practiceNameDrafts[pp.id] ?? pp.name;
                                const nameChanged = draftName.trim() !== pp.name.trim();
                                const isEditingPracticeName = !!editingPracticeNames[pp.id];

                                return (
                                    <article
                                        className={`project-tile-card practice-project-card${!pp.enabled ? " is-disabled" : ""}`}
                                        key={pp.id}
                                    >
                                        <div className="project-tile-top">
                                            <div className="project-tile-identity">
                                                <div className="project-type-icon practice-number-badge">
                                                    {pp.number}
                                                </div>

                                                <div className="project-title-editor">
                                                    <div className="project-card-meta">
                                                        <span>Practice Problem</span>
                                                        {!pp.enabled && (
                                                            <span className="project-status-badge">
                                                                Disabled
                                                            </span>
                                                        )}
                                                    </div>

                                                    {!isEditingPracticeName ? (
                                                        <div className="read-only-name-row">
                                                            <h3 className="project-display-name">{pp.name}</h3>
                                                            <button
                                                                type="button"
                                                                className="project-action project-action-secondary compact-edit-button"
                                                                onClick={() => beginPracticeNameEdit(pp.id, pp.name)}
                                                            >
                                                                <FaEdit aria-hidden="true" />
                                                                Edit
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
                                            </div>

                                            <div className="project-submission-pill">
                                                <strong>{submissionCount}</strong>
                                                <span>
                                                    submission{submissionCount === 1 ? "" : "s"}
                                                </span>
                                            </div>
                                        </div>

                                        {renderSetupIndicators({
                                            hasSolutionProgram: !!pp.hasSolutionProgram,
                                            hasTestcases: !!pp.hasTestcases,
                                        })}

                                        <div className="project-tile-footer">
                                            <Link
                                                className="project-action project-action-primary"
                                                to={`${projectBaseUrl}/practice/${pp.id}/submissions`}
                                            >
                                                <FaEye aria-hidden="true" />
                                                Review
                                            </Link>

                                            <Link
                                                className="project-action project-action-secondary"
                                                to={`${projectBaseUrl}/practice/${pp.id}/manage`}
                                            >
                                                <FaEdit aria-hidden="true" />
                                                Manage Files and Tests
                                            </Link>
                                        </div>
                                    </article>
                                );
                            })}
                        </div>
                    )}
                </section>
            </main>
        </div>
    );
}