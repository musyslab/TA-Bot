import React, { useEffect, useState } from 'react'
import axios from 'axios'
import MenuComponent from '../components/MenuComponent'
import ErrorMessage from '../components/ErrorMessage'
import Countdown from 'react-countdown'
import { Helmet } from 'react-helmet'
import { useParams } from 'react-router-dom'
import DirectoryBreadcrumbs from "../components/DirectoryBreadcrumbs";
import '../../styling/StudentUpload.scss'
import '../../styling/FileUploadCommon.scss'

import {
  FaAlignJustify,
  FaBan,
  FaClock,
  FaCloudUploadAlt,
  FaCode,
  FaDownload,
  FaExchangeAlt,
  FaHandshake,
  FaRegFile,
  FaTimesCircle,
} from 'react-icons/fa'

const StudentUpload = () => {
  const { class_id } = useParams()
  let cid = -1
  if (class_id !== undefined) {
    cid = parseInt(class_id, 10)
  }

  const [files, setFiles] = useState<File[]>([])
  const [mainJavaFileName, setMainJavaFileName] = useState<string>('')

  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [error_message, setError_Message] = useState<string>('')
  const [isErrorMessageHidden, setIsErrorMessageHidden] = useState<boolean>(true)

  const [project_id, setProject_id] = useState<number>(0)
  const [is_allowed_to_submit] = useState<boolean>(true)

  const [hasTbsEnabled] = useState<boolean>(false)
  const [DaysSinceProjectStarted, setDaysSinceProjectStarted] = useState<number>(0)
  const [TimeUntilNextSubmission, setTimeUntilNextSubmission] = useState<string>('')

  const [suggestions, setSuggestions] = useState<string>('')

  const [baseCharge, setBaseCharge] = useState<number>(0)
  const [RewardCharge, setRewardCharge] = useState<number>(0)

  const [HoursUntilRecharge, setHoursUntilRecharge] = useState<number>(0)
  const [MinutesUntilRecharge, setMinutesUntilRecharge] = useState<number>(0)
  const [SecondsUntilRecharge, setSecondsUntilRecharge] = useState<number>(0)

  const [RewardState, setRewardState] = useState<boolean>(false)
  const [displayClock, setDisplayClock] = useState<boolean>(false)
  const [inOfficeHours, setInOfficeHours] = useState<boolean>(false)

  const [project_name, setProject_name] = useState<string>('')
  const [dueDate, setDueDate] = useState<string>('')

  const canSubmit = inOfficeHours || baseCharge > 0 || RewardState

  // Allowed upload file extensions (frontend gate)
  const ALLOWED_EXTS = ['.py', '.java', '.c', '.rkt']
  const isJavaFile = (f: File) => f.name.toLowerCase().endsWith('.java')
  const isJavaFileName = (n: string) => /\.java$/i.test(n)

  const isAllowedFileName = (name: string) => {
    const ext = '.' + (name.split('.').pop() || '').toLowerCase()
    return ALLOWED_EXTS.includes(ext)
  }

  // Detect entry point when multiple .java files are uploaded
  const JAVA_MAIN_RE = /\bpublic\s+static\s+void\s+main\s*\(/
  function pickMainJavaFile(allJavaNames: string[], namesWithMain: string[]): string {
    if (namesWithMain.length === 1) return namesWithMain[0]
    const mainDotJava = allJavaNames.find((n) => n.toLowerCase() === 'main.java')
    if (mainDotJava) return mainDotJava
    return namesWithMain[0] || ''
  }

  async function computeMainJavaFromLocal(localFiles: File[]) {
    const javaFiles = localFiles.filter((f) => isJavaFileName(f.name))
    if (javaFiles.length <= 1) {
      setMainJavaFileName('')
      return
    }

    const withMain: string[] = []
    for (const f of javaFiles) {
      try {
        const txt = await f.text()
        if (JAVA_MAIN_RE.test(txt)) withMain.push(f.name)
      } catch {
        // ignore read failures
      }
    }
    setMainJavaFileName(pickMainJavaFile(javaFiles.map((f) => f.name), withMain))
  }

  useEffect(() => {
    let cancelled = false
      ; (async () => {
        if (!(files.length > 1 && files.every(isJavaFile))) {
          if (!cancelled) setMainJavaFileName('')
          return
        }
        await computeMainJavaFromLocal(files)
      })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files])

  const activeDay = project_name !== '' ? Math.min(Math.max(DaysSinceProjectStarted, 1), 6) : 0

  useEffect(() => {
    // First: load submission details (including project_name)
    getSubmissionDetails()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Once project_name has been set, then fetch charges
  useEffect(() => {
    if (project_name) getCharges()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project_name])

  function checkOfficeHours() {
    axios
      .get(`${import.meta.env.VITE_API_URL}/submissions/getAcceptedOHForClass?class_id=${class_id}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}` },
      })
      .then((res) => {
        const raw =
          typeof res.data === 'object' && res.data !== null
            ? (res.data.id ?? res.data.qid ?? res.data.value ?? res.data)
            : res.data
        const id = Number(raw)
        setInOfficeHours(Number.isFinite(id) && id > 0)
      })
      .catch((err) => {
        console.error('Error checking office hours:', err)
        setInOfficeHours(false)
      })
  }

  useEffect(() => {
    checkOfficeHours()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files ? Array.from(event.target.files) : []
    const valid = selected.filter((f) => isAllowedFileName(f.name))

    if (selected.length && valid.length === 0) {
      setError_Message('Only .py, .java, .c, or .rkt files are allowed.')
      setIsErrorMessageHidden(false)
    }

    // Multi-file is only allowed for Java (.java)
    if (valid.length > 1 && !valid.every(isJavaFile)) {
      setFiles([])
      setError_Message('Multi-file upload is only available for Java (.java) files.')
      setIsErrorMessageHidden(false)
      return
    }

    setIsErrorMessageHidden(true)
    setFiles(valid)
  }

  function getCharges() {
    axios
      .get(`${import.meta.env.VITE_API_URL}/submissions/GetCharges?class_id=${class_id}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}` },
      })
      .then((res) => {
        setBaseCharge(res.data.baseCharge)
        setRewardCharge(res.data.rewardCharge)
        setHoursUntilRecharge(+res.data.HoursUntilRecharge)
        setMinutesUntilRecharge(+res.data.MinutesUntilRecharge)
        setSecondsUntilRecharge(+res.data.SecondsUntilRecharge)
        setDisplayClock(
          !(
            +res.data.HoursUntilRecharge === 0 &&
            +res.data.MinutesUntilRecharge === 0 &&
            +res.data.SecondsUntilRecharge === 0
          )
        )
      })
      .catch((err) => {
        if (err.response?.status === 404) {
          // no active project
          setBaseCharge(0)
          setRewardCharge(0)
          setHoursUntilRecharge(0)
          setMinutesUntilRecharge(0)
          setSecondsUntilRecharge(0)
          setDisplayClock(false)
        } else {
          console.error('Error fetching charges:', err)
        }
      })
  }

  function getSubmissionDetails() {
    axios
      .get(`${import.meta.env.VITE_API_URL}/submissions/GetSubmissionDetails?class_id=${class_id}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}` },
      })
      .then((res) => {
        setDaysSinceProjectStarted(parseInt(res.data[1], 10) + 1)
        setTimeUntilNextSubmission(res.data[2])
        setProject_name(res.data[3])
        setDueDate(res.data[4])
        setProject_id(Number(res.data[5] || 0))
      })
  }

  const downloadAssignment = (pid: number) => {
    if (!pid || pid <= 0) return
    axios
      .get(`${import.meta.env.VITE_API_URL}/projects/getAssignmentDescription?project_id=${pid}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}` },
        responseType: 'blob',
      })
      .then((res) => {
        const type = (res.headers as any)['content-type'] || 'application/octet-stream'
        const blob = new Blob([res.data], { type })
        let name = (res.headers as any)['x-filename'] || 'assignment_description'
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

  function submitSuggestions() {
    axios
      .post(
        `${import.meta.env.VITE_API_URL}/submissions/submit_suggestion`,
        { suggestion: suggestions },
        { headers: { Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}` } }
      )
      .then(
        () => {
          alert(
            'Thank you for your constructive feedback, if you have any other suggestions please feel free to submit them.'
          )
        },
        () => {
          alert('There was an error submitting your feedback. Please try again later.')
        }
      )
  }

  function onTimerFinish() {
    window.location.reload()
  }

  function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault()

    // Block submits when there are no usable charges
    if (!canSubmit) {
      alert(
        'You’re out of charges.\n\n' +
        'Please wait until your energy recharges (see countdown), ' +
        'or use a FastPass charge first to submit now.'
      )
      return
    }

    // Make sure at least one file is selected
    if (files.length === 0) {
      setError_Message('Please select a file to upload.')
      setIsErrorMessageHidden(false)
      return
    }

    // Enforce multi-file restriction at submit time too
    if (files.length > 1 && !files.every(isJavaFile)) {
      setError_Message('Multi-file upload is only available for Java (.java) files.')
      setIsErrorMessageHidden(false)
      return
    }

    // Validate extensions again at submit time (belt and suspenders)
    if (files.some((f) => !isAllowedFileName(f.name))) {
      setError_Message('Only .py, .java, .c, or .rkt files are allowed.')
      setIsErrorMessageHidden(false)
      return
    }

    setIsErrorMessageHidden(true)
    setIsLoading(true)

    const formData = new FormData()
    files.forEach((f) => formData.append('files', f, f.name))
    formData.append('class_id', cid.toString())

    axios
      .post(`${import.meta.env.VITE_API_URL}/upload/`, formData, {
        headers: { Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}` },
      })
      .then((res) => {
        const sid = (res?.data && (res.data.sid ?? res.data.Sid ?? res.data.id)) as
          | number
          | string
          | undefined

        if (sid !== undefined && class_id !== undefined) {
          window.location.href = `/student/${class_id}/code/${sid}`
        } else if (class_id !== undefined) {
          window.location.href = `/student/${class_id}/code`
        } else {
          window.location.href = 'code'
        }
      })
      .catch((err) => {
        setError_Message(err.response?.data?.message || 'Upload failed.')
        setIsErrorMessageHidden(false)
        setIsLoading(false)
      })
  }

  function consumeRewardCharge() {
    if (RewardCharge === 0) {
      alert("You don't have any reward charges to use")
      return
    }

    axios
      .get(`${import.meta.env.VITE_API_URL}/submissions/ConsumeCharge?class_id=${class_id}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}` },
      })
      .then(() => setRewardState(true))
      .catch(() => {
        // ignore
      })
  }

  // code => code icon, text => two-line text icon, otherwise => alternate icon
  const CODE_ICON_RE = /\.(py|java|c|h|rkt|scm|cpp)$/i
  const TEXT_ICON_RE = /\.(txt|md|pdf|doc|docx)$/i

  const getFileIcon = (filename: string) => {
    if (CODE_ICON_RE.test(filename)) return <FaCode className="file-language-icon" aria-hidden="true" />
    if (TEXT_ICON_RE.test(filename))
      return <FaAlignJustify className="file-language-icon" aria-hidden="true" />
    return <FaTimesCircle className="file-language-icon" aria-hidden="true" />
  }

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
      />

      <DirectoryBreadcrumbs
        items={[
          { label: "Class Selection", to: "/student/classes" },
          { label: "Project Upload" },
        ]}
      />

      <div className="upload-grid">
        <div className="upload-grid-column">
          <form className={`upload-form ${isLoading ? 'is-loading' : ''}`} onSubmit={handleSubmit}>
            <div className="project-header">
              {project_name ? (
                <>
                  <h1 className="project-title">{project_name.replace(/_/g, ' ')}</h1>

                  {dueDate && (
                    <p className="due-date">
                      Due:{' '}
                      {new Date(dueDate).toLocaleString(undefined, {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
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
                    <FaDownload className="assignment-link__icon" aria-hidden="true" />
                    <span>Download Assignment Instructions</span>
                  </button>
                </>
              ) : (
                <h1>No Active Project</h1>
              )}
            </div>

            {inOfficeHours && (
              <div className="oh-banner" role="status" aria-live="polite">
                <div className="oh-banner__icon" aria-hidden="true">
                  <FaHandshake />
                </div>
                <div className="oh-banner__content">
                  <div className="oh-banner__header">You're in Office Hours</div>
                  <div className="oh-banner__text">
                    Submissions will not consume energy while this is active.
                  </div>
                </div>
              </div>
            )}

            <div className="upload-dimmable">
              <div className="upload-segment">
                <div className="base-charge">
                  {[1, 2, 3].map((level) => (
                    <div
                      key={level}
                      className={
                        `base-charge-dot ${baseCharge >= level ? 'filled' : ''} ` +
                        `${baseCharge === level - 1 ? 'breathing' : ''}`
                      }
                    />
                  ))}
                </div>

                <div className="info-segment">
                  <h1 className="info-title">Upload Assignment</h1>

                  <div className="form-field">
                    <div
                      className="file-drop-area"
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault()
                        const dropped = Array.from(e.dataTransfer.files || [])
                        const valid = dropped.filter((f) => isAllowedFileName(f.name))

                        if (dropped.length && valid.length === 0) {
                          setError_Message('Only .py, .java, .c, or .rkt files are allowed.')
                          setIsErrorMessageHidden(false)
                          return
                        }

                        // Multi-file is only allowed for Java (.java)
                        if (valid.length > 1 && !valid.every(isJavaFile)) {
                          setFiles([])
                          setError_Message('Multi-file upload is only available for Java (.java) files.')
                          setIsErrorMessageHidden(false)
                          return
                        }

                        setIsErrorMessageHidden(true)
                        setFiles(valid)
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
                            <FaCloudUploadAlt className="file-drop-icon" aria-hidden="true" />
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
                            <FaExchangeAlt aria-hidden="true" />
                          </button>

                          <div className="file-preview-list" title="Selected files">
                            {files.map((f) => (
                              <div key={f.name} className="file-preview-row solution-file-card">
                                <div className="file-icon-wrapper" aria-hidden="true">
                                  <FaRegFile className="file-outline-icon" aria-hidden="true" />
                                  {getFileIcon(f.name)}
                                </div>

                                <span className="file-name">
                                  {f.name}
                                  {files.length > 1 &&
                                    files.every(isJavaFile) &&
                                    mainJavaFileName &&
                                    f.name === mainJavaFileName && (
                                      <span className="main-indicator">Main</span>
                                    )}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={!is_allowed_to_submit || !canSubmit}
                    className={
                      `upload-button ${!is_allowed_to_submit || !canSubmit ? 'disabled' : ''} ` +
                      `${RewardState ? 'reward' : ''}`
                    }
                  >
                    Upload
                  </button>

                  <button
                    type="button"
                    onClick={consumeRewardCharge}
                    disabled={RewardCharge <= 0}
                    className="fastpass-button"
                  >
                    Use FastPass Charge
                  </button>
                </div>

                <div className="upload-segment__spacer" />

                <div className="reward-charge">
                  {[1, 2, 3, 4, 5].map((level) => (
                    <div key={level} className={`dot ${RewardCharge >= level ? 'filled' : ''}`} />
                  ))}
                </div>
              </div>

              {project_id === -1 && (
                <div className="no-active-project-overlay" role="alert" aria-live="assertive">
                  <div className="no-active-project-content">
                    <FaBan className="no-active-project-icon" aria-hidden="true" />
                    <h2 className="no-active-project-title">No active project</h2>
                  </div>
                </div>
              )}
            </div>
          </form>

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

            <table className="status-table">
              <thead>
                <tr>
                  <th>
                    <div className="flex-center">
                      <div className="ml-10">Days Since Project Start</div>
                    </div>
                  </th>
                  {[1, 2, 3, 4, 5, 6].map((day) => (
                    <th
                      key={day}
                      className={`header-cell day-${day}${day === activeDay ? ' active-day' : ''}`}
                    >
                      {`Day ${day}${day === 6 ? '+' : ''}`}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                <tr>
                  <td>
                    <div className="flex-center">
                      <div className="ml-10">Recharge Time</div>
                    </div>
                  </td>
                  {['15 mins', '45 mins', '2.25 hrs', '3 hrs', '4.5 hrs', '6 hrs'].map((time, idx) => {
                    const day = idx + 1
                    return (
                      <td key={time} className={`recharge-cell${day === activeDay ? ' active-day' : ''}`}>
                        {time}
                      </td>
                    )
                  })}
                </tr>
              </tbody>
            </table>

            <div className="info-text">
              <span>
                Each submission uses an energy charge<span className="info-dot" />. When the recharge timer
                hits zero, your energy refills to full (3 charges) all at once, as shown in the table above.
              </span>
              <span>
                Attending office hours will award you two<span className="info-dot purple" />
                "FastPass" charges which can be redeemed at any time to submit even when you are out of base energy.
              </span>
            </div>
          </div>

          <form
            className="feedback-form"
            onSubmit={(e) => {
              e.preventDefault()
              submitSuggestions()
            }}
          >
            <p className="feedback-paragraph">
              TA-Bot is an assessment system developed by Marquette students. We welcome constructive feedback
              throughout the semester. The TA-Bot team will strive to implement your suggestions. For more
              information, please see our{' '}
              <a
                href="https://docs.google.com/document/d/1af1NU6K24drPaiJXFFo4gLD4dqNVivKQ9ZijDMAWyd4/edit?usp=sharing"
                className="faq-link"
              >
                FAQ’s.
              </a>
              
            </p>

            <textarea
              placeholder="example: TA-Bot struggles when dealing with small issues in Test cases"
              value={suggestions}
              onChange={(e) => setSuggestions(e.target.value)}
              className="feedback-textarea"
            />

            <button type="submit" className="feedback-button">
              Submit Feedback
            </button>
          </form>

          {hasTbsEnabled && project_id !== -1 && !is_allowed_to_submit && (
            <div className="tbs-countdown">
              <FaClock className="tbs-countdown__icon" aria-hidden="true" />
              <Countdown date={new Date(TimeUntilNextSubmission)} onComplete={onTimerFinish} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default StudentUpload