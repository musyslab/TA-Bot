import { useEffect, useState } from 'react'
import 'semantic-ui-css/semantic.min.css'
import { Button, Form, Grid, Segment, Dimmer, Header, Icon, Table, Message } from 'semantic-ui-react'
import axios from 'axios'
import MenuComponent from '../components/MenuComponent'
import React from 'react'
import { SemanticCOLORS } from 'semantic-ui-react'
import ErrorMessage from '../components/ErrorMessage'
import Countdown from 'react-countdown'
import { Helmet } from 'react-helmet'
import { useParams } from 'react-router-dom'
import '../css/UploadPage.scss'
import '../css/FileUploadCommon.scss'

interface UploadProps {
    class_id?: string
}

interface UploadPageState {
    file?: File,
    color: SemanticCOLORS,
    isLoading: boolean
    error_message: string,
    isErrorMessageHidden: boolean,
    project_name: string,
    project_id: number,
    canRedeem: boolean,
    points: number
    time_until_next_submission: string,
    is_allowed_to_submit: boolean,
    hasScoreEnabled: boolean,
    hasUnlockEnabled: boolean,

}

const UploadPage = () => {
    const { class_id } = useParams();
    let cid = -1;
    if (class_id !== undefined) {
        cid = parseInt(class_id, 10);
    }
    const [files, setFiles] = useState<File[]>([]);
    const [mainJavaFileName, setMainJavaFileName] = useState<string>("");
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error_message, setError_Message] = useState<string>("");
    const [isErrorMessageHidden, setIsErrorMessageHidden] = useState<boolean>(true);
    const [project_id, setProject_id] = useState<number>(0);
    const [time_until_next_submission, setTime_Until_Next_Submission] = useState<string>("");
    const [is_allowed_to_submit, setIs_Allowed_To_Submit] = useState<boolean>(true);
    const [hasTbsEnabled, setHasTbsEnabled] = useState<boolean>(false);
    const [tbstime, setTbsTime] = useState<string>("");
    const [DaysSinceProjectStarted, setDaysSinceProjectStarted] = useState<number>(0);
    const [TimeUntilNextSubmission, setTimeUntilNextSubmission] = useState<string>("");
    const [suggestions, setSuggestions] = useState<string>("");
    const [baseCharge, setBaseCharge] = useState<number>(0);
    const [RewardCharge, setRewardCharge] = useState<number>(0);
    const [HoursUntilRecharge, setHoursUntilRecharge] = useState<number>(0);
    const [MinutesUntilRecharge, setMinutesUntilRecharge] = useState<number>(0);
    const [SecondsUntilRecharge, setSecondsUntilRecharge] = useState<number>(0);
    const [RewardState, setRewardState] = useState<boolean>(false);
    const [displayClock, setDisplayClock] = useState<boolean>(false);
    const [inOfficeHours, setInOfficeHours] = useState<boolean>(false);

    const [project_name, setProject_name] = useState<string>("");
    const [dueDate, setDueDate] = useState<string>("");
    const canSubmit = inOfficeHours || (baseCharge > 0) || RewardState;

    // Allowed upload file extensions (frontend gate)
    const ALLOWED_EXTS = ['.py', '.java', '.c', '.rkt'];
    const isJavaFile = (f: File) => f.name.toLowerCase().endsWith('.java');
    const isJavaFileName = (n: string) => /\.java$/i.test(n);
    const isAllowedFileName = (name: string) => {
        const ext = '.' + (name.split('.').pop() || '').toLowerCase();
        return ALLOWED_EXTS.includes(ext);
    };

    // Detect entry point when multiple .java files are uploaded
    const JAVA_MAIN_RE = /\bpublic\s+static\s+void\s+main\s*\(/;
    function pickMainJavaFile(allJavaNames: string[], namesWithMain: string[]): string {
        if (namesWithMain.length === 1) return namesWithMain[0];
        const mainDotJava = allJavaNames.find(n => n.toLowerCase() === "main.java");
        if (mainDotJava) return mainDotJava;
        return namesWithMain[0] || "";
    }
    async function computeMainJavaFromLocal(localFiles: File[]) {
        const javaFiles = localFiles.filter(f => isJavaFileName(f.name));
        if (javaFiles.length <= 1) { setMainJavaFileName(""); return; }
        const withMain: string[] = [];
        for (const f of javaFiles) {
            try {
                const txt = await f.text();
                if (JAVA_MAIN_RE.test(txt)) withMain.push(f.name);
            } catch {
                // ignore read failures
            }
        }
        setMainJavaFileName(pickMainJavaFile(javaFiles.map(f => f.name), withMain));
    }

    useEffect(() => {
        let cancelled = false;
        (async () => {
            if (!(files.length > 1 && files.every(isJavaFile))) {
                if (!cancelled) setMainJavaFileName("");
                return;
            }
            await computeMainJavaFromLocal(files);
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [files]);

    let activeDay: number;
    if (project_name !== "") {
        activeDay = Math.min(Math.max(DaysSinceProjectStarted, 1), 6);
    } else {
        activeDay = 0;
    }


    useEffect(() => {
        // First: load submission details (including project_name)
        getSubmissionDetails();
    }, []);

    // Once project_name has been set, *then* fetch charges
    useEffect(() => {
        if (project_name) {
            getCharges();
        }
    }, [project_name]);

    function checkOfficeHours() {
        // Show banner only if there is an ACCEPTED (ruling==1, not dismissed)
        // OH entry for THIS class (via its current project).
        axios.get(
            `${import.meta.env.VITE_API_URL}/submissions/getAcceptedOHForClass?class_id=${class_id}`,
            { headers: { 'Authorization': `Bearer ${localStorage.getItem("AUTOTA_AUTH_TOKEN")}` } }
        )
            .then(res => {
                // API returns the accepted question id or -1
                const raw = (typeof res.data === 'object' && res.data !== null)
                    ? (res.data.id ?? res.data.qid ?? res.data.value ?? res.data)
                    : res.data;
                const id = Number(raw);
                setInOfficeHours(Number.isFinite(id) && id > 0);
            })
            .catch(err => {
                console.error("Error checking office hours:", err);
                setInOfficeHours(false);
            });
    }

    useEffect(() => {
        checkOfficeHours();
    }, []);

    function handleFileChange(event: React.FormEvent) {
        const target = event.target as HTMLInputElement;
        const selected = target.files ? Array.from(target.files) : [];
        const valid = selected.filter(f => isAllowedFileName(f.name));
        if (selected.length && valid.length === 0) {
            setError_Message("Only .py, .java, .c, or .rkt files are allowed.");
            setIsErrorMessageHidden(false);
        }
        // Multi-file is only allowed for Java (.java)
        if (valid.length > 1 && !valid.every(isJavaFile)) {
            setFiles([]);
            setError_Message("Multi-file upload is only available for Java (.java) files.");
            setIsErrorMessageHidden(false);
            return;
        }
        setIsErrorMessageHidden(true);
        setFiles(valid);
    };

    function getCharges() {
        axios.get(import.meta.env.VITE_API_URL + `/submissions/GetCharges?class_id=${class_id}`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem("AUTOTA_AUTH_TOKEN")}`
            }
        })
            .then(res => {
                setBaseCharge(res.data.baseCharge);
                setRewardCharge(res.data.rewardCharge);
                setHoursUntilRecharge(+res.data.HoursUntilRecharge);
                setMinutesUntilRecharge(+res.data.MinutesUntilRecharge);
                setSecondsUntilRecharge(+res.data.SecondsUntilRecharge);
                setDisplayClock(
                    !(+res.data.HoursUntilRecharge === 0 &&
                        +res.data.MinutesUntilRecharge === 0 &&
                        +res.data.SecondsUntilRecharge === 0)
                );
            })
            .catch(err => {
                if (err.response?.status === 404) {
                    // no active project → zero everything out
                    setBaseCharge(0);
                    setRewardCharge(0);
                    setHoursUntilRecharge(0);
                    setMinutesUntilRecharge(0);
                    setSecondsUntilRecharge(0);
                    setDisplayClock(false);
                } else {
                    console.error("Error fetching charges:", err);
                }
            });
    }

    function getSubmissionDetails() {
        axios.get(import.meta.env.VITE_API_URL + `/submissions/GetSubmissionDetails?class_id=${class_id}`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem("AUTOTA_AUTH_TOKEN")}`
            }
        }).then(res => {
            setTbsTime(res.data[0]);
            setDaysSinceProjectStarted(parseInt(res.data[1], 10) + 1);
            setTimeUntilNextSubmission(res.data[2]);
            setProject_name(res.data[3]);
            setDueDate(res.data[4]);
            setProject_id(Number(res.data[5] || 0));
        })
    }

    const downloadAssignment = (pid: number) => {
        if (!pid || pid <= 0) return;
        axios.get(
            `${import.meta.env.VITE_API_URL}/projects/getAssignmentDescription?project_id=${pid}`,
            {
                headers: { Authorization: `Bearer ${localStorage.getItem("AUTOTA_AUTH_TOKEN")}` },
                responseType: "blob",
            }
        ).then((res) => {
            const type = (res.headers as any)["content-type"] || "application/octet-stream";
            const blob = new Blob([res.data], { type });
            // Prefer server-exposed filename, fallback to generic
            let name = (res.headers as any)["x-filename"] || "assignment_description";
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = name;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        }).catch(err => console.error("Download failed:", err));
    };

    function submitSuggestions() {
        axios.post(import.meta.env.VITE_API_URL + `/submissions/submit_suggestion`,
            {
                "suggestion": suggestions
            },
            {
                headers:
                {
                    'Authorization': `Bearer ${localStorage.getItem("AUTOTA_AUTH_TOKEN")}`
                }
            }
        ).then(res => {
            alert("Thank you for your constructive feedback, if you have any other suggestions please feel free to submit them.");
        }, (error) => {
            alert("There was an error submitting your feedback. Please try again later.");
        })
    }

    function onTimerFinish() {
        window.location.reload();
    }

    function officeHoursPage() {
        window.location.href = "/class/OfficeHours/" + class_id;
    }

    function handleSubmit() {
        // Block submits when there are no usable charges
        if (!canSubmit) {
            alert(
                "You’re out of charges.\n\n" +
                "Please wait until your energy recharges (see countdown), " +
                "or use a FastPass charge first to submit now."
            );
            return;
        }

        // Make sure at least one file is selected
        if (files.length === 0) {
            setError_Message("Please select a file to upload.");
            setIsErrorMessageHidden(false);
            return;
        }

        // Enforce multi-file restriction at submit time too
        if (files.length > 1 && !files.every(isJavaFile)) {
            setError_Message("Multi-file upload is only available for Java (.java) files.");
            setIsErrorMessageHidden(false);
            return;
        }
        // Validate extensions again at submit time (belt & suspenders)
        if (files.some(f => !isAllowedFileName(f.name))) {
            setError_Message("Only .py, .java, .c, or .rkt files are allowed.");
            setIsErrorMessageHidden(false);
            return;
        }

        setIsErrorMessageHidden(true);
        setIsLoading(true);

        const formData = new FormData();
        files.forEach(f => formData.append("files", f, f.name));
        formData.append("class_id", cid.toString());

        axios.post(
            `${import.meta.env.VITE_API_URL}/upload/`,
            formData,
            {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem("AUTOTA_AUTH_TOKEN")}`
                }
            }
        )
            .then(res => {
                const sid = (res?.data && (res.data.sid ?? res.data.Sid ?? res.data.id)) as number | string | undefined;
                if (sid !== undefined && class_id !== undefined) {
                    window.location.href = `/class/${class_id}/code/${sid}`;
                } else if (class_id !== undefined) {
                    window.location.href = `/class/${class_id}/code`;
                } else {
                    window.location.href = "code";
                }
            })
            .catch(err => {
                setError_Message(err.response?.data?.message || "Upload failed.");
                setIsErrorMessageHidden(false);
                setIsLoading(false);
            });
    }
    function consumeRewardCharge() {
        if (RewardCharge == 0) {
            alert("You don't have any reward charges to use");
            return;
        }
        axios.get(import.meta.env.VITE_API_URL + `/submissions/ConsumeCharge?class_id=${class_id}`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem("AUTOTA_AUTH_TOKEN")}`
            }
        })
            .then(res => {
                setRewardState(true);
            })
            .catch(err => {

            })
    }

    // code => code icon, text => two-line text icon, otherwise => alternate icon
    const CODE_ICON_RE = /\.(py|java|c|h|rkt|scm|cpp)$/i;
    const TEXT_ICON_RE = /\.(txt|md|pdf|doc|docx)$/i;

    const getFileIcon = (filename: string) => {
        if (CODE_ICON_RE.test(filename)) return 'code';
        if (TEXT_ICON_RE.test(filename)) return 'align justify';
        return 'x icon';
    };

    const pulseAnimation = `
@keyframes pulse {
  0% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.05);
    opacity: 0.85;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}
`;


    return (
        <div className="upload-page">
            <Helmet>
                <title>TA-Bot</title>
            </Helmet>
            <MenuComponent
                showAdminUpload={false}
                showUpload={false}
                showHelp={false}
                showCreate={false}
                showLast={true}
                showReviewButton={false}
                showForum={true}
            />

            <Grid textAlign="center" verticalAlign="middle" className="upload-grid">
                <Grid.Column computer={8} tablet={12} mobile={16}>
                    <Form loading={isLoading} size="large" onSubmit={handleSubmit} disabled={!is_allowed_to_submit}>
                        <div className="project-header">
                            {project_name ? (
                                <>
                                    <h1 className="project-title">
                                        {project_name.replace(/_/g, " ")}
                                    </h1>
                                    {dueDate && (
                                        <p className="due-date">
                                            Due: {new Date(dueDate).toLocaleString(undefined, {
                                                year: 'numeric',
                                                month: '2-digit',
                                                day: '2-digit',
                                                hour: '2-digit',
                                                minute: '2-digit'
                                            })}
                                        </p>
                                    )}
                                    <button
                                        type="button"
                                        className="assignment-link"
                                        onClick={() => downloadAssignment(project_id)}
                                        disabled={!project_id || project_id <= 0}
                                        aria-label="Download assignment description"
                                    >
                                        <Icon name="download" />
                                        <span>Download Assignment Instructions</span>
                                    </button>
                                </>
                            ) : (
                                <h1>No Active Project</h1>
                            )}
                        </div>

                        {inOfficeHours && (
                            <Message positive icon className="oh-banner">
                                <Icon name="handshake outline" />
                                <Message.Content>
                                    <Message.Header>You're in Office Hours</Message.Header>
                                    Submissions will not consume energy while this is active.
                                </Message.Content>
                            </Message>
                        )}

                        <Dimmer.Dimmable dimmed={true}>
                            <Segment stacked className="upload-segment">
                                <div className="base-charge">
                                    {[1, 2, 3].map(level => (
                                        <div
                                            key={level}
                                            className={
                                                `base-charge-dot ${baseCharge >= level ? 'filled' : ''} ${baseCharge === level - 1 ? 'breathing' : ''
                                                }`
                                            }
                                        />
                                    ))}
                                </div>

                                <Segment stacked className="info-segment">
                                    <h1 className="info-title">Upload Assignment</h1>
                                    <Form.Field>
                                        <div
                                            className="file-drop-area"
                                            onDragOver={e => e.preventDefault()}
                                            onDrop={e => {
                                                e.preventDefault();
                                                const dropped = Array.from(e.dataTransfer.files || []);
                                                const valid = dropped.filter(f => isAllowedFileName(f.name));
                                                if (dropped.length && valid.length === 0) {
                                                    setError_Message("Only .py, .java, .c, or .rkt files are allowed.");
                                                    setIsErrorMessageHidden(false);
                                                    return;
                                                }
                                                // Multi-file is only allowed for Java (.java)
                                                if (valid.length > 1 && !valid.every(isJavaFile)) {
                                                    setFiles([]);
                                                    setError_Message("Multi-file upload is only available for Java (.java) files.");
                                                    setIsErrorMessageHidden(false);
                                                    return;
                                                }
                                                setIsErrorMessageHidden(true);
                                                setFiles(valid);
                                            }}
                                        >
                                            {!files.length ? (
                                                <>
                                                    <input
                                                        type="file"
                                                        className="file-input"
                                                        accept=".py,.java,.c,.rkt"
                                                        multiple
                                                        onChange={handleFileChange}
                                                    />
                                                    <div className="file-drop-message">
                                                        <Icon name="cloud upload" size="huge" />
                                                        <p>
                                                            Drag &amp; drop your file(s) here or&nbsp;
                                                            <span className="browse-text">browse</span>
                                                        </p>
                                                    </div>
                                                </>
                                            ) : (
                                                <div className="file-preview">
                                                    <button
                                                        type="button"
                                                        className="exchange-icon"
                                                        aria-label="Clear selected files"
                                                        title="Clear selected files"
                                                        onClick={() => setFiles([])}
                                                    >
                                                        <Icon name="exchange" aria-hidden="true" />
                                                    </button>

                                                    <div className="file-preview-list" title="Selected files">
                                                        {files.map((f) => (
                                                            <div key={f.name} className="file-preview-row solution-file-card">
                                                                <div className="file-icon-wrapper" aria-hidden="true">
                                                                    <Icon name="file outline" className="file-outline-icon" />
                                                                    <Icon name={getFileIcon(f.name)} className="file-language-icon" />
                                                                </div>
                                                                <span className="file-name">
                                                                    {f.name}
                                                                    {files.length > 1 && files.every(isJavaFile) && mainJavaFileName && f.name === mainJavaFileName && (
                                                                        <span className="main-indicator">Main</span>
                                                                    )}
                                                                </span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </Form.Field>

                                    <Button
                                        type="submit"
                                        disabled={!is_allowed_to_submit || !canSubmit}
                                        fluid
                                        size="large"
                                        className={
                                            `upload-button ${(!is_allowed_to_submit || !canSubmit) ? 'disabled' : ''} ${RewardState ? 'reward' : ''
                                            }`
                                        }
                                    >
                                        Upload
                                    </Button>

                                    <button
                                        type="button"
                                        onClick={consumeRewardCharge}
                                        disabled={RewardCharge <= 0}
                                        className="fastpass-button"
                                    >
                                        Use FastPass Charge
                                    </button>
                                </Segment>

                                <div className="upload-segment__spacer" />

                                <div className="reward-charge">
                                    {[1, 2, 3, 4, 5].map(level => (
                                        <div
                                            key={level}
                                            className={`dot ${RewardCharge >= level ? 'filled' : ''}`}
                                        />
                                    ))}
                                </div>
                            </Segment>

                            <Dimmer active={project_id === -1}>
                                <Header as='h2' icon inverted>
                                    <Icon name='ban' />
                                    No active project
                                </Header>
                            </Dimmer>
                        </Dimmer.Dimmable>
                    </Form>

                    <div className="countdown-wrapper">
                        {displayClock && (
                            <Countdown
                                date={
                                    new Date(
                                        new Date().getTime() +
                                        HoursUntilRecharge * 3600000 +
                                        MinutesUntilRecharge * 60000 +
                                        SecondsUntilRecharge * 1000
                                    )
                                }
                                intervalDelay={1000}
                                precision={2}
                                renderer={({ hours, minutes, seconds, completed }) => (
                                    <div className={`countdown-display ${completed ? 'completed' : ''}`}>
                                        {`${hours} hours, ${minutes} minutes, ${seconds} seconds`} {' until '}
                                        <span className="dot" /> full recharge
                                    </div>
                                )}
                            />
                        )}

                        <ErrorMessage message={error_message} isHidden={isErrorMessageHidden} />

                        {/* 1) TABLE now appears where the Office Hours button used to be */}
                        <Table definition unstackable className="status-table">
                            <Table.Header>
                                <Table.Row>
                                    <Table.Cell>
                                        <div className="flex-center">
                                            <div className="ml-10">Days Since Project Start</div>
                                        </div>
                                    </Table.Cell>
                                    {[1, 2, 3, 4, 5, 6].map((day) => (
                                        <Table.HeaderCell
                                            key={day}
                                            className={`header-cell day-${day}` + (day === activeDay ? ' active-day' : '')}
                                        >
                                            {`Day ${day}${day === 6 ? '+' : ''}`}
                                        </Table.HeaderCell>
                                    ))}
                                </Table.Row>
                            </Table.Header>

                            <Table.Body>
                                <Table.Row>
                                    <Table.Cell>
                                        <div className="flex-center">
                                            <div className="ml-10">Recharge Time</div>
                                        </div>
                                    </Table.Cell>
                                    {['15 mins', '45 mins', '2.25 hrs', '3 hrs', '4.5 hrs', '6 hrs'].map((time, idx) => {
                                        const day = idx + 1;
                                        return (
                                            <Table.Cell
                                                key={time}
                                                className={'recharge-cell' + (day === activeDay ? ' active-day' : '')}
                                            >
                                                {time}
                                            </Table.Cell>
                                        );
                                    })}
                                </Table.Row>
                            </Table.Body>
                        </Table>

                        {/* Info text stays above the button */}
                        <div className="info-text">
                            <span>
                                Each submission uses an energy charge<span className="info-dot" />.
                                When the recharge timer hits zero, your energy refills to full (3 charges) all at once,
                                as shown in the table above.
                            </span>
                            <span>
                                <span className="highlight-red">Attending office hours</span> will award you{' '}
                                <span className="highlight-red">two</span>
                                <span className="info-dot purple" />"FastPass" charges which can be redeemed at any time to
                                submit even when you are out of base energy.
                            </span>
                        </div>
                    </div>

                    <Form>
                        <p className="feedback-paragraph">
                            TA-Bot is an assessment system developed by Marquette students. We welcome constructive feedback throughout the semester. The TA-Bot team will strive to implement your suggestions. For more information, please see our{' '}
                            <a href="https://docs.google.com/document/d/1af1NU6K24drPaiJXFFo4gLD4dqNVivKQ9ZijDMAWyd4/edit?usp=sharing" className="faq-link"> FAQ’s. </a>
                        </p>
                        <Form.TextArea
                            placeholder="example: TA-Bot struggles when dealing with small issues in Test cases"
                            value={suggestions}
                            onChange={(e, { value }) => setSuggestions(value as string)}
                            className="feedback-textarea"
                        />
                        <Button
                            onClick={submitSuggestions}
                            type='submit'
                            className="feedback-button"
                        >
                            Submit Feedback
                        </Button>
                    </Form>

                    {hasTbsEnabled && project_id !== -1 && !is_allowed_to_submit && (
                        <>
                            <Icon name="clock outline" />
                            <Countdown date={new Date(time_until_next_submission)} onComplete={onTimerFinish} />
                        </>
                    )}
                </Grid.Column>
            </Grid>
        </div>
    );
};

export default UploadPage;