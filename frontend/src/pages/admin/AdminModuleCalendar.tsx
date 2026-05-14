import { CSSProperties, useEffect, useMemo, useState } from "react";
import axios from "axios";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { eachDayOfInterval } from "date-fns";
import { Helmet } from "react-helmet";
import { useNavigate, useParams } from "react-router-dom";
import { FaChevronLeft, FaChevronRight, FaPlusCircle, FaSave, FaTimes } from "react-icons/fa";

import MenuComponent from "../components/MenuComponent";
import "../../styling/AdminModuleCalendar.scss";
import DirectoryBreadcrumbs from "../components/DirectoryBreadcrumbs";

interface ModuleObject {
    Id: number;
    ClassId: number;
    Name: string;
    Start: string;
    End: string;
    MainProjectId?: number;
    TotalSubmissions?: number;
    PracticeTotalSubmissions?: number;
    PracticeProblemsEnabled?: boolean;
}

type CalendarDay = {
    date: Date;
    isCurrentMonth: boolean;
    key: string;
};

type CalendarWeekSegment = {
    module: ModuleObject;
    startColumn: number;
    span: number;
    row: number;
    startsBeforeWeek: boolean;
    endsAfterWeek: boolean;
};

type CalendarWeek = {
    key: string;
    days: CalendarDay[];
    segments: CalendarWeekSegment[];
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

const formatDateTimeLocal = (date: Date): string => {
    return [
        date.getFullYear(),
        "-",
        pad(date.getMonth() + 1),
        "-",
        pad(date.getDate()),
        "T",
        pad(date.getHours()),
        ":",
        pad(date.getMinutes()),
    ].join("");
};

const parseDateTimeLocal = (value: string): Date | null => {
    if (!value) return null;

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
};

const defaultModuleStart = () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
};

const defaultModuleEnd = () => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    d.setHours(23, 59, 0, 0);
    return d;
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

