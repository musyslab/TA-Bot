import { Component } from 'react'
import axios from 'axios'
import { Link } from 'react-router-dom'
import '../../styling/AdminOfficeHours.scss'
import MenuComponent from '../components/MenuComponent'
import DirectoryBreadcrumbs from "../components/DirectoryBreadcrumbs"
import {
    FaHandshake,
    FaRegClock,
    FaEye,
    FaTimesCircle,
    FaCheckCircle,
    FaDownload,
} from 'react-icons/fa'

interface OfficeHoursState {
    question: string
    Student_questions: Array<OHQuestion>
    historyPage: number
}

interface OHQuestion {
    question: string
    question_time: string
    accepted_time: string
    completed_time: string
    Student_name: string
    Question_id: number
    ruled: number
    dismissed: number
    submission_id: number
    class_id: number
    project_id: number
}

class AdminOfficeHours extends Component<{}, OfficeHoursState> {

    private fetchIntervalId: number | undefined

    constructor(props: {}) {
        super(props)
        this.state = {
            question: '',
            Student_questions: [],
            historyPage: 1,
        }
        this.handleComplete = this.handleComplete.bind(this)
        this.handleRuling = this.handleRuling.bind(this)
        this.fetchOHQuestions = this.fetchOHQuestions.bind(this)
        this.startFetchingInterval = this.startFetchingInterval.bind(this)
        this.downloadAssignment = this.downloadAssignment.bind(this)
        this.setHistoryPage = this.setHistoryPage.bind(this)
    }

    componentDidMount() {
        this.startFetchingInterval()
    }

    componentDidUpdate(_prevProps: {}, prevState: OfficeHoursState) {
        // Clamp history page if the history size shrinks (after completing/rejecting, etc.)
        if (prevState.Student_questions !== this.state.Student_questions) {
            const history = this.state.Student_questions.filter((q) => (q.dismissed ?? 0) === 1)
            const totalPages = Math.max(1, Math.ceil(history.length / 5))
            if (this.state.historyPage > totalPages) {
                // eslint-disable-next-line react/no-did-update-set-state
                this.setState({ historyPage: totalPages })
            }
        }
    }

    componentWillUnmount() {
        if (this.fetchIntervalId) {
            window.clearInterval(this.fetchIntervalId)
        }
    }

