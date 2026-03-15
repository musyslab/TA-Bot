import React, { useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import MenuComponent from '../components/MenuComponent'
import ErrorMessage from '../components/ErrorMessage'
import LoadingAnimation from '../components/LoadingAnimation'
import Countdown from 'react-countdown'
import { Helmet } from 'react-helmet'
import { useParams, Link } from 'react-router-dom'
import DirectoryBreadcrumbs from '../components/DirectoryBreadcrumbs'
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
  FaBolt,
  FaGift,
  FaExternalLinkAlt,
  FaFlask,
  FaCheckCircle,
} from 'react-icons/fa'

type PracticeProblemLite = {
  id: number
  number?: number
  name?: string
  enabled?: boolean
}

const StudentUpload = () => {
  const { class_id, practice_problem_id } = useParams()
  let cid = -1
  if (class_id !== undefined) {
    cid = parseInt(class_id, 10)
  }

  const practiceProblemId =
    practice_problem_id !== undefined && /^\d+$/.test(practice_problem_id)
      ? parseInt(practice_problem_id, 10)
      : null
  const isPractice = practiceProblemId !== null

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
  const feedbackRef = useRef<HTMLTextAreaElement | null>(null)

  const autoGrowTextarea = (el: HTMLTextAreaElement | null) => {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }

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

  const [passedAllTests, setPassedAllTests] = useState<boolean>(false)
  const [checkedPassedAll, setCheckedPassedAll] = useState<boolean>(false)

  const [practiceProblemLabel, setPracticeProblemLabel] = useState<string>('')

  // Practice-bonus mechanism (UI only for now)
  // In the future this should come from an API (ex: /practice/progress?class_id=...)
  const [practiceSolvedCount, setPracticeSolvedCount] = useState<number>(0) // solved practice problems
  const [practiceTotalCount, setPracticeTotalCount] = useState<number>(0) // total enabled practice problems for this project

  const practiceProgress = useMemo(() => {
    const solved = Math.max(0, practiceSolvedCount)
    const total = Math.max(0, practiceTotalCount)
    const clampedSolved = total > 0 ? Math.min(solved, total) : solved
    const earned = clampedSolved // 1 solved practice problem => 1 bonus FastPass
    const pct = total === 0 ? 0 : Math.round((clampedSolved / total) * 100)
    return { total, solved: clampedSolved, earned, pct }
  }, [practiceSolvedCount, practiceTotalCount])

  // you can submit if you are in office hours OR you have base energy OR you used a FastPass charge
  const canSubmit = isPractice || inOfficeHours || baseCharge > 0 || RewardState

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

  useEffect(() => {
    autoGrowTextarea(feedbackRef.current)
  }, [suggestions])

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

  useEffect(() => {
    // Reset if there's no active project
    if (!project_id || project_id <= 0) {
      setPassedAllTests(false)
      setCheckedPassedAll(true)
      return
    }
    if (project_id === -1) {
      setPassedAllTests(false)
      setCheckedPassedAll(true)
      return
    }

    setCheckedPassedAll(false)

    const qs =
      isPractice && practiceProblemId
        ? `&practice=1&practice_problem_id=${practiceProblemId}`
        : ''

    axios
      .get(
        `${import.meta.env.VITE_API_URL}/submissions/testcaseerrors?class_id=${cid}&id=${project_id}${qs}`,
        { headers: { Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}` } }
      )
      .then((res) => {
        let payload: any = res?.data
        if (typeof payload === 'string') {
          try {
            payload = JSON.parse(payload)
          } catch {
            payload = {}
          }
        }

        const results = Array.isArray(payload?.results) ? payload.results : []
        const allPassed =
          results.length > 0 &&
          results.every((r: any) => {
            const v = r?.passed ?? r?.ok ?? r?.State
            return v === true
          })

        setPassedAllTests(allPassed)
        setCheckedPassedAll(true)
      })
      .catch(() => {
        setPassedAllTests(false)
        setCheckedPassedAll(true)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project_id, isPractice, practiceProblemId])

  useEffect(() => {
    if (passedAllTests) {
      setFiles([])
      setIsErrorMessageHidden(true)
      setError_Message('')
    }
  }, [passedAllTests])

  useEffect(() => {
    if (!isPractice || !practiceProblemId || !project_id || project_id <= 0) {
      setPracticeProblemLabel('')
      return
    }

    axios
      .get(
        `${import.meta.env.VITE_API_URL}/projects/list_practice_problems_student?project_id=${project_id}`,
        { headers: { Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}` } }
      )
      .then((res) => {
        const probs = (res?.data?.problems ?? []) as PracticeProblemLite[]
        const found = Array.isArray(probs)
          ? probs.find((p) => Number(p?.id) === practiceProblemId)
          : undefined

        const n = Number(found?.number ?? practiceProblemId)
        const left = n ? `Practice ${n}` : 'Practice'
        const name = String(found?.name || (n ? `Practice Problem ${n}` : 'Practice Problem'))
        setPracticeProblemLabel(`${left}: ${name}`)
      })
      .catch(() => {
        setPracticeProblemLabel(`Practice ${practiceProblemId}: Practice Problem ${practiceProblemId}`)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPractice, practiceProblemId, project_id])

  useEffect(() => {
    if (!project_id || project_id <= 0) {
      setPracticeTotalCount(0)
      setPracticeSolvedCount(0)
      return
    }

    axios
      .get(
        `${import.meta.env.VITE_API_URL}/projects/list_practice_problems_student?project_id=${project_id}`,
        { headers: { Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}` } }
      )
      .then((res) => {
        const probs = (res?.data?.problems ?? []) as (PracticeProblemLite & { solved?: boolean; rewarded?: boolean })[]
        const arr = Array.isArray(probs) ? probs : []
        setPracticeTotalCount(arr.length)
        // progress bar tracks awarded bonuses (fallback to solved if needed)
        setPracticeSolvedCount(arr.filter((p) => Boolean(p?.rewarded ?? p?.solved)).length)
      })
      .catch(() => {
        setPracticeTotalCount(0)
        setPracticeSolvedCount(0)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project_id])

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
    if (passedAllTests) {
      setFiles([])
      setError_Message('')
      setIsErrorMessageHidden(true)
      return
    }

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
    const qs = isPractice && practiceProblemId ? `&practice_problem_id=${practiceProblemId}` : ''
    axios
      .get(`${import.meta.env.VITE_API_URL}/projects/getAssignmentDescription?project_id=${pid}${qs}`, {
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
            'Thank you for your constructive feedback. If you have any other suggestions, please submit them.'
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

    if (passedAllTests) {
      return
    }

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

    // Validate extensions again at submit time
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

    if (isPractice) {
      if (!practiceProblemId) {
        setError_Message('Missing practice problem id.')
        setIsErrorMessageHidden(false)
        setIsLoading(false)
        return
      }
      formData.append('practice', 'true')
      formData.append('practice_problem_id', String(practiceProblemId))
    }

    axios
      .post(`${import.meta.env.VITE_API_URL}/upload/`, formData, {
        headers: { Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}` },
      })
      .then((res) => {
        const sid = (res?.data && (res.data.sid ?? res.data.Sid ?? res.data.id)) as
          | number
          | string
          | undefined

        const qs =
          isPractice && practiceProblemId ? `?practice=1&practice_problem_id=${practiceProblemId}` : ''


        if (sid !== undefined && class_id !== undefined) {
          window.location.href = `/student/${class_id}/code/${sid}${qs}`
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

    if (passedAllTests) {
      return
    }

    if (isPractice) {
      // Practice submissions are free; don't allow reserving a FastPass here.
      return
    }

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

  const practiceHref = `/student/${class_id}/practice`

  const breadcrumbsItems = useMemo(() => {
    if (isPractice) {
      return [
        { label: 'Class Selection', to: '/student/classes' },
        { label: 'Project Upload', to: `/student/${class_id}/upload` },
        { label: 'Practice Select', to: `/student/${class_id}/practice` },
        { label: 'Practice Upload' },
      ]
    }
    return [{ label: 'Class Selection', to: '/student/classes' }, { label: 'Project Upload' }]
  }, [class_id, isPractice])

  const pageTitle = useMemo(() => {
    if (isPractice) {
      return (
        practiceProblemLabel ||
        (practiceProblemId ? `Practice ${practiceProblemId}: Practice Problem ${practiceProblemId}` : '')
      )
    }
    return project_name ? project_name.replace(/_/g, ' ') : ''
  }, [isPractice, practiceProblemLabel, practiceProblemId, project_name])

  const formattedDue = useMemo(() => {
    if (!dueDate) return ''
    try {
      return new Date(dueDate).toLocaleString(undefined, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    } catch {
      return dueDate
    }
  }, [dueDate])

  const resultsQs =
    isPractice && practiceProblemId ? `?practice=1&practice_problem_id=${practiceProblemId}` : ''
  const resultsHref = `/student/${class_id}/code/${project_id}${resultsQs}`

  return (
    <div className="student-upload-page">
      <LoadingAnimation show={isLoading} message="Uploading..." />
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
        items={breadcrumbsItems}
      />

      <div className="student-upload-shell">
        {/* LEFT: Upload panel */}
        <section className="panel panel-upload" aria-label="Upload Assignment">
          <header className="panel-header">
            {pageTitle ? (
              <>
                <div className="panel-header__titleCol">
                  <h1 className="panel-title panel-title--project">
                    {pageTitle}
                  </h1>

                  <button
                    type="button"
                    className="assignment-download"
                    onClick={() => downloadAssignment(project_id)}
                    disabled={!project_id || project_id <= 0}
                    aria-label="Download assignment description"
                    title="Download assignment instructions"
                  >
                    <FaDownload aria-hidden="true" />
                    <span>Instructions</span>
                  </button>
                </div>

                {formattedDue && (
                  <div className="panel-subtitle">
                    <span className="due-pill">Due: {formattedDue}</span>
                  </div>
                )}
              </>
            ) : (
              <div className="panel-header__titleCol">
                <h1 className="panel-title panel-title--project">No Active Project</h1>
              </div>
            )}
          </header>

          {inOfficeHours && (
            <div className="oh-banner" role="status" aria-live="polite">
              <div className="oh-banner__content">
                <div className="oh-banner__header">
                  You&apos;re in Office Hours
                  <FaHandshake className="oh-banner__header-icon" aria-hidden="true" />
                </div>
                <div className="oh-banner__text">Submissions will not consume energy while this is active.</div>
              </div>
            </div>
          )}

          <form className={`upload-form ${isLoading ? 'is-loading' : ''}`} onSubmit={handleSubmit}>
            <div className="dropzone">
              <div
                className="file-drop-area"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  if (passedAllTests) return
                  const dropped = Array.from(e.dataTransfer.files || [])
                  const valid = dropped.filter((f) => isAllowedFileName(f.name))

                  if (dropped.length && valid.length === 0) {
                    setError_Message('Only .py, .java, .c, or .rkt files are allowed.')
                    setIsErrorMessageHidden(false)
                    return
                  }

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
                {passedAllTests ? (
                  <div className="complete-message" role="status" aria-live="polite">
                    <FaCheckCircle className="complete-icon" aria-hidden="true" />
                    <h2 className="complete-title">All tests passed!</h2>
                    <p className="complete-text">
                      You&apos;re finished{isPractice ? ' with this practice problem' : ' with this assignment'}.
                      Further submissions are disabled.
                    </p>
                    <Link to={resultsHref} className="complete-link">
                      View your latest results <FaExternalLinkAlt aria-hidden="true" />
                    </Link>
                  </div>
                ) : !files.length ? (
                  <>
                    <input
                      type="file"
                      className="file-input"
                      accept=".py,.java,.c,.rkt"
                      multiple
                      disabled={passedAllTests}
                      onChange={handleFileChange}
                    />

                    <div className="file-drop-message">
                      <FaCloudUploadAlt className="file-drop-icon" aria-hidden="true" />
                      <p>
                        Drag &amp; drop your file(s) here or <span className="browse-text">browse</span>
                      </p>
                      <p className="file-drop-hint">Multi-file upload is supported for Java only.</p>
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
                              f.name === mainJavaFileName && <span className="main-indicator">Main</span>}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
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

            <div className="actions">
              <button
                type="submit"
                disabled={!is_allowed_to_submit || !canSubmit || passedAllTests}
                className={`primary ${!is_allowed_to_submit || !canSubmit ? 'disabled' : ''} ${RewardState ? 'reward' : ''
                  }`}
              >
                Upload
              </button>

              <button
                type="button"
                onClick={consumeRewardCharge}
                disabled={isPractice || RewardCharge <= 0 || passedAllTests}
                className="secondary"
                title="Use one FastPass charge to submit immediately"
              >
                Use FastPass
              </button>
            </div>

            {!isPractice && (
              <div className="status-table-wrap" aria-label="Recharge table (scrollable)">
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
              </div>
            )}

          </form>

          <div className="below-upload">
            <ErrorMessage message={error_message} isHidden={isErrorMessageHidden} />

            {hasTbsEnabled && project_id !== -1 && !is_allowed_to_submit && (
              <div className="tbs-countdown">
                <FaClock className="tbs-countdown__icon" aria-hidden="true" />
                <Countdown date={new Date(TimeUntilNextSubmission)} onComplete={onTimerFinish} />
              </div>
            )}
          </div>

          {!isPractice && (
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
                ref={feedbackRef}
                rows={1}
                placeholder="example: TA-Bot struggles when dealing with small issues in test cases"
                value={suggestions}
                onChange={(e) => {
                  setSuggestions(e.target.value)
                  autoGrowTextarea(e.currentTarget)
                }}
                className="feedback-textarea"
              />

              <button type="submit" className="feedback-button">
                Submit Feedback
              </button>
            </form>
          )}

        </section>

        {/* RIGHT: Energy + explanations panel */}
        <aside className="panel panel-status" aria-label="Energy and FastPass status">
          <div className="status-cards">
            <div className="status-card">
              <div className="status-card__top">
                <div className="status-card__label">
                  <FaBolt aria-hidden="true" /> Energy
                </div>
                <div className="status-card__value">
                  {isPractice ? (
                    <span className="big unlimited-pill" title="Practice submissions do not consume Energy">
                      Unlimited
                    </span>
                  ) : (
                    <>
                      <span className="big">{baseCharge}</span>
                      <span className="muted"> / 3</span>
                    </>
                  )}
                </div>
              </div>
              {!isPractice && (
                <div className="dots-row" aria-label="Energy charge dots">
                  {[1, 2, 3].map((level) => (
                    <div
                      key={level}
                      className={`dot ${baseCharge >= level ? 'filled' : ''} ${baseCharge === level - 1 ? 'breathing' : ''
                        }`}
                    />
                  ))}
                </div>
              )}

              {isPractice && (
                <div className="explain">
                  <p>Practice submissions do not consume Energy. Submit as many times as you like.</p>
                </div>
              )}

              {!isPractice && displayClock && (
                <div className="timer-block" aria-live="polite">
                  <div className="timer-title">Recharge countdown</div>
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
                      <div className={`timer-value ${completed ? 'completed' : ''}`}>
                        {completed ? (
                          <span>Full recharge ready</span>
                        ) : (
                          <span>
                            {hours}h {minutes}m {seconds}s
                          </span>
                        )}
                      </div>
                    )}
                  />
                  <div className="timer-subtle">When it hits zero, your energy refills to 3 all at once.</div>
                </div>
              )}

              {!isPractice && (
                <ul className="rules rules--compact">
                  <li>
                    <b>Energy</b> is consumed on submit unless you are in office hours.
                  </li>
                  <li>
                    When the recharge timer finishes, Energy refills to <b>3</b> all at once.
                  </li>
                </ul>
              )}
            </div>

            <div className="status-card">
              <div className="status-card__top">
                <div className="status-card__label">
                  <FaGift aria-hidden="true" /> FastPass charges
                </div>
                <div className="status-card__value">
                  <span className="big">{RewardCharge}</span>
                </div>
              </div>

              <div className="dots-row" aria-label="FastPass charge dots">
                {[1, 2, 3, 4, 5].map((level) => (
                  <div key={level} className={`dot purple ${RewardCharge >= level ? 'filled' : ''}`} />
                ))}
              </div>

              <div className="explain">
                <p>
                  FastPass lets you submit even when Energy is 0. Tap <b>Use FastPass</b> on the left to spend
                  one.
                </p>
                <p>
                  You can earn FastPass by attending office hours, and by solving practice problems.
                </p>
              </div>
            </div>

            <div className="status-card">
              <div className="status-card__top">
                <div className="status-card__label">
                  <FaFlask aria-hidden="true" /> Practice Completed
                </div>
                <div className="status-card__value">
                  <span className="big">{practiceProgress.earned}</span>
                  <span className="muted"> / {practiceProgress.total}</span>
                </div>
              </div>

              <div className="progress">
                <div className="progress-bar" role="progressbar" aria-valuenow={practiceProgress.pct} aria-valuemin={0} aria-valuemax={100}>
                  <div className="progress-bar__fill" style={{ width: `${practiceProgress.pct}%` }} />
                </div>
                <div className="progress-subtle">
                  Each practice problem you solve earns 1 bonus FastPass Charge.
                </div>
              </div>

              <div className="practice-row">
                <div className="practice-metrics">
                  <div className="practice-link">
                    <Link to={practiceHref} className="linklike">
                      Practice Problems <FaExternalLinkAlt aria-hidden="true" />
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}

export default StudentUpload