export default function AdminModuleCalendar() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const classId = id || "";

    const [modules, setModules] = useState<ModuleObject[]>([]);
    const [calendarDate, setCalendarDate] = useState<Date>(new Date());
    const [showCreateModule, setShowCreateModule] = useState(false);
    const [newModuleName, setNewModuleName] = useState("");
    const [newModuleStart, setNewModuleStart] = useState(formatDateTimeLocal(defaultModuleStart()));
    const [newModuleEnd, setNewModuleEnd] = useState(formatDateTimeLocal(defaultModuleEnd()));
    const [savingModule, setSavingModule] = useState(false);
    const [overlapError, setOverlapError] = useState(false);

    const parseDate = (value: string): Date | null => {
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? null : d;
    };

    const sameDay = (a: Date, b: Date): boolean => (
        a.getFullYear() === b.getFullYear()
        && a.getMonth() === b.getMonth()
        && a.getDate() === b.getDate()
    );

    const startOfDay = (d: Date): Date => {
        const next = new Date(d);
        next.setHours(0, 0, 0, 0);
        return next;
    };

    const endOfDay = (d: Date): Date => {
        const next = new Date(d);
        next.setHours(23, 59, 59, 999);
        return next;
    };

    const formatMonthTitle = (date: Date): string => (
        new Intl.DateTimeFormat("en-US", {
            month: "long",
            year: "numeric",
        }).format(date)
    );

    const formatTime = (value: string): string => {
        const d = parseDate(value);
        if (!d) return value;

        return new Intl.DateTimeFormat("en-US", {
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
        }).format(d);
    };

    const formatShortDate = (value: string): string => {
        const d = parseDate(value);
        if (!d) return value;

        return new Intl.DateTimeFormat("en-US", {
            month: "short",
            day: "numeric",
        }).format(d);
    };

    const isModuleActiveNow = (m: ModuleObject): boolean => {
        const startMs = Date.parse(m.Start);
        const endMs = Date.parse(m.End);
        if (Number.isNaN(startMs) || Number.isNaN(endMs)) return false;

        const now = Date.now();
        return now >= startMs && now <= endMs;
    };

    const moduleOccursOnDate = (module: ModuleObject, date: Date): boolean => {
        const start = parseDate(module.Start);
        const end = parseDate(module.End);
        if (!start || !end) return false;

        return start <= endOfDay(date) && end >= startOfDay(date);
    };

    const clamp = (value: number, min: number, max: number): number => (
        Math.min(Math.max(value, min), max)
    );

    const getDayIndexWithinWeek = (date: Date, weekStart: Date): number => {
        const dayMs = 24 * 60 * 60 * 1000;
        return Math.floor((startOfDay(date).getTime() - startOfDay(weekStart).getTime()) / dayMs);
    };

    const getModuleDateLabel = (module: ModuleObject): string => {
        const start = parseDate(module.Start);
        const end = parseDate(module.End);

        if (!start || !end) {
            return `${module.Start} - ${module.End}`;
        }

        if (sameDay(start, end)) {
            return `${formatTime(module.Start)} - ${formatTime(module.End)}`;
        }

        return `${formatShortDate(module.Start)}, ${formatTime(module.Start)} - ${formatShortDate(module.End)}, ${formatTime(module.End)}`;
    };

    const loadModules = () => {
        if (!classId) {
            setModules([]);
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

                setModules(parsed);

                const firstModuleDate = parsed
                    .map((m) => parseDate(m.Start))
                    .filter((d): d is Date => !!d)
                    .sort((a, b) => a.getTime() - b.getTime())[0];

                if (firstModuleDate) {
                    setCalendarDate(new Date(firstModuleDate.getFullYear(), firstModuleDate.getMonth(), 1));
                }
            })
            .catch((err) => {
                console.log(err);
                setModules([]);
            });
    };

    useEffect(() => {
        loadModules();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [classId]);

    const sortedModules = useMemo(() => {
        return [...modules].sort((a, b) => {
            const da = Date.parse(a.Start);
            const db = Date.parse(b.Start);
            const aInvalid = Number.isNaN(da);
            const bInvalid = Number.isNaN(db);
            if (aInvalid && bInvalid) return 0;
            if (aInvalid) return 1;
            if (bInvalid) return -1;
            return da - db;
        });
    }, [modules]);

    const moduleConflictRanges = useMemo<DateRange[]>(() => {
        return modules
            .map((m) => {
                const start = parseDate(m.Start);
                const end = parseDate(m.End);

                return start && end ? { start, end } : null;
            })
            .filter((range): range is DateRange => !!range);
    }, [modules]);

    const newModuleStartDate = useMemo(() => parseDateTimeLocal(newModuleStart), [newModuleStart]);
    const newModuleEndDate = useMemo(() => parseDateTimeLocal(newModuleEnd), [newModuleEnd]);

    const highlightedNewModuleDates = useMemo(() => (
        getDateRangeHighlightDates(newModuleStartDate, newModuleEndDate)
    ), [newModuleStartDate, newModuleEndDate]);

    const blockedNewModuleDates = useMemo(() => (
        getFullyBlockedDates(moduleConflictRanges)
    ), [moduleConflictRanges]);

    const handleNewModuleTimeColors = (time: Date): string | null => (
        dateOverlapsRange(time, moduleConflictRanges) ? "react-datepicker__time--highlighted-red" : null
    );

    const setNewModuleDate = (dateValue: string, isStart: boolean) => {
        let finalDate = parseDateTimeLocal(dateValue);
        const previousDate = parseDateTimeLocal(isStart ? newModuleStart : newModuleEnd);
        const isNewDay = !previousDate || (finalDate && finalDate.toDateString() !== previousDate.toDateString());

        if (finalDate && isNewDay) {
            finalDate = moveDateToFirstAvailableTime(finalDate, moduleConflictRanges);
        }

        if (isStart) {
            setNewModuleStart(finalDate ? formatDateTimeLocal(finalDate) : "");
        } else {
            setNewModuleEnd(finalDate ? formatDateTimeLocal(finalDate) : "");
        }

        const startToCheck = isStart ? finalDate : newModuleStartDate;
        const endToCheck = isStart ? newModuleEndDate : finalDate;
        setOverlapError(
            !!finalDate
            && (
                dateOverlapsRange(finalDate, moduleConflictRanges)
                || dateRangeOverlapsRanges(startToCheck, endToCheck, moduleConflictRanges)
            )
        );
    };

    const calendarDays = useMemo<CalendarDay[]>(() => {
        const year = calendarDate.getFullYear();
        const month = calendarDate.getMonth();

        const firstOfMonth = new Date(year, month, 1);
        const start = new Date(firstOfMonth);
        start.setDate(firstOfMonth.getDate() - firstOfMonth.getDay());

        const days: CalendarDay[] = [];
        for (let i = 0; i < 42; i += 1) {
            const date = new Date(start);
            date.setDate(start.getDate() + i);

            days.push({
                date,
                isCurrentMonth: date.getMonth() === month,
                key: `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`,
            });
        }

        return days;
    }, [calendarDate]);

    const calendarWeeks = useMemo<CalendarWeek[]>(() => {
        const weeks: CalendarWeek[] = [];

        for (let i = 0; i < calendarDays.length; i += 7) {
            const days = calendarDays.slice(i, i + 7);
            const weekStart = startOfDay(days[0].date);
            const weekEnd = endOfDay(days[6].date);

            const rowEndByRow: number[] = [];

            const segments: CalendarWeekSegment[] = sortedModules
                .filter((module) => {
                    const start = parseDate(module.Start);
                    const end = parseDate(module.End);
                    if (!start || !end) return false;

                    return start <= weekEnd && end >= weekStart;
                })
                .map((module) => {
                    const start = parseDate(module.Start) as Date;
                    const end = parseDate(module.End) as Date;

                    const startsBeforeWeek = start < weekStart;
                    const endsAfterWeek = end > weekEnd;

                    const startColumn = clamp(getDayIndexWithinWeek(start, weekStart), 0, 6);
                    const endColumn = clamp(getDayIndexWithinWeek(end, weekStart), 0, 6);
                    const span = Math.max(1, endColumn - startColumn + 1);

                    let row = rowEndByRow.findIndex((rowEnd) => startColumn > rowEnd);

                    if (row === -1) {
                        row = rowEndByRow.length;
                        rowEndByRow.push(endColumn);
                    } else {
                        rowEndByRow[row] = endColumn;
                    }

                    return {
                        module,
                        startColumn,
                        span,
                        row,
                        startsBeforeWeek,
                        endsAfterWeek,
                    };
                });

            weeks.push({
                key: days[0].key,
                days,
                segments,
            });
        }

        return weeks;
    }, [calendarDays, sortedModules]);

    const goToPreviousMonth = () => {
        setCalendarDate((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1));
    };

    const goToNextMonth = () => {
        setCalendarDate((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1));
    };

    const goToToday = () => {
        const today = new Date();
        setCalendarDate(new Date(today.getFullYear(), today.getMonth(), 1));
    };

    const openModule = (moduleId: number) => {
        navigate(`/admin/${classId}/module/${moduleId}/overview`);
    };

    const createModule = async () => {
        const trimmedName = newModuleName.trim();
        if (!trimmedName || !newModuleStart || !newModuleEnd) {
            window.alert("Please enter a module name, start date, and end date.");
            return;
        }

        const start = new Date(newModuleStart);
        const end = new Date(newModuleEnd);

        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
            window.alert("Please enter valid dates.");
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
            const res = await axios.post(
                `${import.meta.env.VITE_API_URL}/projects/create_module`,
                {
                    class_id: Number(classId),
                    name: trimmedName,
                    start_date: newModuleStart,
                    end_date: newModuleEnd,
                },
                { headers: authHeader() }
            );

            const moduleId = Number(res.data?.module_id ?? res.data?.id ?? res.data);
            setShowCreateModule(false);
            setNewModuleName("");
            setNewModuleStart(formatDateTimeLocal(defaultModuleStart()));
            setNewModuleEnd(formatDateTimeLocal(defaultModuleEnd()));
            setOverlapError(false);
            loadModules();

            if (moduleId > 0) {
                navigate(`/admin/${classId}/module/${moduleId}/overview`);
            }
        } catch (err) {
            console.log(err);
            window.alert("Could not create the module.");
        } finally {
            setSavingModule(false);
        }
    };

    return (
        <div className="projects-page">
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
                    { label: "Module Calendar" },
                ]}
            />

            <div className="pageTitle">Module Calendar</div>

            <div className="module-calendar-command-row">
                <button
                    className="button button-create-assignment"
                    type="button"
                    onClick={() => setShowCreateModule((current) => !current)}
                >
                    <FaPlusCircle aria-hidden="true" />
                    <span className="button-text">{showCreateModule ? "Close create module" : "Create new module"}</span>
                </button>
            </div>

            {showCreateModule && (
                <section className="calendar-create-card" aria-label="Create module">
                    <div className="calendar-create-card-header">
                        <div>
                            <span className="calendar-create-eyebrow">New Module</span>
                            <h2>Create module details</h2>
                            <p>
                                Choose the name, start date, and end date for this module.
                            </p>
                        </div>
                    </div>

                    <div className="calendar-create-grid">
                        <div className="form-field input-field module-name-field">
                            <label>Module Name</label>
                            <input
                                type="text"
                                value={newModuleName}
                                onChange={(e) => setNewModuleName(e.currentTarget.value)}
                                placeholder="Module 1"
                            />
                        </div>

                        <DateTimeField
                            label="Start Date"
                            value={newModuleStart}
                            onChange={(value) => setNewModuleDate(value, true)}
                            highlightedDates={highlightedNewModuleDates}
                            blockedDates={blockedNewModuleDates}
                            timeClassName={handleNewModuleTimeColors}
                            selectsStart
                            startDate={newModuleStartDate}
                            endDate={newModuleEndDate}
                            hasError={overlapError}
                        />

                        <DateTimeField
                            label="End Date"
                            value={newModuleEnd}
                            onChange={(value) => setNewModuleDate(value, false)}
                            highlightedDates={highlightedNewModuleDates}
                            blockedDates={blockedNewModuleDates}
                            timeClassName={handleNewModuleTimeColors}
                            selectsEnd
                            startDate={newModuleStartDate}
                            endDate={newModuleEndDate}
                            hasError={overlapError}
                        />
                    </div>

                    <div className="project-detail-edit-actions">
                        <button
                            className="project-action project-action-primary"
                            type="button"
                            onClick={createModule}
                            disabled={savingModule}
                        >
                            <FaSave aria-hidden="true" />
                            {savingModule ? "Creating..." : "Create Module"}
                        </button>

                        <button
                            className="project-action project-action-secondary"
                            type="button"
                            onClick={() => setShowCreateModule(false)}
                            disabled={savingModule}
                        >
                            <FaTimes aria-hidden="true" />
                            Cancel
                        </button>
                    </div>
                </section>
            )}

            <p className="projects-subtitle">
                Select a module from the calendar to see more details.
            </p>

            <section className="calendar-shell" aria-label="Project calendar">
                <div className="calendar-toolbar">
                    <button type="button" className="button calendar-nav-button" onClick={goToPreviousMonth}>
                        <FaChevronLeft aria-hidden="true" />
                        <span>Previous</span>
                    </button>

                    <div className="calendar-month-title">{formatMonthTitle(calendarDate)}</div>

                    <div className="calendar-toolbar-right">
                        <button type="button" className="button calendar-today-button" onClick={goToToday}>
                            Today
                        </button>
                        <button type="button" className="button calendar-nav-button" onClick={goToNextMonth}>
                            <span>Next</span>
                            <FaChevronRight aria-hidden="true" />
                        </button>
                    </div>
                </div>

                <div className="calendar-weekdays">
                    {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                        <div className="calendar-weekday" key={day}>
                            {day}
                        </div>
                    ))}
                </div>

                <div className="calendar-grid">
                    {calendarWeeks.map((week) => {
                        const maxEventRow = week.segments.reduce(
                            (max, segment) => Math.max(max, segment.row + 1),
                            0
                        );

                        const weekStyle = {
                            "--event-rows": maxEventRow,
                        } as CSSProperties;

                        return (
                            <div className="calendar-week" key={week.key} style={weekStyle}>
                                {week.days.map((day) => {
                                    const today = sameDay(day.date, new Date());

                                    return (
                                        <div
                                            className={[
                                                "calendar-day",
                                                day.isCurrentMonth ? "" : "is-outside-month",
                                                today ? "is-today" : "",
                                            ].join(" ").trim()}
                                            key={day.key}
                                        >
                                            <div className="calendar-day-number">{day.date.getDate()}</div>

                                            <div className="calendar-mobile-projects">
                                                {sortedModules
                                                    .filter((module) => moduleOccursOnDate(module, day.date))
                                                    .map((module) => {
                                                        const active = isModuleActiveNow(module);

                                                        return (
                                                            <button
                                                                type="button"
                                                                className={`calendar-project${active ? " is-active" : ""}`}
                                                                key={`${day.key}-${module.Id}`}
                                                                onClick={() => openModule(module.Id)}
                                                                title={module.Name}
                                                            >
                                                                <span className="calendar-project-name">{module.Name}</span>
                                                                <span className="calendar-project-meta">
                                                                    {getModuleDateLabel(module)}
                                                                    {active ? " • Active" : ""}
                                                                </span>
                                                            </button>
                                                        );
                                                    })}
                                            </div>
                                        </div>
                                    );
                                })}

                                {week.segments.length > 0 && (
                                    <div className="calendar-week-events" aria-label="Modules for this week">
                                        {week.segments.map((segment) => {
                                            const active = isModuleActiveNow(segment.module);

                                            return (
                                                <button
                                                    type="button"
                                                    className={[
                                                        "calendar-project",
                                                        "calendar-project-span",
                                                        active ? "is-active" : "",
                                                        segment.startsBeforeWeek ? "continues-from-left" : "",
                                                        segment.endsAfterWeek ? "continues-to-right" : "",
                                                    ].join(" ").trim()}
                                                    key={`${week.key}-${segment.module.Id}-${segment.startColumn}-${segment.row}`}
                                                    onClick={() => openModule(segment.module.Id)}
                                                    title={segment.module.Name}
                                                    style={{
                                                        gridColumn: `${segment.startColumn + 1} / span ${segment.span}`,
                                                        gridRow: `${segment.row + 1}`,
                                                    }}
                                                >
                                                    <span className="calendar-project-name">{segment.module.Name}</span>
                                                    <span className="calendar-project-meta">
                                                        {getModuleDateLabel(segment.module)}
                                                        {active ? " • Active" : ""}
                                                    </span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </section>

            {sortedModules.length === 0 && (
                <div className="empty-projects">
                    No modules found for this class.
                </div>
            )}
        </div>
    );
}