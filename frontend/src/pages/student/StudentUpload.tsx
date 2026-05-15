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
  FaExternalLinkAlt,
  FaCheckCircle,
} from 'react-icons/fa'

type PracticeProblemLite = {
  id: number
  number?: number
  name?: string
  enabled?: boolean
  solved?: boolean
  rewarded?: boolean
}

type AssignedClassLite = {
  id: number
  school_id?: number
}

type ModuleObjectLite = {
  Id: number
  ClassId: number
  Name: string
  Start: string
  End: string
  MainProjectId?: number
}

const authHeader = () => ({
  Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}`,
})

const parsePositiveInt = (value: string | undefined): number | null => {
  if (value === undefined || !/^\d+$/.test(value)) return null

  const parsed = parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

const normalizeMaybeJson = <T,>(item: unknown): T => {
  if (typeof item === 'string') {
    return JSON.parse(item) as T
  }

  return item as T
}

const StudentUpload = () => {
  const {
    school_id,
    class_id,
    module_id,
    project_id: route_project_id,
    practice_problem_id,
  } = useParams<{
    school_id?: string
    class_id?: string
    module_id?: string
    project_id?: string
    practice_problem_id?: string
  }>()

  const cid = parsePositiveInt(class_id) ?? -1
  const schoolId = parsePositiveInt(school_id)
  const moduleId = parsePositiveInt(module_id)
  const routeProjectId = parsePositiveInt(route_project_id)

  const practiceProblemId = parsePositiveInt(practice_problem_id)
  const isPractice = practiceProblemId !== null

  const hasModuleRoute = schoolId !== null && moduleId !== null && routeProjectId !== null

  const [files, setFiles] = useState<File[]>([])
  const [mainJavaFileName, setMainJavaFileName] = useState<string>('')

  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [error_message, setError_Message] = useState<string>('')
  const [isErrorMessageHidden, setIsErrorMessageHidden] = useState<boolean>(true)

  const [project_id, setProject_id] = useState<number>(routeProjectId ?? 0)
  const [is_allowed_to_submit] = useState<boolean>(true)

  const [hasTbsEnabled] = useState<boolean>(false)
  const [DaysSinceProjectStarted, setDaysSinceProjectStarted] = useState<number>(0)
  const [TimeUntilNextSubmission, setTimeUntilNextSubmission] = useState<string>('')

  const [suggestions, setSuggestions] = useState<string>('')
  const feedbackRef = useRef<HTMLTextAreaElement | null>(null)

  const [baseCharge, setBaseCharge] = useState<number>(0)
  const [RewardCharge, setRewardCharge] = useState<number>(0)

  const [RewardState, setRewardState] = useState<boolean>(false)
  const [inOfficeHours, setInOfficeHours] = useState<boolean>(false)

  const [project_name, setProject_name] = useState<string>('')
  const [dueDate, setDueDate] = useState<string>('')

  const [passedAllTests, setPassedAllTests] = useState<boolean>(false)
  const [checkedPassedAll, setCheckedPassedAll] = useState<boolean>(false)
  const [testcasesPassedCount, setTestcasesPassedCount] = useState<number>(0)
  const [testcasesTotalCount, setTestcasesTotalCount] = useState<number>(0)

  const [moduleName, setModuleName] = useState<string>('')
  const [practiceProblemLabel, setPracticeProblemLabel] = useState<string>('')
  const [hideClassSelectionCrumb, setHideClassSelectionCrumb] = useState<boolean>(false)


  const autoGrowTextarea = (el: HTMLTextAreaElement | null) => {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }

  const testcaseProgress = useMemo(() => {
    const total = Math.max(0, testcasesTotalCount)
    const passed = Math.max(0, Math.min(testcasesPassedCount, total))
    const pct = total === 0 ? 0 : Math.round((passed / total) * 100)
    const radius = 44
    const circumference = 2 * Math.PI * radius
    const strokeDashoffset = circumference - (pct / 100) * circumference

    return { total, passed, pct, radius, circumference, strokeDashoffset }
  }, [testcasesPassedCount, testcasesTotalCount])

  const canSubmit = isPractice || inOfficeHours || baseCharge > 0 || RewardState

  const ALLOWED_EXTS = ['.py', '.java', '.c', '.rkt']
  const isJavaFile = (f: File) => f.name.toLowerCase().endsWith('.java')
  const isJavaFileName = (n: string) => /\.java$/i.test(n)

  const isAllowedFileName = (name: string) => {
    const ext = '.' + (name.split('.').pop() || '').toLowerCase()
    return ALLOWED_EXTS.includes(ext)
  }

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
        // Ignore read failures.
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

  useEffect(() => {
    const token = localStorage.getItem('AUTOTA_AUTH_TOKEN')

    if (!token || !Number.isFinite(cid) || cid <= 0) {
      setHideClassSelectionCrumb(false)
      return
    }

    axios
      .get(`${import.meta.env.VITE_API_URL}/class/all?filter=true`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((res) => {
        const rows = Array.isArray(res.data) ? (res.data as AssignedClassLite[]) : []
        const uniqueSchoolIds = new Set(
          rows
            .map((row) => Number(row.school_id))
            .filter((rowSchoolId) => Number.isFinite(rowSchoolId) && rowSchoolId > 0)
        )

        setHideClassSelectionCrumb(
          rows.length === 1 && uniqueSchoolIds.size === 1 && Number(rows[0]?.id) === cid
        )
      })
      .catch(() => {
        setHideClassSelectionCrumb(false)
      })
  }, [cid])

  const activeDay = project_name !== '' ? Math.min(Math.max(DaysSinceProjectStarted, 1), 6) : 0

  useEffect(() => {
    getSubmissionDetails()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid, routeProjectId, moduleId])

  useEffect(() => {
    if (project_id && project_id > 0) {
      getCharges()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project_id])

  useEffect(() => {
    if (!project_id || project_id <= 0 || project_id === -1) {
      setPassedAllTests(false)
      setCheckedPassedAll(true)
      setTestcasesPassedCount(0)
      setTestcasesTotalCount(0)
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
        { headers: authHeader() }
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
        const passedCount = results.filter((r: any) => {
          const v = r?.passed ?? r?.ok ?? r?.State
          return v === true
        }).length
        const allPassed = results.length > 0 && passedCount === results.length

        setTestcasesPassedCount(passedCount)
        setTestcasesTotalCount(results.length)
        setPassedAllTests(allPassed)
        setCheckedPassedAll(true)
      })
      .catch(() => {
        setTestcasesPassedCount(0)
        setTestcasesTotalCount(0)
        setPassedAllTests(false)
        setCheckedPassedAll(true)
      })
  }, [project_id, isPractice, practiceProblemId, cid])

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
        { headers: authHeader() }
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
  }, [isPractice, practiceProblemId, project_id])


  useEffect(() => {
    checkOfficeHours()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid])

  function checkOfficeHours() {
    if (!Number.isFinite(cid) || cid <= 0) {
      setInOfficeHours(false)
      return
    }

    axios
      .get(`${import.meta.env.VITE_API_URL}/submissions/getAcceptedOHForClass?class_id=${cid}`, {
        headers: authHeader(),
      })
      .then((res) => {
        const raw =
          typeof res.data === 'object' && res.data !== null
            ? res.data.id ?? res.data.qid ?? res.data.value ?? res.data
            : res.data

        const id = Number(raw)
        setInOfficeHours(Number.isFinite(id) && id > 0)
      })
      .catch((err) => {
        console.error('Error checking office hours:', err)
        setInOfficeHours(false)
      })
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    if (passedAllTests) {
      setFiles([])
      setError_Message('')
      setIsErrorMessageHidden(true)
      event.currentTarget.value = ''
      return
    }

    const selected = event.target.files ? Array.from(event.target.files) : []
    const valid = selected.filter((f) => isAllowedFileName(f.name))

    if (selected.length && valid.length === 0) {
      setError_Message('Only .py, .java, .c, or .rkt files are allowed.')
      setIsErrorMessageHidden(false)
      event.currentTarget.value = ''
      return
    }

    if (selected.length !== valid.length) {
      setError_Message('Only .py, .java, .c, or .rkt files are allowed.')
      setIsErrorMessageHidden(false)
      event.currentTarget.value = ''
      return
    }

    if (valid.length > 1 && !valid.every(isJavaFile)) {
      setFiles([])
      setError_Message('Multi-file upload is only available for Java (.java) files.')
      setIsErrorMessageHidden(false)
      event.currentTarget.value = ''
      return
    }

    setIsErrorMessageHidden(true)
    setFiles(valid)
  }

  function getCharges() {
    if (!Number.isFinite(cid) || cid <= 0) return

    axios
      .get(`${import.meta.env.VITE_API_URL}/submissions/GetCharges?class_id=${cid}`, {
        headers: authHeader(),
      })
      .then((res) => {
        setBaseCharge(Number(res.data.baseCharge ?? 0))
        setRewardCharge(Number(res.data.rewardCharge ?? 0))
      })
      .catch((err) => {
        if (err.response?.status === 404) {
          setBaseCharge(0)
          setRewardCharge(0)
        } else {
          console.error('Error fetching charges:', err)
        }
      })
  }

  function getSubmissionDetails() {
    if (!Number.isFinite(cid) || cid <= 0) {
      setProject_name('')
      setProject_id(-1)
      return
    }

    if (hasModuleRoute && routeProjectId) {
      setProject_id(routeProjectId)

      axios
        .get(`${import.meta.env.VITE_API_URL}/projects/get_modules_by_class_id_student?id=${cid}`, {
          headers: authHeader(),
        })
        .then((res) => {
          const modules: ModuleObjectLite[] = Array.isArray(res.data)
            ? res.data.map((item: unknown) => normalizeMaybeJson<ModuleObjectLite>(item))
            : []

          const selectedModule =
            modules.find((item) => Number(item.Id) === Number(moduleId)) || null

          if (selectedModule) {
            setModuleName(selectedModule.Name || '')
          }
        })
        .catch(() => {
          setModuleName('')
        })

      axios
        .get(`${import.meta.env.VITE_API_URL}/submissions/GetSubmissionDetails?class_id=${cid}`, {
          headers: authHeader(),
        })
        .then((res) => {
          const activeProjectId = Number(res.data?.[5] || 0)

          if (activeProjectId === routeProjectId) {
            setDaysSinceProjectStarted(parseInt(res.data?.[1], 10) + 1)
            setTimeUntilNextSubmission(res.data?.[2] || '')
            setProject_name(res.data?.[3] || '')
            setDueDate(res.data?.[4] || '')
            return
          }

          setDaysSinceProjectStarted(1)
          setTimeUntilNextSubmission('')
          setProject_name('')
          setDueDate('')
        })
        .catch(() => {
          setDaysSinceProjectStarted(1)
          setTimeUntilNextSubmission('')
          setProject_name('')
          setDueDate('')
        })

      return
    }

    axios
      .get(`${import.meta.env.VITE_API_URL}/submissions/GetSubmissionDetails?class_id=${cid}`, {
        headers: authHeader(),
      })
      .then((res) => {
        setDaysSinceProjectStarted(parseInt(res.data[1], 10) + 1)
        setTimeUntilNextSubmission(res.data[2])
        setProject_name(res.data[3])
        setDueDate(res.data[4])
        setProject_id(Number(res.data[5] || 0))
      })
      .catch(() => {
        setProject_name('')
        setProject_id(-1)
      })
  }

  const downloadAssignment = (pid: number) => {
    if (!pid || pid <= 0) return

    const qs = isPractice && practiceProblemId ? `&practice_problem_id=${practiceProblemId}` : ''

    axios
      .get(`${import.meta.env.VITE_API_URL}/projects/getAssignmentDescription?project_id=${pid}${qs}`, {
        headers: authHeader(),
        responseType: 'blob',
      })
      .then((res) => {
        const type = (res.headers as any)['content-type'] || 'application/octet-stream'
        const blob = new Blob([res.data], { type })
        const name = (res.headers as any)['x-filename'] || 'assignment_description'
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
        { headers: authHeader() }
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

  function getResultsHref(submissionId?: number | string) {
    const qs =
      isPractice && practiceProblemId
        ? `?practice=1&practice_problem_id=${practiceProblemId}`
        : ''

    if (submissionId !== undefined && class_id !== undefined) {
      return `/student/${class_id}/code/${submissionId}${qs}`
    }

    if (class_id !== undefined) {
      return `/student/${class_id}/code${qs}`
    }

    return `code${qs}`
  }

  function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault()

    if (passedAllTests) return

    if (!canSubmit) {
      alert(
        'You’re out of charges.\n\n' +
        'Please wait until your energy recharges (see countdown), ' +
        'or use a FastPass charge first to submit now.'
      )
      return
    }

    if (!Number.isFinite(cid) || cid <= 0) {
      setError_Message('Missing class id.')
      setIsErrorMessageHidden(false)
      return
    }

    if (!project_id || project_id <= 0 || project_id === -1) {
      setError_Message('No active project was found for this upload.')
      setIsErrorMessageHidden(false)
      return
    }

    if (files.length === 0) {
      setError_Message('Please select a file to upload.')
      setIsErrorMessageHidden(false)
      return
    }

    if (files.length > 1 && !files.every(isJavaFile)) {
      setError_Message('Multi-file upload is only available for Java (.java) files.')
      setIsErrorMessageHidden(false)
      return
    }

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
    formData.append('project_id', project_id.toString())

    if (hasModuleRoute && moduleId) {
      formData.append('module_id', moduleId.toString())
    }

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
        headers: authHeader(),
      })
      .then((res) => {
        const sid = (res?.data && (res.data.sid ?? res.data.Sid ?? res.data.id)) as
          | number
          | string
          | undefined

        window.location.href = getResultsHref(sid)
      })
      .catch((err) => {
        setError_Message(err.response?.data?.message || 'Upload failed.')
        setIsErrorMessageHidden(false)
        setIsLoading(false)
      })
  }

  function consumeRewardCharge() {
    if (passedAllTests) return

    if (isPractice) return

    if (RewardCharge === 0) {
      alert("You don't have any reward charges to use")
      return
    }

    if (!Number.isFinite(cid) || cid <= 0) return

    axios
      .get(`${import.meta.env.VITE_API_URL}/submissions/ConsumeCharge?class_id=${cid}`, {
        headers: authHeader(),
      })
      .then(() => setRewardState(true))
      .catch(() => {
        // Ignore.
      })
  }

  const CODE_ICON_RE = /\.(py|java|c|h|rkt|scm|cpp)$/i
  const TEXT_ICON_RE = /\.(txt|md|pdf|doc|docx)$/i

  const getFileIcon = (filename: string) => {
    if (CODE_ICON_RE.test(filename)) return <FaCode className="file-language-icon" aria-hidden="true" />
    if (TEXT_ICON_RE.test(filename)) {
      return <FaAlignJustify className="file-language-icon" aria-hidden="true" />
    }

    return <FaTimesCircle className="file-language-icon" aria-hidden="true" />
  }

  const pageTitle = useMemo(() => {
    if (isPractice) {
      return (
        practiceProblemLabel ||
        (practiceProblemId ? `Practice ${practiceProblemId}: Practice Problem ${practiceProblemId}` : '')
      )
    }

    if (project_name) return project_name.replace(/_/g, ' ')
    if (moduleName) return `${moduleName} Main Assignment`

    return ''
  }, [isPractice, practiceProblemLabel, practiceProblemId, project_name, moduleName])

  const breadcrumbsItems = useMemo(() => {
    const titleLabel = pageTitle || (isPractice ? 'Practice Upload' : 'Project Upload')

    if (hasModuleRoute && schoolId && moduleId) {
      return [
        { label: 'School Selection', to: '/student/schools' },
        { label: 'Class Selection', to: `/student/school/${schoolId}/classes` },
        { label: 'Module List', to: `/student/school/${schoolId}/class/${cid}/modules` },
        {
          label: 'Module Details',
          to: `/student/school/${schoolId}/class/${cid}/module/${moduleId}`,
        },
        { label: titleLabel },
      ]
    }

    if (isPractice) {
      return hideClassSelectionCrumb
        ? [
          { label: 'Project Upload', to: `/student/${class_id}/upload` },
          { label: 'Practice Select', to: `/student/${class_id}/practice` },
          { label: titleLabel },
        ]
        : [
          { label: 'Class Selection', to: '/student/classes' },
          { label: 'Project Upload', to: `/student/${class_id}/upload` },
          { label: 'Practice Select', to: `/student/${class_id}/practice` },
          { label: titleLabel },
        ]
    }

    return hideClassSelectionCrumb
      ? [{ label: titleLabel }]
      : [{ label: 'Class Selection', to: '/student/classes' }, { label: titleLabel }]
  }, [
    pageTitle,
    hasModuleRoute,
    schoolId,
    moduleId,
    cid,
    isPractice,
    hideClassSelectionCrumb,
    class_id,
  ])

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

  const resultsHref = getResultsHref(project_id)

  return (
    <div className="student-upload-page">
      <LoadingAnimation show={isLoading} message="Uploading..." />

      <Helmet>
        <title>MAAT</title>
      </Helmet>

      <MenuComponent
        showAdminUpload={false}
        showUpload={false}
        showHelp={false}
        showCreate={false}
        showLast={true}
        showReviewButton={false}
      />

      <DirectoryBreadcrumbs items={breadcrumbsItems} />

      <div className="pageTitle">Student Upload</div>

      <div className="student-upload-shell">
        <section className="panel panel-upload" aria-label="Upload Assignment">
          <header className="panel-header">
            {pageTitle ? (
              <>
                <div className="panel-header__titleCol">
                  <h1 className="panel-title panel-title--project">{pageTitle}</h1>

                  <div className="assignment-actions">
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

                    <button
                      type="button"
                      className="presentation-download"
                      onClick={() => undefined}
                      aria-label="Download presentation"
                      title="Presentation download coming soon"
                    >
                      <FaDownload aria-hidden="true" />
                      <span>Presentation</span>
                    </button>
                  </div>
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

          <div className="testcase-summary-card" aria-label="Testcase pass summary">
            <div
              className="testcase-circle"
              style={{ '--testcase-progress': testcaseProgress.pct } as React.CSSProperties}
              role="img"
              aria-label={`${testcaseProgress.passed} of ${testcaseProgress.total} testcases passing`}
            >
              <svg className="testcase-circle__svg" viewBox="0 0 112 112" aria-hidden="true">
                <circle className="testcase-circle__track" cx="56" cy="56" r={testcaseProgress.radius} />
                <circle
                  className="testcase-circle__fill"
                  cx="56"
                  cy="56"
                  r={testcaseProgress.radius}
                  strokeDasharray={testcaseProgress.circumference}
                  strokeDashoffset={testcaseProgress.strokeDashoffset}
                />
              </svg>
              <div className="testcase-circle__center">
                <span className="testcase-circle__count">
                  {testcaseProgress.passed}/{testcaseProgress.total}
                </span>
                <span className="testcase-circle__label">passed</span>
              </div>
            </div>

            <div className="testcase-summary-card__content">
              <div className="testcase-summary-card__eyebrow">Testcase Progress</div>
              <h2 className="testcase-summary-card__title">{testcaseProgress.pct}% passing</h2>
              <p className="testcase-summary-card__text">
                {!checkedPassedAll
                  ? 'Checking testcase results...'
                  : testcaseProgress.total > 0
                    ? `${testcaseProgress.passed} out of ${testcaseProgress.total} testcases are currently passing.`
                    : 'No testcase results are available yet. Upload a solution to see your progress.'}
              </p>
            </div>
          </div>

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

                  if (dropped.length !== valid.length) {
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
                MAAT is an assessment system developed by Marquette students. We welcome constructive feedback
                throughout the semester. The MAAT team will strive to implement your suggestions. For more
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
                placeholder="example: MAAT struggles when dealing with small issues in test cases"
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
      </div>
    </div>
  )
}

export default StudentUpload