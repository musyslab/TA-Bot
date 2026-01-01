import React, { Component } from 'react'
import { useParams } from 'react-router-dom'
import axios from 'axios'
import { Helmet } from 'react-helmet'
import MenuComponent from '../components/MenuComponent'
import DirectoryBreadcrumbs from "../components/DirectoryBreadcrumbs"
import '../../styling/StudentOfficeHours.scss'

interface OfficeHoursProps {
    class_id?: string
}

interface OHQuestion {
    questionID: number
    question: string
    question_time: string
    username?: string
}

interface DropDownOption {
    key: number
    value: number
    text: string
}

interface OfficeHoursState {
    question: string
    questionAsked: boolean
    Student_questions: Array<OHQuestion>
    projects: Array<DropDownOption>
    selectedProject: number | null
    usersQuestionID: number
    project_name: string
    dueDate: string
    studentMessage: string
}

const StudentOfficeHours: React.FC = () => {
    const params = useParams()

    const class_id =
        (params as any)?.class_id ??
        (params as any)?.id ??
        (params as any)?.cid ??
        (params as any)?.classId

    return (
        <div>
            <Helmet>
                <title> TA-Bot</title>
            </Helmet>

            <MenuComponent
                showUpload={true}
                showAdminUpload={false}
                showHelp={false}
                showCreate={false}
                showLast={false}
                showReviewButton={false}
            />

            <OfficeHoursComponent class_id={class_id} />
        </div>
    )
}

class OfficeHoursComponent extends Component<OfficeHoursProps, OfficeHoursState> {
    private fetchIntervalId: number | undefined

    constructor(props: OfficeHoursProps) {
        super(props)
        this.state = {
            question: '',
            questionAsked: false,
            Student_questions: [],
            projects: [],
            selectedProject: null,
            usersQuestionID: 0,
            project_name: '',
            dueDate: '',
            studentMessage: '',
        }

        this.handleQuestionSubmit = this.handleQuestionSubmit.bind(this)
        this.fetchOHQuestions = this.fetchOHQuestions.bind(this)
        this.startFetchingInterval = this.startFetchingInterval.bind(this)
        this.calculateTimeDifference = this.calculateTimeDifference.bind(this)
        this.activequestion = this.activequestion.bind(this)

        this.getSubmissionDetails = this.getSubmissionDetails.bind(this)
        this.fetchProjects = this.fetchProjects.bind(this)
        this.resolveSelectedProject = this.resolveSelectedProject.bind(this)
        this.resolveProjectIdFromName = this.resolveProjectIdFromName.bind(this)
    }

    componentDidMount(): void {
        const raw = this.props.class_id
        const classId = raw ? Number.parseInt(raw, 10) : NaN

        if (!Number.isNaN(classId)) {
            this.getSubmissionDetails(classId)
            this.fetchProjects(classId)
        } else {
            console.warn('[OfficeHours] No class_id in URL; Join disabled until project can be inferred.')
        }

        this.activequestion()
        this.startFetchingInterval()
    }

    componentWillUnmount(): void {
        if (this.fetchIntervalId !== undefined) {
            clearInterval(this.fetchIntervalId)
        }
    }

    private normalizeKey(s: string): string {
        return (s || '')
            .toLowerCase()
            .replace(/_/g, ' ')
            .replace(/[^a-z0-9]+/g, ' ')
            .trim()
            .replace(/\s+/g, ' ')
    }

