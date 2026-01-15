// AdminStudentRoster.tsx
import React, { Component } from 'react'
import axios from 'axios'
import { Helmet } from 'react-helmet'
import { Link, useParams } from 'react-router-dom'
import MenuComponent from '../components/MenuComponent'
import DirectoryBreadcrumbs from '../components/DirectoryBreadcrumbs'
import '../../styling/AdminStudentRoster.scss'

import { FaClone, FaDownload, FaEye, FaHandPaper } from 'react-icons/fa'

const AdminStudentRoster = () => {
    const { class_id, id } = useParams<{ class_id: string; id: string }>()

    if (!class_id || !id) {
        return <div>Error: project id missing or invalid</div>
    }

    const project_id = parseInt(id, 10)
    if (Number.isNaN(project_id)) {
        return <div>Error: project id missing or invalid</div>
    }

    return <StudentListInternal project_id={project_id} class_id={class_id} />
}

export default AdminStudentRoster

interface StudentListProps {
    project_id: number
    class_id: string
}

class Row {
    constructor() {
        this.id = 0
        this.Lname = ''
        this.Fname = ''
        this.numberOfSubmissions = 0
        this.date = ''
        this.isPassing = false
        this.subid = 0
        this.lecture_number = 0
        this.lab_number = 0
        this.classId = ''
        this.grade = 0
        this.StudentNumber = 0
        this.IsLocked = false
    }

    id: number
    Lname: string
    Fname: string
    numberOfSubmissions: number
    date: string
    isPassing: boolean
    subid: number
    lecture_number: number
    lab_number: number
    classId: string
    grade: number
    StudentNumber: number
    IsLocked: boolean
    attendedOfficeHours: boolean = false;
}

interface Option {
    key: number
    text: string
    value: number
}

interface StudentListState {
    rows: Array<Row>
    isLoading: boolean
    lecture_numbers: Array<Option>
    lab_numbers: Array<Option>
    selectedStudent: number
    modalIsLoading: boolean
    modalIsOpen: boolean
    selectedStudentData: any[]
    selectedStudentCode: string
    selectedStudentTestResults: any[]
    selectedStudentName: string
    selectedStudentGrade: number | undefined
    exportModalIsOpen: boolean
    selectedLecture: number
    selectedLab: number
    projectLanguage: string

    // Modal "CodePage-like" UI
    activeView: 'table' | 'diff'
    selectedDiffId: string | null
    sortBy: 'lastname' | 'lastsubmitted'

    plagiarismModalIsOpen: boolean
    plagiarismResults: Array<{
        a: { user_id: number; name: string; class_id: string; submission_id: number }
        b: { user_id: number; name: string; class_id: string; submission_id: number }
        similarity_token: number
        similarity_ast: number
        overlap_snippet_a?: string
        overlap_snippet_b?: string
    }>
    // Marks Code//
    plagiarismPage: number
    plagiarismPageSize: number
    // End of Change //
}

class StudentListInternal extends Component<StudentListProps, StudentListState> {
    constructor(props: StudentListProps) {
        super(props)

        this.state = {
            rows: [],
            lecture_numbers: [{ key: -1, text: 'All', value: -1 }],
            lab_numbers: [{ key: -1, text: 'All', value: -1 }],
            isLoading: false,
            selectedStudent: -1,
            modalIsLoading: false,
            modalIsOpen: false,
            selectedStudentData: [],
            selectedStudentCode: '',
            selectedStudentTestResults: [],
            selectedStudentName: '',
            selectedStudentGrade: 0,
            exportModalIsOpen: false,
            selectedLecture: -1,
            selectedLab: -1,
            projectLanguage: '',

            activeView: 'table',
            selectedDiffId: null,
            sortBy: 'lastname',
            plagiarismModalIsOpen: false,
            plagiarismResults: [],
            /* Marks Changes */
            plagiarismPage: 1,
            /* End Of Change */
            plagiarismPageSize: 10,
        }

        this.handleClick = this.handleClick.bind(this)

        this.handleLectureChange = this.handleLectureChange.bind(this)
        this.handleLabChange = this.handleLabChange.bind(this)
        this.handleSortChange = this.handleSortChange.bind(this)

        this.handleUnlockClick = this.handleUnlockClick.bind(this)
        this.submitGrades = this.submitGrades.bind(this)
        this.exportGrades = this.exportGrades.bind(this)
        this.downloadStudentCode = this.downloadStudentCode.bind(this)
    }

