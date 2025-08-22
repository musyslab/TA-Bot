import { Component } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import '../css/TaLandingComponent.scss';

interface OfficeHoursState {
    question: string;
    Student_questions: Array<OHQuestion>;
}

interface OHQuestion {
    question: string;
    question_time: string;
    Student_name: string;
    Question_id: number;
    ruled: number;
    submission_id: number;
    class_id: number;
}

class TaComponent extends Component<{}, OfficeHoursState> {
    constructor(props: {}) {
        super(props);
        this.state = {
            question: "",
            Student_questions: [],
        };
        this.handleComplete = this.handleComplete.bind(this);
        this.handleRuling = this.handleRuling.bind(this);
        this.fetchOHQuestions = this.fetchOHQuestions.bind(this);
        this.startFetchingInterval = this.startFetchingInterval.bind(this);
    }

    componentDidMount() {
        this.startFetchingInterval();
    }

    fetchOHQuestions = () => {
        axios
            .get(import.meta.env.VITE_API_URL + '/submissions/getOHquestions', {
                headers: {
                    Authorization: `Bearer ${localStorage.getItem("AUTOTA_AUTH_TOKEN")}`,
                },
            })
            .then((res) => {
                const formattedQuestions: OHQuestion[] = res.data.map((item: any[]) => ({
                    Question_id: item[0],
                    question: item[1],
                    question_time: item[2],
                    Student_name: item[3],
                    ruled: item[4],
                    // item[5] was project_id (removed)
                    class_id: item[6],
                    submission_id: item[7],
                }));
                this.setState({ Student_questions: formattedQuestions });
            })
            .catch((err) => {
                console.log(err);
            });
    };

    handleComplete = (id: number) => (e: any) => {
        axios
            .get(import.meta.env.VITE_API_URL + `/submissions/dismissOHQuestion?question_id=${id}`, {
                headers: {
                    Authorization: `Bearer ${localStorage.getItem("AUTOTA_AUTH_TOKEN")}`,
                },
            })
            .then((res) => {
                this.fetchOHQuestions();
            })
            .catch((err) => {
                console.log(err);
            });
    };

    handleRuling(id: number, ruling: number) {
        axios
            .get(import.meta.env.VITE_API_URL + `/submissions/submitOHQuestionRuling?question_id=${id}&ruling=${ruling}`, {
                headers: {
                    Authorization: `Bearer ${localStorage.getItem("AUTOTA_AUTH_TOKEN")}`,
                },
            })
            .then((res) => {
                this.fetchOHQuestions();
            })
            .catch((err) => {
                console.log(err);
            });
    }

    calculateTimeDifference = (questionTime: string) => {
        const currentTime = new Date();
        const questionTimestamp = new Date(questionTime).getTime();
        const timeDifferenceInMilliseconds = currentTime.getTime() - questionTimestamp;
        const timeDifferenceInMinutes = Math.floor(timeDifferenceInMilliseconds / (1000 * 60));
        return timeDifferenceInMinutes;
    };

    startFetchingInterval() {
        this.fetchOHQuestions();
        setInterval(this.fetchOHQuestions, 300000); // 5 minutes
    }

    render() {
        const { Student_questions } = this.state;

        return (
            <div className="oh-page">
                <>
                    <div className="title-row-oh">
                        <h1 className="oh-title">Office Hour Queue</h1>
                    </div>

                    <table border={1} className="question-queue-table">
                        <thead className="table-head">
                            <tr className="head-row">
                                <th className="col-position">Queue</th>
                                <th className="col-student">Student Name</th>
                                <th className="col-question">Question</th>
                                <th className="col-wait">Time in Queue</th>
                                <th className="col-feedback">Decision</th>
                                <th className="col-code">Student Code</th>
                                <th className="col-complete">Complete</th>
                            </tr>
                        </thead>

                        <tbody className="table-body">
                            {Student_questions.map((item: OHQuestion, index) => (
                                <tr key={item.Question_id} className="data-row">
                                    <td className="cell-position">{index + 1}</td>
                                    <td className="cell-student">{item.Student_name}</td>
                                    <td className="cell-question">{item.question}</td>
                                    <td className="cell-wait">
                                        {"In queue for " + this.calculateTimeDifference(item.question_time)} minutes
                                    </td>

                                    <td className="cell-feedback">
                                        {item.ruled === -1 ? (
                                            <div className="feedback-actions">
                                                <button
                                                    className="button button-reject"
                                                    onClick={() => this.handleRuling(item.Question_id, 0)}
                                                >
                                                    Reject
                                                </button>
                                                <button
                                                    className="button button-accept"
                                                    onClick={() => this.handleRuling(item.Question_id, 1)}
                                                >
                                                    Accept
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="feedback-actions is-disabled">
                                                <button className="button button-reject" disabled>
                                                    Reject
                                                </button>
                                                <button className="button button-accept" disabled>
                                                    Accept
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
                                                    View
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
                                            <button className="button button-view-code" disabled>
                                                View
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
                                                    Completed
                                                </button>
                                            </div>
                                        ) : (
                                            <button
                                                className="button button-completed"
                                                onClick={this.handleComplete(item.Question_id)}
                                            >
                                                Completed
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </>
            </div>
        );
    }
}

export default TaComponent;