    getSubmissionDetails(classId: number) {
        axios
            .get(`${import.meta.env.VITE_API_URL}/submissions/GetSubmissionDetails?class_id=${classId}`, {
                headers: { Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}` },
            })
            .then((res) => {
                const project_name = res.data?.[3] as string
                const dueDate = res.data?.[4] as string
                this.setState({ project_name: project_name || '', dueDate: dueDate || '' }, () => {
                    this.resolveSelectedProject()
                })
            })
            .catch((err) => console.log(err))
    }

    fetchProjects(classId: number) {
        axios
            .get(`${import.meta.env.VITE_API_URL}/projects/get_projects_by_class_id?id=${classId}`, {
                headers: { Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}` },
            })
            .then((res) => {
                const projectDropdown: DropDownOption[] = (res.data || []).map((itemString: string) => {
                    const item = JSON.parse(itemString)
                    return { key: item.Id, value: item.Id, text: item.Name }
                })
                this.setState({ projects: projectDropdown }, () => {
                    this.resolveSelectedProject()
                })
            })
            .catch((err) => console.log(err))
    }

    resolveSelectedProject() {
        const { project_name, projects, selectedProject } = this.state
        if (selectedProject && selectedProject !== 0) return

        const resolved = this.resolveProjectIdFromName(project_name, projects)
        if (resolved) {
            this.setState({ selectedProject: resolved })
            return
        }

        if (projects.length === 1) {
            this.setState({ selectedProject: projects[0].value })
            return
        }
    }

    resolveProjectIdFromName(projectName: string, projects: DropDownOption[]): number | null {
        if (!projectName || !projects?.length) return null
        const key = this.normalizeKey(projectName)

        let match = projects.find((p) => this.normalizeKey(p.text) === key)
        if (match) return match.value

        match = projects.find((p) => {
            const t = this.normalizeKey(p.text)
            return t.startsWith(key) || key.startsWith(t) || t.includes(key) || key.includes(t)
        })

        return match ? match.value : null
    }

    activequestion() {
        axios
            .get(import.meta.env.VITE_API_URL + '/submissions/getactivequestion', {
                headers: { Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}` },
            })
            .then((res) => {
                const data = parseInt(res.data)
                if (data !== -1) {
                    this.setState({ usersQuestionID: data, questionAsked: true })
                    this.startFetchingInterval()
                } else {
                    this.setState({ usersQuestionID: 0, questionAsked: false })
                }
            })
            .catch((err) => console.log(err))
    }

    handleQuestionSubmit() {
        const { selectedProject, question } = this.state

        if (!Number.isInteger(selectedProject as number)) {
            window.alert('Active project not detected yet. Please wait a moment and try again.')
            return
        }

        axios
            .get(
                `${import.meta.env.VITE_API_URL}/submissions/submitOHquestion?question=${encodeURIComponent(
                    question || ''
                )}&projectId=${selectedProject}`,
                { headers: { Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}` } }
            )
            .then((res) => {
                this.setState({ usersQuestionID: res.data, questionAsked: true })
                this.startFetchingInterval()
            })
            .catch((err) => console.log(err))
    }

    fetchOHQuestions() {
        axios
            .get(import.meta.env.VITE_API_URL + '/submissions/getOHquestions', {
                headers: { Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}` },
            })
            .then((res) => {
                const formatted: OHQuestion[] = (res.data || []).map((item: any) => {
                    if (Array.isArray(item)) {
                        const idRaw = item[0]
                        const qid = typeof idRaw === 'string' ? parseInt(idRaw, 10) : Number(idRaw ?? 0)
                        return {
                            questionID: Number.isFinite(qid) ? qid : 0,
                            question: item[1] ?? '',
                            question_time: item[2] ?? '',
                            username: item[3] ?? 'Unknown',
                        }
                    }

                    if (item && typeof item === 'object') {
                        const idRaw = item.questionID ?? item.id ?? item.Id
                        const qid = typeof idRaw === 'string' ? parseInt(idRaw, 10) : Number(idRaw ?? 0)
                        return {
                            questionID: Number.isFinite(qid) ? qid : 0,
                            question: item.question ?? item.text ?? '',
                            question_time: item.question_time ?? item.time ?? item.created_at ?? '',
                            username: item.username ?? item.user ?? item.name ?? 'Unknown',
                        }
                    }

                    return { questionID: 0, question: '', question_time: '', username: 'Unknown' }
                })

                this.setState({ Student_questions: formatted })
            })
            .catch((err) => console.log(err))
    }

    calculateTimeDifference(questionTime: string) {
        const now = Date.now()
        const ts = new Date(questionTime).getTime()
        if (Number.isNaN(ts)) return 0
        const diffMs = now - ts
        return Math.max(0, Math.floor(diffMs / (1000 * 60)))
    }

    startFetchingInterval() {
        this.fetchOHQuestions()
        if (this.fetchIntervalId !== undefined) {
            clearInterval(this.fetchIntervalId)
        }
        this.fetchIntervalId = window.setInterval(this.fetchOHQuestions, 60_000)
    }

    render() {
        const inQueue = this.state.usersQuestionID > 0 || this.state.questionAsked

        return (
            <div className="oh-page">

                <DirectoryBreadcrumbs
                    items={[
                        { label: "Class Selection", to: "/class/classes" },
                        { label: "Office Hours" },
                    ]}
                />

                <div className="pageTitle">In-Person Office Hours</div>

                <section className="panel panel-queue">
                    <h3 className="panel-title">Current Queue</h3>

                    {inQueue && (
                        <div className="you-in-queue" role="status" aria-live="polite">
                            <p>You are in the queue.</p>
                        </div>
                    )}

                    <div className="queue">
                        <table className="table queue-table">
                            <thead className="table-head">
                                <tr className="table-row">
                                    <th className="col col-username">Name</th>
                                    <th className="col col-position">Position</th>
                                    <th className="col col-time">Time Submitted</th>
                                </tr>
                            </thead>

                            <tbody className="table-body">
                                {this.state.Student_questions.map((q, index) => {
                                    const isYou = q.questionID === this.state.usersQuestionID
                                    const displayName = `${q.username || 'Unknown'}${isYou ? ' (you)' : ''}`
                                    return (
                                        <tr
                                            key={`${q.questionID}-${index}`}
                                            className={`table-row queue-row${isYou ? ' is-you' : ''}`}
                                        >
                                            <td className="queue-username">{displayName}</td>
                                            <td className="queue-position">{index + 1}</td>
                                            <td className="queue-time">
                                                {q.question_time
                                                    ? `${q.question_time} - ${this.calculateTimeDifference(q.question_time)} minutes ago`
                                                    : '—'}
                                            </td>
                                        </tr>
                                    )
                                })}

                                {this.state.Student_questions.length === 0 && (
                                    <tr className="table-row">
                                        <td colSpan={3} className="empty">
                                            No active students in the queue.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </section>

                <section className="panel panel-join">
                    <h3 className="panel-title">Join the Queue</h3>

                    {this.state.questionAsked ? (
                        <div className="already-in-queue">
                            <p>You are already in the queue.</p>
                        </div>
                    ) : null}

                    {!Number.isInteger(this.state.selectedProject as number) && (
                        <div className="subtle" role="status">
                            Detecting active project for this class…
                        </div>
                    )}

                    <form className="form form-join">
                        <div className="form-field">
                            <label htmlFor="question-textarea" className="label">
                                (Optional) Add context for the TA
                            </label>
                            <textarea
                                id="question-textarea"
                                rows={3}
                                className="textarea question-textarea"
                                placeholder="You can leave this blank and join now."
                                value={this.state.question}
                                onChange={(e) => this.setState({ question: e.target.value })}
                                disabled={this.state.questionAsked}
                            />
                        </div>

                        <button
                            type="button"
                            className="btn btn-submit"
                            onClick={this.handleQuestionSubmit}
                            disabled={
                                this.state.questionAsked || !Number.isInteger(this.state.selectedProject as number)
                            }
                            aria-disabled={
                                this.state.questionAsked || !Number.isInteger(this.state.selectedProject as number)
                            }
                        >
                            Join Queue
                        </button>
                    </form>
                </section>
            </div>
        )
    }
}

export default StudentOfficeHours