import { Component } from 'react'
import axios from 'axios'
import { Link } from 'react-router-dom'
import MenuComponent from '../components/MenuComponent'
import { Helmet } from 'react-helmet'
import DirectoryBreadcrumbs from "../components/DirectoryBreadcrumbs";
import '../../styling/StudentPastSubmissions.scss'

class Row {
    constructor() {
        this.id = 0;
        this.project_name = "";
        this.score = 0;
        this.date = "";
        this.classname = "";
        this.classid = "";
    }

    id: number;
    project_name: string;
    score: number;
    date: string;
    classname: string;
    classid: string;
}

interface ProjectsState {
    rows: Array<Row>;
}

class StudentPastSubmissions extends Component<{}, ProjectsState> {
    constructor(props: {}) {
        super(props);
        this.state = { rows: [] };
    }

    componentDidMount() {
        axios
            .get(import.meta.env.VITE_API_URL + `/projects/projects-by-user`, {
                headers: { Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}` },
            })
            .then((res) => {
                const data =
                    typeof res.data === 'string'
                        ? JSON.parse(res.data)
                        : res.data;
                const rows: Array<Row> = [];

                Object.entries(data ?? {}).forEach(([key, value]) => {
                    const row = new Row();
                    const test = value as any[];
                    row.project_name = key;
                    row.id = Number(test[0] ?? 0);
                    row.score = Number(test[1] ?? 0);
                    row.date = String(test[2] ?? '');
                    row.classname = String(test[3] ?? '');
                    row.classid = String(test[4] ?? '');
                    rows.push(row);
                });

                this.setState({ rows });
            })
            .catch((err) => console.log(err));
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
                        { label: "Class Selection", to: "/class/classes" },
                        { label: "Past Submissions" },
                    ]}
                />

                <div className="pageTitle">Past Submissions</div>

                <div className="content">
                    <div className="content-card">
                        <div className="table-wrap">
                            <table className="submissions-table" role="table">
                                <thead className="table-head">
                                    <tr className="header-row">
                                        <th className="col col-project" scope="col">Project Name</th>
                                        <th className="col col-date" scope="col">Submission Date</th>
                                        <th className="col col-class" scope="col">Class Name</th>
                                        <th className="col col-link" scope="col">Link</th>
                                    </tr>
                                </thead>
                                <tbody className="table-body">
                                    {this.state.rows.map((row) => (
                                        <tr className="data-row" key={`${row.classid}-${row.id}`}>
                                            <td className="cell cell-project">{row.project_name}</td>
                                            <td className="cell cell-date">{row.date}</td>
                                            <td className="cell cell-class">{row.classname}</td>
                                            <td className="cell cell-link">
                                                <Link
                                                    className="view-link"
                                                    target="_blank"
                                                    to={`/class/${row.classid}/code/${row.id}`}
                                                >
                                                    View
                                                </Link>
                                            </td>
                                        </tr>
                                    ))}
                                    {this.state.rows.length === 0 && (
                                        <tr className="empty-row">
                                            <td className="cell cell-empty" colSpan={4}>No submissions found.</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

export default StudentPastSubmissions;
