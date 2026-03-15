import { Fragment, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Helmet } from "react-helmet";
import { Link, useParams } from "react-router-dom";
import { FaArrowLeft, FaEdit, FaEye, FaPlusCircle } from "react-icons/fa";

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

export default function AdminProjectList() {
    const { id } = useParams<{ id: string }>();
    const classId = id || "";

    const [projects, setProjects] = useState<ProjectObject[]>([]);

    type PracticeProblemRow = { id: number; number: number; name: string; enabled: boolean; submissions?: number };
    const [practiceByProjectId, setPracticeByProjectId] = useState<Record<number, PracticeProblemRow[]>>({});


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

    /** Returns true if today's date is within [Start, End] inclusive (both parseable). */
    const isProjectActive = (p: ProjectObject): boolean => {
        const startMs = Date.parse(p.Start);
        const endMs = Date.parse(p.End);
        if (Number.isNaN(startMs) || Number.isNaN(endMs)) return false;

        const now = Date.now();
        return now >= startMs && now <= endMs;
    };

    // Kept for parity with the old AdminComponent (even though the button is currently commented out there).
    const handleExport = (projectId: number) => {
        axios
            .get(`${import.meta.env.VITE_API_URL}/projects/export_project_submissions?id=${projectId}`, {
                headers: {
                    Authorization: `Bearer ${localStorage.getItem("AUTOTA_AUTH_TOKEN")}`,
                },
                responseType: "blob",
            })
            .then((res) => {
                const url = window.URL.createObjectURL(new Blob([res.data]));
                const link = document.createElement("a");
                link.href = url;
                link.setAttribute("download", "StudentSubmissions.zip");
                document.body.appendChild(link);
                link.click();
            })
            .catch((err) => console.log(err));
    };

    useEffect(() => {
        if (!classId) {
            setProjects([]);
            setPracticeByProjectId({});
            return;
        }

        let isMounted = true;

        axios
            .get(`${import.meta.env.VITE_API_URL}/projects/get_projects_by_class_id?id=${classId}`, {
                headers: {
                    Authorization: `Bearer ${localStorage.getItem("AUTOTA_AUTH_TOKEN")}`,
                },
            })
            .then((res) => {
                const parsed: ProjectObject[] = (res.data as any[]).map(
                    (str: any) => JSON.parse(str) as ProjectObject
                );

                if (!isMounted) return;
                setProjects(parsed);

                // If practice is enabled, pull the actual practice-problem list (can be multiple)
                const authHeader = {
                    Authorization: `Bearer ${localStorage.getItem("AUTOTA_AUTH_TOKEN")}`,
                };
                const enabled = parsed.filter((p) => !!p.PracticeProblemsEnabled);
                if (enabled.length === 0) {
                    setPracticeByProjectId({});
                    return;
                }

                Promise.all(
                    enabled.map((p) =>
                        axios
                            .get(
                                `${import.meta.env.VITE_API_URL}/projects/list_practice_problems?project_id=${p.Id}`,
                                { headers: authHeader }
                            )
                            .then(async (r) => {
                                const problems = Array.isArray(r.data?.problems) ? r.data.problems : [];
                                const rows: PracticeProblemRow[] = problems.map((pp: any, idx: number) => ({
                                    id: Number(pp?.id),
                                    number: Number(pp?.number ?? idx + 1),
                                    name: String(pp?.name ?? `Practice Problem ${idx + 1}`),
                                    enabled: !!pp?.enabled,
                                    submissions: 0,
                                }));

                                // Pull per-practice-problem submission counts for this project
                                try {
                                    const countsRes = await axios.get(
                                        `${import.meta.env.VITE_API_URL}/projects/practice_submission_counts?project_id=${p.Id}`,
                                        { headers: authHeader }
                                    );
                                    const by = countsRes.data?.by_problem || {};
                                    rows.forEach((row) => {
                                        const k = String(row.id);
                                        row.submissions = Number(by[k] ?? 0);
                                    });
                                } catch {
                                    // leave submissions as 0
                                }

                                return [p.Id, rows] as const;
                            })
                            .catch(() => [p.Id, []] as const)
                    )
                ).then((pairs) => {
                    if (!isMounted) return;
                    const next: Record<number, PracticeProblemRow[]> = {};
                    pairs.forEach(([pid, rows]) => {
                        next[pid] = rows;
                    });
                    setPracticeByProjectId(next);
                });

            })
            .catch((err) => console.log(err));

        return () => {
            isMounted = false;
        };
    }, [classId]);

    const projectsByStartAsc = useMemo(() => {
        // Sort projects by Project Start Date from earliest to latest (ascending).
        // If a date fails to parse, push it to the end to avoid breaking order.
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

    return (
        <div className="projects-page">
            <Helmet>
                <title>[Admin] TA-Bot</title>
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
                    { label: "Class Selection", to: "/admin/classes" },
                    { label: "Project List" },
                ]}
            />

            <div className="pageTitle">Project List</div>

            <table className="projects-table">
                <thead className="projects-table-head">
                    <tr className="projects-table-row">
                        <th className="projects-table-header">Project Name</th>
                        <th className="projects-table-header">Project Start Date</th>
                        <th className="projects-table-header">Project End Date</th>
                        <th className="projects-table-header">Total Submissions</th>
                        <th className="projects-table-header">Review Submissions</th>
                        <th className="projects-table-header">Edit Project</th>
                        {/* <th className="projects-table-header">Export Project</th> */}
                    </tr>
                </thead>

                <tbody className="projects-table-body">
                    {projectsByStartAsc.map((project) => {
                        const active = isProjectActive(project);
                        const practiceOn = !!project.PracticeProblemsEnabled;
                        return (

                            <Fragment key={project.Id}>
                                <tr
                                    className={`project-row${active ? " is-active" : ""}`}
                                    aria-current={active ? "true" : undefined}
                                >
                                    <td className="project-name">
                                        {project.Name}
                                        {active && (
                                            <span
                                                className="badge-active"
                                                title="Project is active today"
                                                aria-label="Project is active today"
                                            >
                                                ● Active
                                            </span>
                                        )}
                                    </td>

                                    <td className="project-start">{formatDate12h(project.Start)}</td>
                                    <td className="project-end">{formatDate12h(project.End)}</td>
                                    <td className="project-total-submissions">{project.TotalSubmissions}</td>

                                    <td className="project-review">
                                        <Link className="button button-review" to={`/admin/${classId}/project/${project.Id}`}>
                                            <FaEye aria-hidden="true" />
                                            <span className="button-text">Review</span>
                                        </Link>
                                    </td>

                                    <td className="project-edit">
                                        <Link className="button button-edit" to={`/admin/${classId}/project/${project.Id}/manage/`}>
                                            <FaEdit aria-hidden="true" />
                                            <span className="button-text">Edit</span>
                                        </Link>
                                    </td>

                                    {/* <td className="project-export">
                      <button
                        type="button"
                        className="button button-export"
                        onClick={() => handleExport(project.Id)}
                      >
                        <FaFileArchive aria-hidden="true" />
                        <span className="button-text">Export</span>
                      </button>
                    </td> */}
                                </tr>

                                {practiceOn &&
                                    (practiceByProjectId[project.Id] ?? []).map((pp) => (
                                        <tr className="project-row practice-sub" key={`pp-${project.Id}-${pp.id}`}>
                                            <td className="project-name">
                                                <span className="practice-subdir">
                                                    <span className="practice-subdir-icon" aria-hidden="true">
                                                        ↳
                                                    </span>
                                                    {pp.name}
                                                </span>
                                            </td>

                                            <td className="project-start">
                                                <span className="practice-date">{formatDate12h(project.Start)}</span>
                                            </td>
                                            <td className="project-end">
                                                <span className="practice-date">{formatDate12h(project.End)}</span>
                                            </td>

                                            <td className="project-total-submissions">
                                                {pp.submissions ?? project.PracticeTotalSubmissions ?? 0}
                                            </td>

                                            <td className="project-review">
                                                <Link
                                                    className="button button-review"
                                                    to={`/admin/${classId}/project/${project.Id}?practice=1&practice_problem_id=${pp.id}`}
                                                >
                                                    <FaEye aria-hidden="true" />
                                                    <span className="button-text">Review</span>
                                                </Link>
                                            </td>

                                            <td className="project-edit">
                                                <Link
                                                    className="button button-edit"
                                                    to={`/admin/${classId}/project/${project.Id}/practice/${pp.id}`}
                                                >
                                                    <FaEdit aria-hidden="true" />
                                                    <span className="button-text">Edit</span>
                                                </Link>
                                            </td>
                                        </tr>
                                    ))}

                            </Fragment>

                        );
                    })}
                </tbody>
            </table>

            <Link className="button button-create-assignment" to={`/admin/${classId}/project/0/manage/`}>
                <FaPlusCircle aria-hidden="true" />
                <span className="button-text">Create new assignment</span>
            </Link>
        </div>
    );
}