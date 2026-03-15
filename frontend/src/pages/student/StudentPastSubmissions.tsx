import { Component } from 'react'
import axios from 'axios'
import { Link } from 'react-router-dom'
import MenuComponent from '../components/MenuComponent'
import { Helmet } from 'react-helmet'
import DirectoryBreadcrumbs from '../components/DirectoryBreadcrumbs'
import '../../styling/StudentPastSubmissions.scss'

type ApiPastSubmissionsProject = {
    projectId: number
    projectName: string
    classId: string
    className: string
    start: string
    end: string
    main: { submissionId: number; time: string; passed: boolean } | null
    practices: Array<{
        practiceProblemId: number
        number: number
        name: string
        submissionId: number
        time: string
        passed: boolean
    }>
}

type PastRow = {
    key: string
    projectId: number
    projectName: string
    classId: string
    className: string
    submissionDate: string
    passed: boolean
    isPractice: boolean
    practiceProblemId?: number
    practiceName?: string
    isActiveRow: boolean
}

interface ProjectsState {
    rows: Array<PastRow>
}

class StudentPastSubmissions extends Component<{}, ProjectsState> {
    constructor(props: {}) {
        super(props)
        this.state = { rows: [] }
    }

    private formatDate12h(value: string): string {
        if (!value || value === 'N/A') return 'N/A'
        const d = new Date(value)
        if (Number.isNaN(d.getTime())) return value
        return new Intl.DateTimeFormat('en-US', {
            year: 'numeric',
            month: 'short',
            day: '2-digit',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
        }).format(d)
    }

    private isProjectActive(start: string, end: string): boolean {
        const startMs = Date.parse(start)
        const endMs = Date.parse(end)
        if (Number.isNaN(startMs) || Number.isNaN(endMs)) return false
        const now = Date.now()
        return now >= startMs && now <= endMs
    }

    componentDidMount() {
        axios
            .get(import.meta.env.VITE_API_URL + `/projects/past-submissions`, {
                headers: { Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}` },
            })
            .then((res) => {
                const data: ApiPastSubmissionsProject[] =
                    typeof res.data === 'string' ? JSON.parse(res.data) : (res.data ?? [])

                // Sort projects by start date ascending, like AdminProjectList
                const projectsSorted = [...(data || [])].sort((a, b) => {
                    const da = Date.parse(a.start)
                    const db = Date.parse(b.start)
                    const aBad = Number.isNaN(da)
                    const bBad = Number.isNaN(db)
                    if (aBad && bBad) return 0
                    if (aBad) return 1
                    if (bBad) return -1
                    return da - db
                })

                const rows: PastRow[] = []

                projectsSorted.forEach((p) => {
                    const active = this.isProjectActive(p.start, p.end)

                    // Main row (if any)
                    if (p.main) {
                        rows.push({
                            key: `proj-${p.projectId}`,
                            projectId: p.projectId,
                            projectName: p.projectName,
                            classId: p.classId,
                            className: p.className,
                            submissionDate: p.main.time,
                            passed: !!p.main.passed,
                            isPractice: false,
                            isActiveRow: active,
                        })
                    }

                    // Practice rows under the project (grey + arrow)
                    const practices = Array.isArray(p.practices) ? [...p.practices] : []
                    practices.sort((x, y) => (x.number ?? 0) - (y.number ?? 0))

                    // If there is no main row but the project is active, highlight the first practice row
                    const highlightFirstPractice = active && !p.main && practices.length > 0

                    practices.forEach((pp, idx) => {
                        rows.push({
                            key: `pp-${p.projectId}-${pp.practiceProblemId}`,
                            projectId: p.projectId,
                            projectName: p.projectName,
                            classId: p.classId,
                            className: p.className,
                            submissionDate: pp.time,
                            passed: !!pp.passed,
                            isPractice: true,
                            practiceProblemId: pp.practiceProblemId,
                            practiceName: pp.name,
                            isActiveRow: highlightFirstPractice && idx === 0,
                        })
                    })
                })

                this.setState({ rows })
            })
            .catch((err) => console.log(err))
    }

    render() {
        return (
            <div className="past-submissions">
                <Helmet>
                    <title>TA-Bot</title>
                </Helmet>

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
                        { label: 'Class Selection', to: '/student/classes' },
                        { label: 'Past Submissions' },
                    ]}
                />

                <div className="pageTitle">Past Submissions</div>

                <div className="content">
                    <div className="content-card">
                        <div className="table-wrap">
                            <table className="submissions-table" role="table">
                                <thead className="table-head">
                                    <tr className="header-row">
                                        <th className="col col-project" scope="col">
                                            Project Name
                                        </th>
                                        <th className="col col-class" scope="col">
                                            Class Name
                                        </th>
                                        <th className="col col-date" scope="col">
                                            Submission Date
                                        </th>
                                        <th className="col col-results" scope="col">
                                            Results
                                        </th>
                                        <th className="col col-link" scope="col">
                                            Link
                                        </th>
                                    </tr>
                                </thead>

                                <tbody className="table-body">
                                    {this.state.rows.map((row) => {
                                        const rowClass =
                                            `data-row` +
                                            (row.isPractice ? ` practice-sub` : ``) +
                                            (row.isActiveRow ? ` is-active` : ``)

                                        const linkTo = row.isPractice
                                            ? `/student/${row.classId}/code/${row.projectId}?practice=1&practice_problem_id=${row.practiceProblemId}&from=past`
                                            : `/student/${row.classId}/code/${row.projectId}?from=past`

                                        return (
                                            <tr className={rowClass} key={row.key}>
                                                <td className="cell cell-project">
                                                    {row.isPractice ? (
                                                        <span className="practice-subdir">
                                                            <span className="practice-subdir-icon" aria-hidden="true">
                                                                ↳
                                                            </span>
                                                            {row.practiceName || 'Practice Problem'}
                                                        </span>
                                                    ) : (
                                                        row.projectName
                                                    )}
                                                </td>
                                                <td className="cell cell-class">{row.className}</td>
                                                <td className="cell cell-date">{this.formatDate12h(row.submissionDate)}</td>
                                                <td className={`cell cell-results ${row.passed ? 'passed' : 'failed'}`}>
                                                    {row.passed ? 'PASSED' : 'FAILED'}
                                                </td>
                                                <td className="cell cell-link">
                                                    <Link className="view-link" to={linkTo}>
                                                        View
                                                    </Link>
                                                </td>
                                            </tr>
                                        )
                                    })}

                                    {this.state.rows.length === 0 && (
                                        <tr className="empty-row">
                                            <td className="cell cell-empty" colSpan={5}>
                                                No submissions found.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        )
    }
}

export default StudentPastSubmissions