    async downloadStudentCode(row: Row) {
        try {
            if (row.subid === -1) return
            const url = `${import.meta.env.VITE_API_URL}/submissions/codefinder?id=${row.subid}&class_id=${row.classId}`
            const res = await axios.get<Blob>(url, {
                headers: { Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}` },
                responseType: 'blob',
            })

            const cd = String((res.headers as any)?.['content-disposition'] ?? '')
            const match = /filename\*?=(?:UTF-8''|")?([^\";]+)\"?/i.exec(cd)
            const headerName = match ? decodeURIComponent(match[1]) : ''
            const safe = (s: string) => (s || '').replace(/\s+/g, '_')
            const fallback = `${safe(row.Fname)}_${safe(row.Lname)}_${row.subid}_submission.zip`
            const fname = headerName || fallback

            const a = document.createElement('a')
            a.href = URL.createObjectURL(res.data)
            a.download = fname
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
            URL.revokeObjectURL(a.href)
        } catch (_e) {
            window.alert('Failed to download code. Please try again.')
        }
    }

    componentDidMount() {
        const submissionsRequest = axios.post(
            import.meta.env.VITE_API_URL + `/submissions/recentsubproject`,
            { project_id: this.props.project_id },
            {
                headers: {
                    Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}`,
                },
            }
        );
        const ohVisitsRequest = axios.post(
            import.meta.env.VITE_API_URL + `/submissions/get_oh_visits_by_projectId`,
            { project_id: this.props.project_id },
            {
                headers: {
                    Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}`,
                },
            }
        );
        Promise.all([submissionsRequest, ohVisitsRequest])
            .then(([submissionsRes, officeHoursRes]) => {
                const data = submissionsRes.data

                const officeHoursAttendees = new Set(officeHoursRes.data);
                const rows: Array<Row> = []
                const lectureSet = new Set<number>([-1])
                const labSet = new Set<number>([-1])

                Object.entries(data).map(([key, value]) => {
                    const row = new Row()
                    const student_output_data = value as Array<any>

                    row.id = parseInt(key, 10)
                    row.Lname = String(student_output_data[0] ?? '')
                    row.Fname = String(student_output_data[1] ?? '')
                    row.lecture_number = parseInt(String(student_output_data[2] ?? '0'), 10)
                    row.lab_number = parseInt(String(student_output_data[3] ?? '0'), 10)

                    lectureSet.add(row.lecture_number)
                    labSet.add(row.lab_number)

                    row.numberOfSubmissions = parseInt(String(student_output_data[4] ?? '0'), 10)
                    row.date = String(student_output_data[5] ?? '')

                    const passRaw = String(student_output_data[6] ?? '').toLowerCase().trim()
                    row.isPassing =
                        passRaw === 'true' ||
                        passRaw === '1' ||
                        passRaw === 'pass' ||
                        passRaw === 'passed' ||
                        passRaw === 'ok' ||
                        passRaw === 'success'

                    const hasSub = String(student_output_data[7] ?? 'N/A') !== 'N/A'
                    const off = hasSub ? 0 : 1
                    row.subid = parseInt(String(student_output_data[7 + off] ?? '-1'), 10)
                    row.classId = String(student_output_data[8 + off] ?? '')
                    row.grade = parseInt(String(student_output_data[9 + off] ?? '0'), 10)
                    row.StudentNumber = parseInt(String(student_output_data[10 + off] ?? '0'), 10)
                    const lockRaw = String(student_output_data[11 + off] ?? '').toLowerCase().trim()
                    row.IsLocked = lockRaw === 'true' || lockRaw === '1' || lockRaw === 'locked'

                    row.attendedOfficeHours = officeHoursAttendees.has(row.id);

                    rows.push(row)
                    return row
                })
                const lecture_numbers: Option[] = Array.from(lectureSet)
                    .filter((v) => v !== -1)
                    .sort((a, b) => a - b)
                    .map((v) => ({ key: v, text: String(v), value: v }))
                lecture_numbers.unshift({ key: -1, text: 'All', value: -1 })

                const lab_numbers: Option[] = Array.from(labSet)
                    .filter((v) => v !== -1)
                    .sort((a, b) => a - b)
                    .map((v) => ({ key: v, text: String(v), value: v }))
                lab_numbers.unshift({ key: -1, text: 'All', value: -1 })

                rows.sort((a, b) => a.Lname.localeCompare(b.Lname))

                this.setState({ rows, lecture_numbers, lab_numbers })
            })
    }

    // Run plagiarism detector
    handleClick = () => {
        this.setState({ isLoading: true })
        axios
            .post(
                import.meta.env.VITE_API_URL + `/projects/run-plagiarism`,
                { project_id: this.props.project_id },
                {
                    headers: {
                        Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}`,
                    },
                }
            )
            .then((res) => {
                const data = res.data || {}
                const pairs = Array.isArray(data.pairs) ? data.pairs : []
                this.setState({
                    plagiarismResults: pairs,
                    plagiarismModalIsOpen: true,
                    /* Marks Code */
                    plagiarismPage: 1,
                    /* End Of Code */
                    isLoading: false,
                })
            })
            .catch((_exc) => {
                window.alert('Error running plagiarism detector. Please try again.')
                this.setState({ isLoading: false })
            })
    }

    handleLectureChange(ev: React.ChangeEvent<HTMLSelectElement>) {
        const value = parseInt(ev.target.value, 10)
        this.setState({ selectedLecture: value }, this.applyFilters)
    }

    handleLabChange(ev: React.ChangeEvent<HTMLSelectElement>) {
        const value = parseInt(ev.target.value, 10)
        this.setState({ selectedLab: value }, this.applyFilters)
    }

    handleSortChange(ev: React.ChangeEvent<HTMLSelectElement>) {
        const value = ev.target.value as 'lastname' | 'lastsubmitted'
        this.setState({ sortBy: value })
    }

    applyFilters = () => {
        const { selectedLecture, selectedLab } = this.state
        const new_rows = this.state.rows.map((row) => {
            const lectureOk = selectedLecture === -1 || row.lecture_number === selectedLecture
            const labOk = selectedLab === -1 || row.lab_number === selectedLab
            return { ...row, hidden: !(lectureOk && labOk) }
        })
        this.setState({ rows: new_rows })
    }

    handleGradeChange = (e: React.ChangeEvent<HTMLInputElement>, row: Row) => {
        const newValue = parseFloat(e.target.value)
        if (!isNaN(newValue)) {
            const updatedRows = this.state.rows.map((r) => (r.id === row.id ? { ...r, grade: newValue } : r))
            this.setState({ rows: updatedRows })
        }
    }

    // Unlock a student account
    handleUnlockClick = (UserId: number) => {
        axios
            .post(
                import.meta.env.VITE_API_URL + `/projects/unlockStudentAccount`,
                { UserId },
                {
                    headers: {
                        Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}`,
                    },
                }
            )
            .then((_res) => {
                window.location.reload()
            })
    }

    submitGrades(UserId: number, grade: string) {
        const intGrade = Number.isFinite(Number(grade)) ? parseInt(grade, 10) : 0
        this.setState({ isLoading: true })

        axios
            .post(
                import.meta.env.VITE_API_URL + `/submissions/submitgrades`,
                { userId: UserId, grade: intGrade, projectID: this.props.project_id },
                {
                    headers: {
                        Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}`,
                    },
                }
            )
            .then((_res) => {
                this.setState((prev) => ({
                    rows: prev.rows.map((r) => (r.id === UserId ? { ...r, grade: intGrade } : r)),
                    modalIsOpen: false,
                    modalIsLoading: false,
                    isLoading: false,
                    selectedStudent: -1,
                    selectedStudentName: '',
                    selectedStudentGrade: 0,
                    activeView: 'table',
                    selectedDiffId: null,
                }))
            })
            .catch((_exc) => {
                this.setState({ isLoading: false })
                window.alert('Failed to submit grade. Please try again.')
            })
    }

    exportGrades() {
        axios
            .get(import.meta.env.VITE_API_URL + `/submissions/getprojectscores?projectID=${this.props.project_id}`, {
                headers: {
                    Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}`,
                },
            })
            .then((res) => {
                const projectname = res.data.projectName
                const csvContent: String[][] = []
                let selectedRow: any

                csvContent.push(['OrgDefinedId', projectname + ' Points Grade', 'End-of-Line Indicator'])

                for (const value of res.data.studentData) {
                    selectedRow = this.state.rows.find((row) => row.id === value[2])
                    if (this.state.selectedLecture === -1) {
                        csvContent.push([value[0].toString(), value[1].toString(), '#'])
                    } else {
                        if (selectedRow && selectedRow.lecture_number === this.state.selectedLecture) {
                            csvContent.push([value[0].toString(), value[1].toString(), '#'])
                        }
                    }
                }

                const csvRows = csvContent.map((row) => row.join(','))
                const csvString = csvRows.join('\n')
                const blob = new Blob([csvString], { type: 'text/csv' })
                const url = URL.createObjectURL(blob)

                const a = document.createElement('a')
                a.href = url
                a.download = `${projectname}.csv`
                document.body.appendChild(a)
                a.click()

                document.body.removeChild(a)
                URL.revokeObjectURL(url)
                this.setState({ exportModalIsOpen: false })
            })
            .catch((_exc) => { })
    }

    openGradingModule(UserId: number) {
        this.setState({ modalIsLoading: true, activeView: 'table', selectedDiffId: null })

        if (UserId === -1) {
            const first = this.state.rows[0]
            if (!first) {
                this.setState({ modalIsOpen: false, modalIsLoading: false })
                return
            }
            UserId = first.id
            this.setState({
                selectedStudentName: first.Fname + ' ' + first.Lname,
                selectedStudent: UserId,
                selectedStudentGrade: first.grade,
            })
        } else {
            const selectedRow = this.state.rows.find((row) => row.id === UserId)
            if (selectedRow === undefined) {
                this.setState({ modalIsOpen: false, modalIsLoading: false })
                return
            }
            this.setState({
                selectedStudentName: selectedRow.Fname + ' ' + selectedRow.Lname,
                selectedStudent: UserId,
                selectedStudentGrade: selectedRow.grade,
            })
        }

        axios
            .post(
                import.meta.env.VITE_API_URL + `/projects/ProjectGrading`,
                { userID: UserId, ProjectId: this.props.project_id },
                {
                    headers: {
                        Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}`,
                    },
                }
            )
            .then((res) => {
                this.setState({
                    selectedStudentData: res.data.GradingData,
                    modalIsLoading: false,
                    modalIsOpen: true,
                    selectedStudentCode: res.data.Code,
                    selectedStudentTestResults: res.data.TestResults,
                    projectLanguage: res.data.Language,
                })
            })
            .catch((_exc) => {
                this.setState({ modalIsLoading: false })
            })
    }

    render() {
        const rowsForView = (() => {
            const visible = this.state.rows.filter((r) => !r.hidden)
            if (this.state.sortBy === 'lastsubmitted') {
                const timeVal = (r: Row) => {
                    const t = Date.parse(r.date)
                    return isNaN(t) ? -Infinity : t
                }
                return [...visible].sort((a, b) => timeVal(b) - timeVal(a))
            }
            return [...visible].sort((a, b) => a.Lname.localeCompare(b.Lname) || a.Fname.localeCompare(b.Fname))
        })()

        // ===== Helpers for modal "CodePage-like" UI =====
        const code = this.state.selectedStudentCode || ''

        // --- Pagination for plagiarism modal (10 per page) ---
        const pageSize = this.state.plagiarismPageSize ?? 10

        // --- Thresholds (easy to tune) ---
        const SIM_THRESHOLD = 0.75
        const MIN_OVERLAP_CHARS = 150

        const raw = this.state.plagiarismResults ?? []

        const score = (r: any) => ((r.similarity_token ?? 0) + (r.similarity_ast ?? 0)) / 2

        const filteredPlagiarismResults = raw.filter((p) => {
            const overlapA = (p.overlap_snippet_a ?? '').trim()
            const overlapB = (p.overlap_snippet_b ?? '').trim()
            const overlapChars = overlapA.length + overlapB.length

            const hasOverlapSnippets = overlapChars > 0
            const overlapOk = !hasOverlapSnippets || overlapChars >= MIN_OVERLAP_CHARS

            return score(p) >= SIM_THRESHOLD && overlapOk
        })

        const sortedPlagiarismResults = [...filteredPlagiarismResults].sort((x, y) => {
            const xScore = score(x)
            const yScore = score(y)

            if (yScore !== xScore) return yScore - xScore
            if ((y.similarity_ast ?? 0) !== (x.similarity_ast ?? 0))
                return (y.similarity_ast ?? 0) - (x.similarity_ast ?? 0)
            return (y.similarity_token ?? 0) - (x.similarity_token ?? 0)
        })

        const totalResults = sortedPlagiarismResults.length
        const totalPages = Math.max(1, Math.ceil(totalResults / pageSize))

        const currentPage = Math.min(Math.max(this.state.plagiarismPage ?? 1, 1), totalPages)
        const startIndex = (currentPage - 1) * pageSize

        const pageResults = sortedPlagiarismResults.slice(startIndex, startIndex + pageSize)

        const goToPage = (p: number) => {
            const clamped = Math.max(1, Math.min(p, totalPages))
            this.setState({ plagiarismPage: clamped })
        }
        // End of Changes

        function parseOutputs(raw: string): { expected: string; actual: string; hadDiff: boolean } {
            if (raw.includes('~~~diff~~~')) {
                const [userPart, expectedPart = ''] = raw.split('~~~diff~~~')
                return { expected: expectedPart, actual: userPart, hadDiff: true }
            }

            const lines = raw.replace(/\r\n/g, '\n').split('\n')
            const expectedLines: string[] = []
            const actualLines: string[] = []
            let sawDiffMarker = false

            for (const l of lines) {
                const t = l.trimStart()
                if (t.startsWith('---')) {
                    sawDiffMarker = true
                    continue
                }
                if (t.startsWith('< ')) {
                    expectedLines.push(t.slice(2))
                    sawDiffMarker = true
                    continue
                }
                if (t.startsWith('> ')) {
                    actualLines.push(t.slice(2))
                    sawDiffMarker = true
                    continue
                }
            }

            if (sawDiffMarker) {
                return { expected: expectedLines.join('\n'), actual: actualLines.join('\n'), hadDiff: true }
            }
            return { expected: '', actual: raw, hadDiff: false }
        }

        function truncateLines(text: string, maxLines = 30) {
            const arr = text ? text.replace(/\r\n/g, '\n').split('\n') : []
            const total = arr.length
            const truncated = total > maxLines
            const shown = truncated ? arr.slice(0, maxLines) : arr
            return {
                text: shown.join('\n'),
                total,
                truncated,
                omitted: truncated ? total - maxLines : 0,
            }
        }

        function friendlySkipMessage(): string[] {
            return [
                'This test did not run due to a configuration issue.',
                'If this keeps happening, contact your TA or instructor.',
            ]
        }

        function buildUnifiedDiff(expected: string, actual: string, title: string): string {
            const e = (expected ?? '').replace(/\r\n/g, '\n').split('\n')
            const a = (actual ?? '').replace(/\r\n/g, '\n').split('\n')
            const lines: string[] = []
            lines.push(`--- actual:${title}`)
            lines.push(`+++ expected:${title}`)
            const max = Math.max(e.length, a.length)
            for (let i = 0; i < max; i++) {
                const el = e[i] ?? ''
                const al = a[i] ?? ''
                if (el === al) {
                    lines.push(` ${el}`)
                } else {
                    if (al !== '') lines.push(`-${al}`)
                    if (el !== '') lines.push(`+${el}`)
                    if (el === '' && al === '') lines.push(' ')
                }
            }
            return lines.join('\n')
        }

        const results = (this.state.selectedStudentTestResults || []).map((t: any) => {
            const outputStr =
                typeof t.output === 'string' ? t.output : Array.isArray(t.output) ? t.output.join('\n') : ''
            const s = outputStr.replace(/\r\n/g, '\n')

            const { expected, actual, hadDiff } = parseOutputs(s)
            const norm = (x: string) => (x ?? '').replace(/\r\n/g, '\n').trimEnd()

            const passedExplicit =
                typeof t.passed === 'boolean' ? t.passed : typeof t.Pass === 'boolean' ? t.Pass : undefined

            const passedHeuristic = hadDiff
                ? norm(expected) === norm(actual)
                : /^no differences\.?$/i.test(s.trim()) || s.trim() === '~~~diff~~~' || s.trim() === ''

            const passed = passedExplicit !== undefined ? passedExplicit : passedHeuristic

            return {
                skipped: false,
                passed,
                test: {
                    output: s.split('\n'),
                    type: 0,
                    name: t.name || t.test || t.testCaseName || '',
                    hidden: t.hidden ? 'True' : 'False',
                },
            }
        })

        const visibleResults = results.filter((r: any) => r.test.hidden !== 'True')
        const hiddenCount = results.length - visibleResults.length
        const labelFor = (r: any) => (r.skipped ? 'Skipped' : r.passed ? 'Passed' : 'Failed')

        type DiffEntry = {
            id: string
            test: string
            status: string
            passed: boolean
            skipped: boolean
            expected: string
            actual: string
            unified: string
        }

        const diffFilesAll: DiffEntry[] = (() => {
            const entries: DiffEntry[] = []
            visibleResults.forEach((r: any, idx: number) => {
                const rawOut = (r.skipped ? friendlySkipMessage() : (r.test.output || [])).join('\n')
                const { expected, actual } = parseOutputs(rawOut)
                const title = `${r.test.name || 'test'}:${idx}`
                const unified = buildUnifiedDiff(expected, actual, title)
                entries.push({
                    id: `${idx}__${r.test.name || 'test'}`,
                    test: r.test.name || '',
                    status: labelFor(r),
                    passed: r.passed,
                    skipped: r.skipped,
                    expected,
                    actual,
                    unified,
                })
            })
            return entries.sort((a, b) => Number(a.passed) - Number(b.passed) || a.test.localeCompare(b.test))
        })()

        const derivedSelectedDiffId = this.state.selectedDiffId ?? (diffFilesAll[0]?.id ?? null)
        const selectedFile = diffFilesAll.find((f) => f.id === derivedSelectedDiffId) || null

        const codeLines = code ? code.replace(/\r\n/g, '\n').split('\n') : []

        type TestRow =
            | { kind: 'info'; note?: string }
            | {
                kind: 'result'
                test: string
                status: string
                passed: boolean
                expectedExcerpt: string
                outputExcerpt: string
                note?: string
            }

        const testRows: TestRow[] = []
        if (hiddenCount > 0) {
            testRows.push({ kind: 'info', note: `Hidden tests not shown: ${hiddenCount}` })
        }
        visibleResults.forEach((r: any) => {
            const status = labelFor(r)
            const rawOut = (r.skipped ? friendlySkipMessage() : (r.test.output || [])).join('\n')
            const { expected, actual, hadDiff } = parseOutputs(rawOut)
            const expTrunc = truncateLines(r.passed ? actual : expected)
            const actTrunc = truncateLines(actual)
            testRows.push({
                kind: 'result',
                test: r.test.name || '',
                status,
                passed: r.passed,
                expectedExcerpt: r.passed ? expTrunc.text : expTrunc.text || 'N/A',
                outputExcerpt: actTrunc.text || 'N/A',
                note: !r.passed && !hadDiff ? 'Grader did not provide a separate expected block.' : undefined,
            })
        })

        const testsLoaded = !this.state.modalIsLoading

        return (
            <div>
                <Helmet>
                    <title>[Admin] TA-Bot</title>
                </Helmet>

                <MenuComponent
                    showUpload={false}
                    showAdminUpload={true}
                    showHelp={false}
                    showCreate={false}
                    showLast={false}
                    showReviewButton={false}
                />

                <DirectoryBreadcrumbs
                    items={[
                        { label: 'Class Selection', to: '/admin/classes' },
                        { label: 'Project List', to: `/admin/${this.props.class_id}/projects/` },
                        { label: 'Student List' },
                    ]}
                />

                <div className="pageTitle">Grade or Review Student Submissions</div>

                <div className="main-grid">
                    <>
                        <div className={`admin-project-config-container${this.state.modalIsOpen ? ' blurred' : ''}`}>

                            <div className="student-sub-panel">
                                <div className="filter-bar">
                                    <label className="filter-label" htmlFor="lectureFilter">
                                        Lecture:&nbsp;
                                    </label>
                                    <select
                                        id="lectureFilter"
                                        className="filter-select lecture-filter"
                                        onChange={this.handleLectureChange}
                                        value={this.state.selectedLecture}
                                    >
                                        {this.state.lecture_numbers.map((opt) => (
                                            <option className="lecture-option" key={`lec-${opt.key}`} value={opt.value}>
                                                {opt.text}
                                            </option>
                                        ))}
                                    </select>

                                    &nbsp;&nbsp;

                                    <label className="filter-label" htmlFor="labFilter">
                                        Lab:&nbsp;
                                    </label>
                                    <select
                                        id="labFilter"
                                        className="filter-select lab-filter"
                                        onChange={this.handleLabChange}
                                        value={this.state.selectedLab}
                                    >
                                        {this.state.lab_numbers.map((opt) => (
                                            <option className="lab-option" key={`lab-${opt.key}`} value={opt.value}>
                                                {opt.text}
                                            </option>
                                        ))}
                                    </select>

                                    &nbsp;&nbsp;

                                    <button
                                        type="button"
                                        className="btn plagiarism-btn"
                                        onClick={this.handleClick}
                                        disabled={this.state.isLoading}
                                        aria-label="Run Plagiarism Detector"
                                        title="Run Plagiarism Detector"
                                    >
                                        <FaClone aria-hidden="true" />
                                        &nbsp;Run Plagiarism Detector
                                    </button>

                                    &nbsp;&nbsp;

                                    <label className="filter-label" htmlFor="sortSelect">
                                        Sort by:&nbsp;
                                    </label>
                                    <select
                                        id="sortSelect"
                                        className="filter-select sort-select"
                                        value={this.state.sortBy}
                                        onChange={this.handleSortChange}
                                    >
                                        <option value="lastname">Last name (A→Z)</option>
                                        <option value="lastsubmitted">Last submitted (newest)</option>
                                    </select>
                                </div>

                                <div className="table-scroll" role="region" aria-label="Student submissions" tabIndex={0}>
                                    <table className="students-table">
                                        <thead className="table-head">
                                            <tr className="table-row">
                                                <th className="col-student-name">Student</th>
                                                <th className="col-lecture-number">Lecture</th>
                                                <th className="col-lab-number">Lab</th>
                                                <th className="col-submissions">Submissions</th>
                                                <th className="col-date">Last Submitted</th>
                                                <th className="col-status">Status</th>
                                                <th className="col-view">View</th>
                                                <th className="col-download">Download</th>
                                                <th className="col-grade">Grade</th>
                                            </tr>
                                        </thead>

                                        <tbody className="table-body">
                                            {rowsForView.map((row) => {
                                                if (row.hidden) return null
                                                const renderStudentName = () => (
                                                    <td className="student-name-cell">
                                                        {row.Fname + ' ' + row.Lname}{' '}

                                                        {row.attendedOfficeHours && (
                                                            <span
                                                                className="office-hours-indicator"
                                                                data-tooltip="Attended Office Hours for this project"
                                                            >
                                                                <FaHandPaper aria-hidden="true" />
                                                            </span>
                                                        )}

                                                        {row.IsLocked === true && (
                                                            <button className="btn unlock-btn" onClick={() => this.handleUnlockClick(row.id)}>
                                                                Unlock
                                                            </button>
                                                        )}
                                                    </td>
                                                );
                                                if (row.subid === -1) {
                                                    return (
                                                        <tr className="student-row student-row--no-submission" key={`row-${row.id}-na`}>
                                                            {renderStudentName()}
                                                            <td className="lecture-number-cell">{row.lecture_number}</td>
                                                            <td className="lab-number-cell">{row.lab_number}</td>
                                                            <td className="submissions-cell">N/A</td>
                                                            <td className="date-cell">N/A</td>
                                                            <td className="status-cell">N/A</td>
                                                            <td className="view-cell">N/A</td>
                                                            <td className="download-cell">N/A</td>
                                                            <td className="grade-cell">
                                                                <input
                                                                    className="grade-input"
                                                                    type="text"
                                                                    placeholder="optional"
                                                                    value={row.grade}
                                                                    onChange={(e) => this.handleGradeChange(e, row)}
                                                                    disabled
                                                                />
                                                                <Link
                                                                    to={`/admin/${row.classId}/project/${this.props.project_id}/grade/${row.subid}`}
                                                                    className="btn grade-btn"
                                                                    rel="noreferrer"
                                                                >
                                                                    Grade
                                                                </Link>
                                                            </td>
                                                        </tr>
                                                    )
                                                }

                                                return (
                                                    <tr className="student-row" key={`row-${row.id}`}>
                                                        {renderStudentName()}
                                                        <td className="lecture-number-cell">{row.lecture_number}</td>
                                                        <td className="lab-number-cell">{row.lab_number}</td>
                                                        <td className="submissions-cell">{row.numberOfSubmissions}</td>
                                                        <td className="date-cell">{row.date}</td>
                                                        <td className={row.isPassing ? 'status-cell status passed' : 'status-cell status failed'}>
                                                            {row.isPassing ? 'PASSED' : 'FAILED'}
                                                        </td>
                                                        <td className="view-cell">
                                                            <Link
                                                                className="view-link"
                                                                to={`/admin/${row.classId}/project/${this.props.project_id}/codeview/${row.subid}`}
                                                                rel="noreferrer"
                                                            >
                                                                <FaEye aria-hidden="true" /> View
                                                            </Link>
                                                        </td>
                                                        <td className="download-cell">
                                                            <button
                                                                className="btn download-btn"
                                                                onClick={() => this.downloadStudentCode(row)}
                                                                aria-label="Download code"
                                                                title="Download code"
                                                            >
                                                                <FaDownload aria-hidden="true" />
                                                            </button>
                                                        </td>
                                                        <td className="grade-cell">
                                                            <input
                                                                className="grade-input"
                                                                type="text"
                                                                placeholder="optional"
                                                                value={row.grade}
                                                                onChange={(e) => this.handleGradeChange(e, row)}
                                                                disabled
                                                            />
                                                            <Link
                                                                to={`/admin/${row.classId}/project/${this.props.project_id}/grade/${row.subid}`}
                                                                className="btn grade-btn"
                                                                rel="noreferrer"
                                                            >
                                                                Grade
                                                            </Link>
                                                        </td>
                                                    </tr>
                                                )
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>

                        {this.state.plagiarismModalIsOpen && (
                            <>
                                <div
                                    className="modal-overlay"
                                    onClick={() => this.setState({ plagiarismModalIsOpen: false })}
                                    aria-hidden="true"
                                />
                                <div className="testcase-modal" role="dialog" aria-modal="true" aria-labelledby="plagiarism-modal-title">
                                    <button
                                        type="button"
                                        className="modal-close-button"
                                        aria-label="Close"
                                        onClick={() => this.setState({ plagiarismModalIsOpen: false })}
                                    >
                                        ✕
                                    </button>

                                    <div className="modal-body">
                                        <div className="modal-header">
                                            {/* Marks Code */}
                                            <div className="modal-title" id="plagiarism-modal-title">
                                                Potentially Similar Submissions ({totalResults} pairs)
                                            </div>
                                            {/* End of Marks Code */}
                                        </div>

                                        <div className="tab-content">
                                            <section className="tests-section">
                                                <div className="similar-modal-scroll">
                                                    <table className="results-table">

                                                        <thead>
                                                            <tr>
                                                                <th>Student A</th>
                                                                <th>Student B</th>
                                                                <th>Token Sim.</th>
                                                                <th>AST Sim.</th>
                                                                <th>Open</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {this.state.plagiarismResults.length === 0 && (
                                                                <tr>
                                                                    <td className="no-data-message" colSpan={5}>
                                                                        No similar pairs found (above threshold).
                                                                    </td>
                                                                </tr>
                                                            )}

                                                            {pageResults.map((p, i) => {
                                                                const pct = (v: number) => (Math.round(v * 1000) / 10).toFixed(1) + '%'
                                                                const bucketClass = (v: number) => {
                                                                    const percent = v * 100
                                                                    if (percent < 40) return 'status-cell sim-low'
                                                                    if (percent < 60) return 'status-cell sim-medlow'
                                                                    if (percent < 75) return 'status-cell sim-medium'
                                                                    if (percent < 90) return 'status-cell sim-high'
                                                                    return 'status-cell sim-critical'
                                                                }

                                                                return (
                                                                    <tr key={`plag-${i}`}>
                                                                        <td>{p.a.name}</td>
                                                                        <td>{p.b.name}</td>
                                                                        <td className={bucketClass(p.similarity_token)}>{pct(p.similarity_token)}</td>
                                                                        <td className={bucketClass(p.similarity_ast)}>{pct(p.similarity_ast)}</td>
                                                                        <td>
                                                                            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                                                                <Link
                                                                                    className="view-link"
                                                                                    to={`/admin/plagiarism/?ac=${p.a.class_id}&as=${p.a.submission_id}&bc=${p.b.class_id}&bs=${p.b.submission_id}&an=${encodeURIComponent(
                                                                                        p.a.name
                                                                                    )}&bn=${encodeURIComponent(p.b.name)}`}
                                                                                    target="_blank"
                                                                                    rel="noreferrer"
                                                                                >
                                                                                    <FaEye aria-hidden="true" /> View
                                                                                </Link>
                                                                            </div>
                                                                        </td>
                                                                    </tr>
                                                                )
                                                            })}
                                                        </tbody>
                                                    </table>
                                                </div>
                                                <div className="pagination">
                                                    <button className="page-btn" onClick={() => goToPage(currentPage - 1)} disabled={currentPage === 1}>
                                                        Prev
                                                    </button>

                                                    {Array.from({ length: totalPages }, (_, idx) => idx + 1).map((p) => (
                                                        <button
                                                            key={`page-${p}`}
                                                            className={`page-btn ${p === currentPage ? 'active' : ''}`}
                                                            onClick={() => goToPage(p)}
                                                        >
                                                            {p}
                                                        </button>
                                                    ))}

                                                    <button className="page-btn" onClick={() => goToPage(currentPage + 1)} disabled={currentPage === totalPages}>
                                                        Next
                                                    </button>
                                                </div>

                                            </section>
                                        </div>
                                    </div>
                                </div>
                            </>
                        )}
                    </>
                </div>
            </div>
        )
    }
}