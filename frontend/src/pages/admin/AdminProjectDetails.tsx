import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Helmet } from "react-helmet";
import { Link, useParams } from "react-router-dom";
import { FaEdit, FaEye, FaTasks } from "react-icons/fa";

import MenuComponent from "../components/MenuComponent";
import DirectoryBreadcrumbs from "../components/DirectoryBreadcrumbs";
import "../../styling/AdminProjectDetails.scss";

interface ProjectObject {
    Id: number;
    Name: string;
    Start: string;
    End: string;
    TotalSubmissions: number;
    PracticeTotalSubmissions?: number;
    PracticeProblemsEnabled?: boolean;
}

type PracticeProblemRow = {
    id: number;
    number: number;
    name: string;
    enabled: boolean;
    submissions?: number;
};

const authHeader = () => ({
    Authorization: `Bearer ${localStorage.getItem("AUTOTA_AUTH_TOKEN")}`,
});

export default function AdminProjectDetails() {
    const { class_id, id } = useParams<{ class_id: string; id: string }>();
    const classId = class_id || "";
    const projectId = Number(id || 0);

    const [project, setProject] = useState<ProjectObject | null>(null);
    const [practiceProblems, setPracticeProblems] = useState<PracticeProblemRow[]>([]);
    const [loading, setLoading] = useState(true);

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

    const isProjectActive = (p: ProjectObject): boolean => {
        const startMs = Date.parse(p.Start);
        const endMs = Date.parse(p.End);
        if (Number.isNaN(startMs) || Number.isNaN(endMs)) return false;

        const now = Date.now();
        return now >= startMs && now <= endMs;
    };

    useEffect(() => {
        if (!classId || !projectId) {
            setProject(null);
            setPracticeProblems([]);
            setLoading(false);
            return;
        }

        let isMounted = true;
        setLoading(true);

        axios
            .get(`${import.meta.env.VITE_API_URL}/projects/get_projects_by_class_id?id=${classId}`, {
                headers: authHeader(),
            })
            .then(async (res) => {
                const parsed: ProjectObject[] = (res.data as any[]).map(
                    (str: any) => JSON.parse(str) as ProjectObject
                );
                const selected = parsed.find((p) => Number(p.Id) === projectId) || null;

                let rows: PracticeProblemRow[] = [];

                try {
                    const practiceRes = await axios.get(
                        `${import.meta.env.VITE_API_URL}/projects/list_practice_problems?project_id=${projectId}`,
                        { headers: authHeader() }
                    );

                    const problems = Array.isArray(practiceRes.data?.problems) ? practiceRes.data.problems : [];

                    rows = problems.map((pp: any, idx: number) => ({
                        id: Number(pp?.id),
                        number: Number(pp?.number ?? idx + 1),
                        name: String(pp?.name ?? `Practice Problem ${idx + 1}`),
                        enabled: !!pp?.enabled,
                        submissions: 0,
                    }));

                    try {
                        const countsRes = await axios.get(
                            `${import.meta.env.VITE_API_URL}/projects/practice_submission_counts?project_id=${projectId}`,
                            { headers: authHeader() }
                        );

                        const by = countsRes.data?.by_problem || {};
                        rows.forEach((row) => {
                            row.submissions = Number(by[String(row.id)] ?? 0);
                        });
                    } catch {
                        rows = rows.map((row) => ({ ...row, submissions: 0 }));
                    }
                } catch {
                    rows = [];
                }

                if (!isMounted) return;

                setProject(selected);
                setPracticeProblems(rows);
                setLoading(false);
            })
            .catch((err) => {
                console.log(err);
                if (!isMounted) return;
                setProject(null);
                setPracticeProblems([]);
                setLoading(false);
            });

        return () => {
            isMounted = false;
        };
    }, [classId, projectId]);

    const totalPracticeSubmissions = useMemo(() => {
        return practiceProblems.reduce((sum, pp) => sum + Number(pp.submissions || 0), 0);
    }, [practiceProblems]);

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

                <div className="project-detail-loading">Loading project...</div>
            </div>
        );
    }

    if (!project) {
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
                        { label: "Project Calendar", to: `/admin/${classId}/projects` },
                        { label: "Project Details" },
                    ]}
                />

                <div className="project-detail-empty">
                    Project not found.
                </div>
            </div>
        );
    }

    const active = isProjectActive(project);

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
                    { label: "Project Calendar", to: `/admin/${classId}/projects` },
                    { label: project.Name },
                ]}
            />

            <div className="project-detail-hero">
                <div>
                    <div className="project-detail-title-row">
                        <h1 className="project-detail-title">{project.Name}</h1>
                        {active && <span className="badge-active">● Active</span>}
                    </div>

                    <div className="project-detail-dates">
                        {formatDate12h(project.Start)} - {formatDate12h(project.End)}
                    </div>
                </div>

                <div className="project-detail-hero-stats">
                    <div className="hero-stat-card">
                        <span className="hero-stat-label">Main Submissions</span>
                        <strong>{project.TotalSubmissions}</strong>
                    </div>

                    <div className="hero-stat-card">
                        <span className="hero-stat-label">Practice Submissions</span>
                        <strong>{totalPracticeSubmissions}</strong>
                    </div>
                </div>
            </div>

            <section className="project-work-section">
                <div className="section-heading-row">
                    <div>
                        <h2>Main Project</h2>
                        <p>Review main assignment submissions or edit the project setup.</p>
                    </div>
                </div>

                <div className="work-card main-work-card">
                    <div className="work-card-primary">
                        <div className="work-card-icon" aria-hidden="true">
                            <FaTasks />
                        </div>

                        <div className="work-card-content">
                            <div className="work-card-kicker">Main Assignment</div>
                            <h3>{project.Name}</h3>
                        </div>
                    </div>

                    <div className="submission-callout">
                        <span className="submission-number">{project.TotalSubmissions}</span>
                        <span className="submission-label">
                            submission{project.TotalSubmissions === 1 ? "" : "s"}
                        </span>
                    </div>

                    <div className="work-card-actions">
                        <Link className="button action-button button-review" to={`/admin/${classId}/project/${project.Id}`}>
                            <FaEye aria-hidden="true" />
                            Review Submissions
                        </Link>

                        <Link className="button action-button button-edit" to={`/admin/${classId}/project/${project.Id}/manage/`}>
                            <FaEdit aria-hidden="true" />
                            Edit Project
                        </Link>
                    </div>
                </div>
            </section>

            <section className="project-work-section">
                <div className="section-heading-row">
                    <div>
                        <h2>Practice Problems</h2>
                        <p>Each practice problem can be reviewed and edited separately.</p>
                    </div>

                    <Link className="button manage-practice-button" to={`/admin/${classId}/project/${project.Id}/practice/select`}>
                        Manage Practice Problems
                    </Link>
                </div>

                <div className="practice-card-grid">
                    {practiceProblems.length === 0 && (
                        <div className="practice-empty">
                            No practice problems found for this project.
                        </div>
                    )}

                    {practiceProblems.map((pp) => {
                        const submissionCount = pp.submissions ?? 0;

                        return (
                            <div className="work-card practice-work-card" key={pp.id}>
                                <div className="practice-card-top">
                                    <div className="work-card-content">
                                        <div className="practice-card-kicker">
                                            Practice Problem {pp.number}
                                            {!pp.enabled && <span className="practice-disabled-badge">Disabled</span>}
                                        </div>

                                        <h3>{pp.name}</h3>
                                    </div>

                                    <div className="submission-callout compact">
                                        <span className="submission-number">{submissionCount}</span>
                                        <span className="submission-label">
                                            submission{submissionCount === 1 ? "" : "s"}
                                        </span>
                                    </div>
                                </div>

                                <div className="work-card-actions">
                                    <Link
                                        className="button action-button button-review"
                                        to={`/admin/${classId}/project/${project.Id}?practice=1&practice_problem_id=${pp.id}`}
                                    >
                                        <FaEye aria-hidden="true" />
                                        Review Submissions
                                    </Link>

                                    <Link
                                        className="button action-button button-edit"
                                        to={`/admin/${classId}/project/${project.Id}/practice/${pp.id}`}
                                    >
                                        <FaEdit aria-hidden="true" />
                                        Edit Problem
                                    </Link>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </section>
        </div>
    );
}