    downloadAssignment(projectId: number) {
        axios
            .get(
                `${import.meta.env.VITE_API_URL}/projects/getAssignmentDescription?project_id=${projectId}`,
                {
                    headers: { Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}` },
                    responseType: 'blob',
                }
            )
            .then((res) => {
                const h = res.headers as Record<string, string>
                const type = h['content-type'] || 'application/octet-stream'
                const blob = new Blob([res.data], { type })

                // Filename: prefer CORS-exposed header, else simple Content-Disposition parse, else MIME guess
                let name = h['x-filename']
                if (!name) {
                    const disp = h['content-disposition'] || ''
                    const m = /filename="?([^"]+)"?/.exec(disp)
                    if (m && m[1]) {
                        name = m[1]
                    }
                }
                if (!name) {
                    const ext = type.includes('pdf')
                        ? '.pdf'
                        : type.includes('wordprocessingml')
                            ? '.docx'
                            : type.includes('msword')
                                ? '.doc'
                                : ''
                    name = `assignment${ext}`
                }

                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = name
                document.body.appendChild(a)
                a.click()
                a.remove()
                URL.revokeObjectURL(url)
            })
            .catch((err) => console.error('Download failed:', err))
    }

    fetchOHQuestions = () => {
        axios
            .get(import.meta.env.VITE_API_URL + '/submissions/getOHquestions', {
                headers: {
                    Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}`,
                },
            })
            .then((res) => {
                const formattedQuestions: OHQuestion[] = res.data.map((item: any[]) => ({
                    Question_id: item[0],
                    question: item[1],
                    question_time: item[2],
                    Student_name: item[3],
                    ruled: item[4],
                    dismissed: item[5],
                    accepted_time: item[6],
                    completed_time: item[7],
                    project_id: item[8],
                    class_id: item[9],
                    submission_id: item[10],
                }))
                this.setState({ Student_questions: formattedQuestions })
            })
            .catch((err) => {
                console.log(err)
            })
    }

    handleComplete =
        (id: number) =>
            (_e: any) => {
                axios
                    .get(
                        `${import.meta.env.VITE_API_URL}/submissions/dismissOHQuestion?question_id=${id}`,
                        { headers: { Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}` } }
                    )
                    .then(() => this.fetchOHQuestions())
                    .catch((err) => console.log(err))
            }

    handleRuling(id: number, ruling: number) {
        axios
            .get(
                import.meta.env.VITE_API_URL +
                `/submissions/submitOHQuestionRuling?question_id=${id}&ruling=${ruling}`,
                {
                    headers: {
                        Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}`,
                    },
                }
            )
            .then(() => {
                this.fetchOHQuestions()
            })
            .catch((err) => {
                console.log(err)
            })
    }

    calculateTimeDifference = (questionTime: string) => {
        const currentTime = new Date()
        const questionTimestamp = new Date(questionTime).getTime()
        const timeDifferenceInMilliseconds = currentTime.getTime() - questionTimestamp
        const timeDifferenceInMinutes = Math.floor(timeDifferenceInMilliseconds / (1000 * 60))
        return timeDifferenceInMinutes
    }

    startFetchingInterval() {
        this.fetchOHQuestions()
        this.fetchIntervalId = window.setInterval(this.fetchOHQuestions, 300000) // 5 minutes
    }

    setHistoryPage(nextPage: number) {
        this.setState({ historyPage: nextPage })
    }

    render() {
        const { Student_questions } = this.state

        const queueQuestions = Student_questions.filter((q) => (q.dismissed ?? 0) === 0)
        const historyQuestions = Student_questions
            .filter((q) => (q.dismissed ?? 0) === 1)
            // newest first (higher id first)
            .sort((a, b) => (b.Question_id ?? 0) - (a.Question_id ?? 0))

        const pageSize = 5
        const totalHistoryPages = Math.max(1, Math.ceil(historyQuestions.length / pageSize))
        const historyPage = Math.min(this.state.historyPage, totalHistoryPages)
        const historyStart = (historyPage - 1) * pageSize
        const historySlice = historyQuestions.slice(historyStart, historyStart + pageSize)

        return (
            <div className="oh-page">
                <>

                    <MenuComponent
                        showUpload={false}
                        showAdminUpload={true}
                        showHelp={false}
                        showCreate={false}
                        showLast={false}
                        showReviewButton={false}
                    ></MenuComponent>

                    <DirectoryBreadcrumbs
                        items={[
                            { label: "Class Selection", to: "/admin/classes" },
                            { label: "Office Hours" },
                        ]}
                    />

                    <div className="pageTitle">Office Hours</div>

                    <div className="table-section">
                        <div className="tableTitle">Current Queue</div>
                        <table border={1} className="question-queue-table oh-table">
                            <thead className="table-head">
                                <tr className="head-row">
                                    <th className="col-status">Status</th>
                                    <th className="col-position">Queue</th>
                                    <th className="col-student">Student Name</th>
                                    <th className="col-question">Question</th>
                                    <th className="col-wait">Time in Queue</th>
                                    <th className="col-feedback">Decision</th>
                                    <th className="col-code">Student Code</th>
                                    <th className="col-assignment">Assignment</th>
                                    <th className="col-complete">Complete</th>
                                </tr>
                            </thead>

                            <tbody className="table-body">
                                {queueQuestions.length === 0 ? (
                                    <tr className="empty-row">
                                        <td className="empty-cell" colSpan={9}>
                                            No students are currently in the office hours queue.
                                        </td>
                                    </tr>
                                ) : (
                                    queueQuestions.map((item: OHQuestion, index) => (
                                        <tr
                                            key={item.Question_id}
                                            className={`data-row ${item.ruled === 1 ? 'is-in-oh' : ''}`}
                                        >
                                            <td
                                                className="cell-status"
                                                aria-label={item.ruled === 1 ? 'In office hours' : 'Waiting in queue'}
                                            >
                                                {item.ruled === 1 ? (
                                                    <span className="status in-oh" aria-hidden="true">
                                                        <FaHandshake />
                                                    </span>
                                                ) : (
                                                    <span className="status waiting" aria-hidden="true">
                                                        <FaRegClock />
                                                    </span>
                                                )}
                                            </td>

                                            <td className="cell-position">{index + 1}</td>
                                            <td className="cell-student">{item.Student_name}</td>
                                            <td className="cell-question">{item.question}</td>
                                            <td className="cell-wait">
                                                {'In queue for ' + this.calculateTimeDifference(item.question_time)} minutes
                                            </td>

                                            <td className="cell-feedback">
                                                {item.ruled === -1 ? (
                                                    <div className="feedback-actions">
                                                        <button
                                                            className="button button-reject"
                                                            onClick={() => this.handleRuling(item.Question_id, 0)}
                                                        >
                                                            <FaTimesCircle aria-hidden="true" /> Reject
                                                        </button>
                                                        <button
                                                            className="button button-accept"
                                                            onClick={() => this.handleRuling(item.Question_id, 1)}
                                                        >
                                                            <FaCheckCircle aria-hidden="true" /> Accept
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <div className="feedback-actions is-disabled">
                                                        <button className="button button-reject" disabled>
                                                            <FaTimesCircle aria-hidden="true" /> Reject
                                                        </button>
                                                        <button className="button button-accept" disabled>
                                                            <FaCheckCircle aria-hidden="true" /> Accept
                                                        </button>
                                                    </div>
                                                )}
                                            </td>

                                            <td className="cell-code">
                                                {item.ruled === -1 ? (
                                                    <div className="locked-box">
                                                        <button
                                                            className="button button-view-code is-locked"
                                                            disabled
                                                            aria-disabled="true"
                                                            aria-describedby={`lock-${item.Question_id}-code`}
                                                            title="Locked until you Accept or Reject"
                                                        >
                                                            <FaEye aria-hidden="true" /> View
                                                        </button>
                                                    </div>
                                                ) : item.submission_id !== -1 ? (
                                                    <Link
                                                        target="_blank"
                                                        to={`/class/${item.class_id}/code/${item.submission_id}`}
                                                        className="link-code"
                                                    >
                                                        <button className="button button-view-code">View</button>
                                                    </Link>
                                                ) : (
                                                    <button className="button button-view-code">
                                                        <FaEye aria-hidden="true" /> View
                                                    </button>
                                                )}
                                            </td>

                                            <td className="cell-assignment">
                                                {item.ruled === -1 ? (
                                                    <div className="locked-box">
                                                        <button
                                                            className="button button-assignment is-locked"
                                                            disabled
                                                            aria-disabled="true"
                                                            aria-describedby={`lock-${item.Question_id}-assignment`}
                                                            title="Locked until you Accept or Reject"
                                                        >
                                                            <FaDownload aria-hidden="true" />
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <button
                                                        className="button button-assignment"
                                                        onClick={() => this.downloadAssignment(item.project_id)}
                                                        title="Download assignment description"
                                                    >
                                                        <FaDownload aria-hidden="true" />
                                                    </button>
                                                )}
                                            </td>

                                            <td className="cell-complete">
                                                {item.ruled === -1 ? (
                                                    <div className="locked-box">
                                                        <button
                                                            className="button button-completed is-locked"
                                                            disabled
                                                            aria-disabled="true"
                                                            aria-describedby={`lock-${item.Question_id}-complete`}
                                                            title="Locked until you Accept or Reject"
                                                        >
                                                            <FaCheckCircle aria-hidden="true" /> Completed
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <button
                                                        className="button button-completed"
                                                        onClick={this.handleComplete(item.Question_id)}
                                                    >
                                                        <FaCheckCircle aria-hidden="true" /> Completed
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>

                    <div className="table-section">
                        <div className="tableTitle">History</div>
                        <table border={1} className="question-queue-table oh-table history-table">
                            <thead className="table-head">
                                <tr className="head-row">
                                    <th className="col-status">Outcome</th>
                                    <th className="col-position">#</th>
                                    <th className="col-student">Student Name</th>
                                    <th className="col-question">Question</th>
                                    <th className="col-wait">Submitted</th>
                                    <th className="col-feedback">Decision</th>
                                    <th className="col-code">Student Code</th>
                                    <th className="col-assignment">Assignment</th>
                                </tr>
                            </thead>

                            <tbody className="table-body">
                                {historyQuestions.length === 0 ? (
                                    <tr className="empty-row">
                                        <td className="empty-cell" colSpan={8}>
                                            No office hours history yet.
                                        </td>
                                    </tr>
                                ) : (
                                    historySlice.map((item: OHQuestion, index) => (
                                        <tr key={`hist-${item.Question_id}`} className="data-row is-history">
                                            <td className="cell-status" aria-label="Outcome">
                                                {item.ruled === 1 ? (
                                                    <span className="status outcome-accepted" aria-hidden="true">
                                                        <FaCheckCircle />
                                                    </span>
                                                ) : item.ruled === 0 ? (
                                                    <span className="status outcome-rejected" aria-hidden="true">
                                                        <FaTimesCircle />
                                                    </span>
                                                ) : (
                                                    <span className="status outcome-unknown" aria-hidden="true">
                                                        <FaRegClock />
                                                    </span>
                                                )}
                                            </td>

                                            <td className="cell-position">{historyStart + index + 1}</td>
                                            <td className="cell-student">{item.Student_name}</td>
                                            <td className="cell-question">{item.question}</td>
                                            <td className="cell-wait">{item.question_time || '—'}</td>

                                            <td className="cell-feedback">
                                                {item.ruled === 1 ? 'Accepted' : item.ruled === 0 ? 'Rejected' : 'No decision'}
                                            </td>

                                            <td className="cell-code">
                                                {item.submission_id !== -1 ? (
                                                    <Link
                                                        target="_blank"
                                                        to={`/class/${item.class_id}/code/${item.submission_id}`}
                                                        className="link-code"
                                                    >
                                                        <button className="button button-view-code">View</button>
                                                    </Link>
                                                ) : (
                                                    <button className="button button-view-code" disabled>
                                                        <FaEye aria-hidden="true" /> View
                                                    </button>
                                                )}
                                            </td>

                                            <td className="cell-assignment">
                                                <button
                                                    className="button button-assignment"
                                                    onClick={() => this.downloadAssignment(item.project_id)}
                                                    title="Download assignment description"
                                                >
                                                    <FaDownload aria-hidden="true" />
                                                </button>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>

                        {historyQuestions.length > pageSize && (
                            <div className="pagination-controls" aria-label="History pagination">
                                <button
                                    className="button"
                                    onClick={() => this.setHistoryPage(Math.max(1, historyPage - 1))}
                                    disabled={historyPage <= 1}
                                >
                                    Prev
                                </button>
                                <div className="pagination-meta">
                                    Page {historyPage} of {totalHistoryPages}
                                </div>
                                <button
                                    className="button"
                                    onClick={() => this.setHistoryPage(Math.min(totalHistoryPages, historyPage + 1))}
                                    disabled={historyPage >= totalHistoryPages}
                                >
                                    Next
                                </button>
                            </div>
                        )}
                    </div>

                </>
            </div>
        )
    }
}

export default AdminOfficeHours