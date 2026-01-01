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
}

interface OHQuestion {
    question: string
    question_time: string
    Student_name: string
    Question_id: number
    ruled: number
    submission_id: number
    class_id: number
    project_id: number
}

class AdminOfficeHours extends Component<{}, OfficeHoursState> {
    constructor(props: {}) {
        super(props)
        this.state = {
            question: '',
            Student_questions: [],
        }
        this.handleComplete = this.handleComplete.bind(this)
        this.handleRuling = this.handleRuling.bind(this)
        this.fetchOHQuestions = this.fetchOHQuestions.bind(this)
        this.startFetchingInterval = this.startFetchingInterval.bind(this)
        this.downloadAssignment = this.downloadAssignment.bind(this)
    }

    componentDidMount() {
        this.startFetchingInterval()
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
                    project_id: item[5],
                    class_id: item[6],
                    submission_id: item[7],
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
        setInterval(this.fetchOHQuestions, 300000) // 5 minutes
    }

    render() {
        const { Student_questions } = this.state

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

                    <table border={1} className="question-queue-table">
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
                            {Student_questions.map((item: OHQuestion, index) => (
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
                            ))}
                        </tbody>
                    </table>
                </>
            </div>
        )
    }
}

export default AdminOfficeHours