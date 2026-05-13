import { CSSProperties, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Helmet } from "react-helmet";
import { Link, useNavigate, useParams } from "react-router-dom";
import { FaChevronLeft, FaChevronRight, FaPlusCircle } from "react-icons/fa";

import MenuComponent from "../components/MenuComponent";
import "../../styling/AdminProjectList.scss";
import DirectoryBreadcrumbs from "../components/DirectoryBreadcrumbs";

interface ProjectObject {
    Id: number;
    Name: string;
    Start: string;
    End: string;
    TotalSubmissions: number;
    PracticeTotalSubmissions?: number;
    PracticeProblemsEnabled?: boolean;
}

type CalendarDay = {
    date: Date;
    isCurrentMonth: boolean;
    key: string;
};

type CalendarWeekSegment = {
    project: ProjectObject;
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

const authHeader = () => ({
    Authorization: `Bearer ${localStorage.getItem("AUTOTA_AUTH_TOKEN")}`,
});

export default function AdminProjectList() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const classId = id || "";

    const [projects, setProjects] = useState<ProjectObject[]>([]);
    const [calendarDate, setCalendarDate] = useState<Date>(new Date());

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

    const isProjectActive = (p: ProjectObject): boolean => {
        const startMs = Date.parse(p.Start);
        const endMs = Date.parse(p.End);
        if (Number.isNaN(startMs) || Number.isNaN(endMs)) return false;

        const now = Date.now();
        return now >= startMs && now <= endMs;
    };

    const projectOccursOnDate = (project: ProjectObject, date: Date): boolean => {
        const start = parseDate(project.Start);
        const end = parseDate(project.End);
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

    const getProjectDateLabel = (project: ProjectObject): string => {
        const start = parseDate(project.Start);
        const end = parseDate(project.End);

        if (!start || !end) {
            return `${project.Start} - ${project.End}`;
        }

        if (sameDay(start, end)) {
            return `${formatTime(project.Start)} - ${formatTime(project.End)}`;
        }

        return `${formatShortDate(project.Start)}, ${formatTime(project.Start)} - ${formatShortDate(project.End)}, ${formatTime(project.End)}`;
    };

    useEffect(() => {
        if (!classId) {
            setProjects([]);
            return;
        }

        let isMounted = true;

        axios
            .get(`${import.meta.env.VITE_API_URL}/projects/get_projects_by_class_id?id=${classId}`, {
                headers: authHeader(),
            })
            .then((res) => {
                const parsed: ProjectObject[] = (res.data as any[]).map(
                    (str: any) => JSON.parse(str) as ProjectObject
                );

                if (!isMounted) return;

                setProjects(parsed);

                const firstProjectDate = parsed
                    .map((p) => parseDate(p.Start))
                    .filter((d): d is Date => !!d)
                    .sort((a, b) => a.getTime() - b.getTime())[0];

                if (firstProjectDate) {
                    setCalendarDate(new Date(firstProjectDate.getFullYear(), firstProjectDate.getMonth(), 1));
                }
            })
            .catch((err) => console.log(err));

        return () => {
            isMounted = false;
        };
    }, [classId]);

    const sortedProjects = useMemo(() => {
        return [...projects].sort((a, b) => {
            const da = Date.parse(a.Start);
            const db = Date.parse(b.Start);
            const aInvalid = Number.isNaN(da);
            const bInvalid = Number.isNaN(db);
            if (aInvalid && bInvalid) return 0;
            if (aInvalid) return 1;
            if (bInvalid) return -1;
            return da - db;
        });
    }, [projects]);

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

            const segments: CalendarWeekSegment[] = sortedProjects
                .filter((project) => {
                    const start = parseDate(project.Start);
                    const end = parseDate(project.End);
                    if (!start || !end) return false;

                    return start <= weekEnd && end >= weekStart;
                })
                .map((project) => {
                    const start = parseDate(project.Start) as Date;
                    const end = parseDate(project.End) as Date;

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
                        project,
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
    }, [calendarDays, sortedProjects]);

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

    const openProject = (projectId: number) => {
        navigate(`/admin/${classId}/project/${projectId}/overview`);
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
                    { label: "Project Calendar" },
                ]}
            />

            <div className="pageTitle">Project Calendar</div>
            <p className="projects-subtitle">
                Select a project from the calendar to review submissions, edit the project, or manage practice problems.
            </p>

            <Link className="button button-create-assignment" to={`/admin/${classId}/project/0/manage/`}>
                <FaPlusCircle aria-hidden="true" />
                <span className="button-text">Create new assignment</span>
            </Link>

            <section className="calendar-shell" aria-label="Project calendar">
                <div className="calendar-toolbar">
                    <button type="button" className="button calendar-nav-button" onClick={goToPreviousMonth}>
                        <FaChevronLeft aria-hidden="true" />
                        Previous
                    </button>

                    <div className="calendar-month-title">{formatMonthTitle(calendarDate)}</div>

                    <div className="calendar-toolbar-right">
                        <button type="button" className="button calendar-today-button" onClick={goToToday}>
                            Today
                        </button>
                        <button type="button" className="button calendar-nav-button" onClick={goToNextMonth}>
                            Next
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
                                                {sortedProjects
                                                    .filter((project) => projectOccursOnDate(project, day.date))
                                                    .map((project) => {
                                                        const active = isProjectActive(project);

                                                        return (
                                                            <button
                                                                type="button"
                                                                className={`calendar-project${active ? " is-active" : ""}`}
                                                                key={`${day.key}-${project.Id}`}
                                                                onClick={() => openProject(project.Id)}
                                                                title={project.Name}
                                                            >
                                                                <span className="calendar-project-name">{project.Name}</span>
                                                                <span className="calendar-project-meta">
                                                                    {getProjectDateLabel(project)}
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
                                    <div className="calendar-week-events" aria-label="Assignments for this week">
                                        {week.segments.map((segment) => {
                                            const active = isProjectActive(segment.project);

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
                                                    key={`${week.key}-${segment.project.Id}-${segment.startColumn}-${segment.row}`}
                                                    onClick={() => openProject(segment.project.Id)}
                                                    title={segment.project.Name}
                                                    style={{
                                                        gridColumn: `${segment.startColumn + 1} / span ${segment.span}`,
                                                        gridRow: `${segment.row + 1}`,
                                                    }}
                                                >
                                                    <span className="calendar-project-name">{segment.project.Name}</span>
                                                    <span className="calendar-project-meta">
                                                        {getProjectDateLabel(segment.project)}
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

            {sortedProjects.length === 0 && (
                <div className="empty-projects">
                    No projects found for this class.
                </div>
            )}
        </div>
    );
}