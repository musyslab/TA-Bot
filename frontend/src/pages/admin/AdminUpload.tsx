import React, { Component } from 'react'
import axios from 'axios'
import { useNavigate, NavigateFunction } from 'react-router-dom'
import MenuComponent from '../components/MenuComponent'
import { Helmet } from 'react-helmet'
import DirectoryBreadcrumbs from "../components/DirectoryBreadcrumbs"
import { FaAlignJustify, FaCloudUploadAlt, FaCode, FaExchangeAlt, FaRegFile, FaTimes } from 'react-icons/fa'
import LoadingAnimation from '../components/LoadingAnimation'
import '../../styling/AdminUploadPage.scss'
import '../../styling/FileUploadCommon.scss'

interface SchoolObject {
    id: number
    name: string
}

interface Student {
    name: string
    mscsnet: string
    id: number
}

interface DropDownOption {
    key: number
    value: number
    text: string
}

interface ModuleObject {
    Id: number
    ClassId: number
    Name: string
    Start: string
    End: string
    MainProjectId: number | null
    MainProjectName: string
    TotalSubmissions: number
    CheckpointTotalSubmissions: number
    CheckpointsEnabled?: boolean
    MainCompleted?: boolean
}

interface CheckpointOption {
    id: number
    number: number
    name: string
    enabled: boolean
}

interface UploadPageState {
    files: File[]
    mainJavaFileName: string
    isLoading: boolean
    isUploading: boolean
    error_message: string
    isErrorMessageHidden: boolean
    school_id: number
    class_id: number
    module_id: number
    project_id: number
    student_id: number
    schoollist: Array<DropDownOption>
    classlist: Array<DropDownOption>
    studentList: Array<DropDownOption>
    modules: Array<DropDownOption>
    moduleMainProjectById: Record<number, number>
    moduleCheckpointsEnabledById: Record<number, boolean>
    checkpointsByProjectId: Record<number, CheckpointOption[]>
    selectedCheckpointId: number
}

interface AdminUploadPageProps {
    navigate: NavigateFunction
}

const AdminUploadPageWrapper: React.FC = () => {
    const navigate = useNavigate()
    return <AdminUploadPage navigate={navigate} />
}

class AdminUpload extends Component<{}, {}> {
    render() {
        return (
            <div className="admin-upload-root">
                <Helmet>
                    <title>[Admin] MAAT</title>
                </Helmet>

                <MenuComponent
                    showUpload={false}
                    showAdminUpload={true}
                    showHelp={false}
                    showCreate={false}
                    showLast={false}
                    showReviewButton={false}
                />

                <div className="main-grid admin-upload-grid">
                    <div className="admin-upload-center">
                        <AdminUploadPageWrapper />
                    </div>
                </div>
            </div>
        )
    }
}

class AdminUploadPage extends Component<AdminUploadPageProps, UploadPageState> {
    private static readonly JAVA_MAIN_RE = /\bpublic\s+static\s+void\s+main\s*\(/
    private static isJavaFileName = (n: string) => /\.java$/i.test(n)

    private static pickMainJavaFile(allJavaNames: string[], namesWithMain: string[]): string {
        if (namesWithMain.length === 1) return namesWithMain[0]
        const mainDotJava = allJavaNames.find((n) => n.toLowerCase() === 'main.java')
        if (mainDotJava) return mainDotJava
        return namesWithMain[0] || ''
    }

    private async computeMainJavaFromLocal(localFiles: File[]): Promise<string> {
        const javaFiles = localFiles.filter((f) => AdminUploadPage.isJavaFileName(f.name))
        if (javaFiles.length <= 1) return ''

        const withMain: string[] = []

        for (const f of javaFiles) {
            try {
                const txt = await f.text()
                if (AdminUploadPage.JAVA_MAIN_RE.test(txt)) withMain.push(f.name)
            } catch {
                // ignore read failures
            }
        }

        return AdminUploadPage.pickMainJavaFile(
            javaFiles.map((f) => f.name),
            withMain
        )
    }

    constructor(props: AdminUploadPageProps) {
        super(props)
        this.state = {
            isLoading: false,
            isUploading: false,
            error_message: '',
            isErrorMessageHidden: true,
            school_id: 0,
            class_id: 0,
            module_id: 0,
            project_id: 0,
            student_id: 0,
            schoollist: [],
            classlist: [],
            studentList: [],
            modules: [],
            moduleMainProjectById: {},
            moduleCheckpointsEnabledById: {},
            checkpointsByProjectId: {},
            selectedCheckpointId: 0,
            files: [],
            mainJavaFileName: '',
        }

        this.handleSubmit = this.handleSubmit.bind(this)
        this.handleSchoolIdChange = this.handleSchoolIdChange.bind(this)
        this.handleClassIdChange = this.handleClassIdChange.bind(this)
        this.handleStudentIdChange = this.handleStudentIdChange.bind(this)
        this.handleModuleIdChange = this.handleModuleIdChange.bind(this)
        this.handleFilesChange = this.handleFilesChange.bind(this)
    }

    private authHeaders() {
        return {
            Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}`,
        }
    }

    private clearError() {
        this.setState({
            error_message: '',
            isErrorMessageHidden: true,
        })
    }

    private setError(message: string) {
        this.setState({
            error_message: message,
            isErrorMessageHidden: false,
        })
    }

    private resetFromSchoolDown(nextSchoolId: number) {
        this.setState({
            school_id: nextSchoolId,
            class_id: 0,
            module_id: 0,
            project_id: 0,
            student_id: 0,
            classlist: [],
            studentList: [],
            modules: [],
            moduleMainProjectById: {},
            moduleCheckpointsEnabledById: {},
            checkpointsByProjectId: {},
            selectedCheckpointId: 0,
            files: [],
            mainJavaFileName: '',
            isUploading: false,
        })
    }

    private resetFromClassDown(nextClassId: number) {
        this.setState({
            class_id: nextClassId,
            module_id: 0,
            project_id: 0,
            student_id: 0,
            studentList: [],
            modules: [],
            moduleMainProjectById: {},
            moduleCheckpointsEnabledById: {},
            checkpointsByProjectId: {},
            selectedCheckpointId: 0,
            files: [],
            mainJavaFileName: '',
            isUploading: false,
        })
    }

    private resetFromStudentDown(nextStudentId: number) {
        this.setState({
            student_id: nextStudentId,
            module_id: 0,
            project_id: 0,
            selectedCheckpointId: 0,
            files: [],
            mainJavaFileName: '',
            isUploading: false,
        })
    }

    private async loadSchools() {
        this.setState({ isLoading: true })
        this.clearError()

        try {
            const res = await axios.get(import.meta.env.VITE_API_URL + `/schools/all`, {
                headers: this.authHeaders(),
            })

            const schools = res.data as Array<SchoolObject>
            const schoolsDropdown: Array<DropDownOption> = schools
                .map((s) => ({
                    key: Number(s.id),
                    text: String(s.name),
                    value: Number(s.id),
                }))
                .filter((s) => s.value > 0 && s.text)
                .sort((a, b) => a.text.localeCompare(b.text))

            this.setState({ schoollist: schoolsDropdown })
        } catch (err: any) {
            this.setError(err.response?.data?.message ?? 'Error loading schools')
        } finally {
            this.setState({ isLoading: false })
        }
    }

    private async loadClassesForSchool(schoolId: number) {
        if (!(schoolId > 0)) return

        this.setState({ isLoading: true })
        this.clearError()

        try {
            const res = await axios.get(
                import.meta.env.VITE_API_URL + `/class/all?school_id=${schoolId}`,
                { headers: this.authHeaders() }
            )

            const classes = Array.isArray(res.data?.classes) ? res.data.classes : res.data
            const classesDropdown: Array<DropDownOption> = (classes || [])
                .map((c: any) => ({
                    key: Number(c.id ?? c.Id),
                    text: String(c.name ?? c.Name ?? ''),
                    value: Number(c.id ?? c.Id),
                }))
                .filter((c: DropDownOption) => c.value > 0 && c.text)
                .sort((a: DropDownOption, b: DropDownOption) => a.text.localeCompare(b.text))

            this.setState({ classlist: classesDropdown })
        } catch (err: any) {
            this.setError(err.response?.data?.message ?? 'Error loading classes')
        } finally {
            this.setState({ isLoading: false })
        }
    }

    private async loadStudentsForClass(classId: number) {
        if (!(classId > 0)) return

        try {
            const res = await axios.get(
                import.meta.env.VITE_API_URL + `/upload/total_students_by_cid?class_id=${classId}`,
                { headers: this.authHeaders() }
            )

            const students = res.data as Array<Student>

            const lastNameOf = (full: string) => {
                const n = (full || '').trim()
                if (!n) return ''
                if (n.includes(',')) return n.split(',')[0]!.trim()
                const parts = n.split(/\s+/)
                return parts[parts.length - 1]!
            }

            const isTestStudent = (name: string) => (name || '').trim().toLowerCase() === 'test student'

            const sorted = [...students].sort((a, b) => {
                const aTest = isTestStudent(a.name)
                const bTest = isTestStudent(b.name)

                if (aTest && !bTest) return -1
                if (!aTest && bTest) return 1

                const lnCmp = lastNameOf(a.name).localeCompare(lastNameOf(b.name), undefined, { sensitivity: 'base' })
                if (lnCmp !== 0) return lnCmp

                const nameCmp = (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' })
                if (nameCmp !== 0) return nameCmp

                return a.id - b.id
            })

            const studentsDropdown: Array<DropDownOption> = sorted.map((s) => ({
                key: s.id,
                text: `${s.name} (${s.mscsnet})`,
                value: s.id,
            }))

            this.setState({ studentList: studentsDropdown })
        } catch (err: any) {
            this.setError(err.response?.data?.message ?? 'Error loading students')
        }
    }

    private async loadModulesForClass(classId: number) {
        if (!(classId > 0)) return

        try {
            const res = await axios.get(
                import.meta.env.VITE_API_URL + `/projects/get_modules_by_class_id?id=${classId}`,
                { headers: this.authHeaders() }
            )

            const modules = res.data as Array<ModuleObject>

            const moduleDropdown: Array<DropDownOption> = modules
                .filter((m) => Number(m.MainProjectId ?? 0) > 0)
                .map((m) => ({
                    key: Number(m.Id),
                    text: String(m.Name),
                    value: Number(m.Id),
                }))
                .sort((a, b) => a.text.localeCompare(b.text))

            const mainProjectMap: Record<number, number> = {}
            const checkpointsEnabledMap: Record<number, boolean> = {}

            for (const moduleObj of modules) {
                const moduleId = Number(moduleObj.Id)
                const mainProjectId = Number(moduleObj.MainProjectId ?? 0)

                if (moduleId > 0 && mainProjectId > 0) {
                    mainProjectMap[moduleId] = mainProjectId
                    checkpointsEnabledMap[moduleId] = moduleObj.CheckpointsEnabled !== false
                }
            }

            this.setState({
                modules: moduleDropdown,
                moduleMainProjectById: mainProjectMap,
                moduleCheckpointsEnabledById: checkpointsEnabledMap,
            })
        } catch (err: any) {
            this.setError(err.response?.data?.message ?? 'Error loading modules')
        }
    }

    private async loadCheckpointsForProject(projectId: number) {
        if (!(projectId > 0)) return

        try {
            const res = await axios.get(
                import.meta.env.VITE_API_URL + `/projects/list_checkpoints?project_id=${projectId}`,
                { headers: this.authHeaders() }
            )

            const problems = Array.isArray(res.data?.problems) ? res.data.problems : []

            const rows: CheckpointOption[] = problems.map((checkpoint: any, idx: number) => ({
                id: Number(checkpoint?.id),
                number: Number(checkpoint?.number ?? idx + 1),
                name: String(checkpoint?.name ?? `Checkpoint ${idx + 1}`),
                enabled: checkpoint?.enabled !== false,
            }))

            this.setState((prev) => ({
                checkpointsByProjectId: {
                    ...prev.checkpointsByProjectId,
                    [projectId]: rows,
                },
            }))
        } catch {
            this.setState((prev) => ({
                checkpointsByProjectId: {
                    ...prev.checkpointsByProjectId,
                    [projectId]: [],
                },
            }))
        }
    }

    componentDidMount() {
        this.loadSchools()
    }

    handleSchoolIdChange(e: React.ChangeEvent<HTMLSelectElement>) {
        const value = parseInt(e.target.value, 10)
        const schoolId = Number.isNaN(value) ? 0 : value

        this.resetFromSchoolDown(schoolId)

        if (schoolId > 0) {
            this.loadClassesForSchool(schoolId)
        }
    }

    handleClassIdChange(e: React.ChangeEvent<HTMLSelectElement>) {
        const value = parseInt(e.target.value, 10)
        const classId = Number.isNaN(value) ? 0 : value

        this.resetFromClassDown(classId)

        if (!(classId > 0)) return

        this.setState({ isLoading: true })
        this.clearError()

        Promise.all([
            this.loadStudentsForClass(classId),
            this.loadModulesForClass(classId),
        ]).finally(() => {
            this.setState({ isLoading: false })
        })
    }

    handleStudentIdChange(e: React.ChangeEvent<HTMLSelectElement>) {
        const value = parseInt(e.target.value, 10)
        this.resetFromStudentDown(Number.isNaN(value) ? 0 : value)
    }

    handleModuleIdChange(e: React.ChangeEvent<HTMLSelectElement>) {
        const value = parseInt(e.target.value, 10)
        const nextModuleId = Number.isNaN(value) ? 0 : value
        const nextProjectId = this.state.moduleMainProjectById[nextModuleId] ?? 0

        this.setState(
            {
                module_id: nextModuleId,
                project_id: nextProjectId,
                selectedCheckpointId: 0,
                files: [],
                mainJavaFileName: '',
            },
            () => {
                if (
                    nextProjectId > 0 &&
                    this.state.moduleCheckpointsEnabledById[nextModuleId] !== false
                ) {
                    this.loadCheckpointsForProject(nextProjectId)
                }
            }
        )
    }

    private getFileIcon(filename: string): React.ReactElement {
        const CODE_ICON_RE = /\.(java|py|c|h|rkt|scm)$/i
        const TEXT_ICON_RE = /\.(txt|doc|docx|pdf)$/i

        if (CODE_ICON_RE.test(filename)) return <FaCode className="file-language-icon" aria-hidden="true" />
        if (TEXT_ICON_RE.test(filename)) return <FaAlignJustify className="file-language-icon" aria-hidden="true" />
        return <FaTimes className="file-language-icon" aria-hidden="true" />
    }

    handleFilesChange(e: React.ChangeEvent<HTMLInputElement>) {
        const files = e.target.files
        const fileArr = files ? Array.from(files) : []

        const isJavaFile = (f: File) => f.name.toLowerCase().endsWith('.java')

        if (fileArr.length > 1 && fileArr.every((f) => !isJavaFile(f))) {
            this.setState({
                files: [],
                mainJavaFileName: '',
                isErrorMessageHidden: false,
                error_message: 'Multi-file upload is only available for Java (.java) files.',
            })
            return
        }

        this.setState({
            files: fileArr,
            mainJavaFileName: '',
            isErrorMessageHidden: true,
        })

        if (fileArr.length > 1 && fileArr.every(isJavaFile)) {
            this.computeMainJavaFromLocal(fileArr)
                .then((main) => this.setState({ mainJavaFileName: main }))
                .catch(() => this.setState({ mainJavaFileName: '' }))
        }
    }

    handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault()

        const uploadDisabled =
            this.state.isLoading ||
            !(this.state.school_id > 0) ||
            !(this.state.class_id > 0) ||
            !(this.state.student_id > 0) ||
            !(this.state.module_id > 0) ||
            !(this.state.project_id > 0)

        if (uploadDisabled) {
            this.setState({
                isErrorMessageHidden: false,
                error_message: 'Please select a school, class, student, and module before uploading.',
            })
            return
        }

        const isJavaFile = (f: File) => f.name.toLowerCase().endsWith('.java')

        if (this.state.files.length > 1 && this.state.files.every((f) => !isJavaFile(f))) {
            this.setState({
                files: [],
                isErrorMessageHidden: false,
                error_message: 'Multi-file upload is only available for Java (.java) files.',
            })
            return
        }

        if (this.state.files.length === 0) {
            this.setState({
                isErrorMessageHidden: false,
                error_message: 'Please choose one or more files to upload.',
            })
            return
        }

        this.setState({ isErrorMessageHidden: true, isLoading: true, isUploading: true })

        const formData = new FormData()
        this.state.files.forEach((f) => formData.append('files', f, f.name))
        formData.append('student_id', String(this.state.student_id))
        formData.append('project_id', String(this.state.project_id))
        formData.append('class_id', String(this.state.class_id))

        const isCheckpoint = this.state.selectedCheckpointId > 0
        formData.append('checkpoint', isCheckpoint ? '1' : '0')

        if (isCheckpoint) {
            formData.append('checkpoint_id', String(this.state.selectedCheckpointId))
        }

        axios
            .post(import.meta.env.VITE_API_URL + `/upload/`, formData, {
                headers: this.authHeaders(),
            })
            .then((res) => {
                const checkpointQuery = isCheckpoint
                    ? `?checkpoint=1&checkpoint_id=${this.state.selectedCheckpointId.toString()}`
                    : ''

                const codeViewBase = isCheckpoint
                    ? `/admin/school/${this.state.school_id.toString()}` +
                    `/class/${this.state.class_id.toString()}` +
                    `/module/${this.state.module_id.toString()}` +
                    `/project/${this.state.project_id.toString()}` +
                    `/checkpoint/${this.state.selectedCheckpointId.toString()}` +
                    `/codeview/${res.data.sid.toString()}`
                    : `/admin/school/${this.state.school_id.toString()}` +
                    `/class/${this.state.class_id.toString()}` +
                    `/module/${this.state.module_id.toString()}` +
                    `/project/${this.state.project_id.toString()}` +
                    `/codeview/${res.data.sid.toString()}`

                window.location.href = `${codeViewBase}${checkpointQuery}${checkpointQuery ? '&' : '?'}from=admin-upload`
            })
            .catch((err) => {
                this.setState({
                    error_message: err.response?.data?.message ?? 'Upload failed',
                    isErrorMessageHidden: false,
                    isLoading: false,
                    isUploading: false,
                })
            })
    }

    render() {
        const schoolChosen = this.state.school_id > 0
        const classChosen = this.state.class_id > 0
        const studentChosen = this.state.student_id > 0
        const moduleChosen = this.state.module_id > 0
        const projectChosen = this.state.project_id > 0

        const disableSchool = this.state.isLoading || this.state.schoollist.length === 0
        const disableClass = !schoolChosen || this.state.isLoading || this.state.classlist.length === 0
        const disableStudent = !classChosen || this.state.isLoading || this.state.studentList.length === 0
        const disableModule = !studentChosen || this.state.isLoading || this.state.modules.length === 0
        const disableUpload = !moduleChosen || !projectChosen || !studentChosen || this.state.isLoading

        const checkpointsEnabledForModule =
            moduleChosen && this.state.moduleCheckpointsEnabledById[this.state.module_id] !== false

        const checkpointRows = checkpointsEnabledForModule && projectChosen
            ? this.state.checkpointsByProjectId[this.state.project_id] ?? []
            : []

        const enabledCheckpointRows = checkpointRows.filter((checkpoint) => !!checkpoint.enabled)

        return (
            <>
                <LoadingAnimation show={this.state.isUploading} message="Uploading..." />

                <DirectoryBreadcrumbs
                    items={[
                        { label: 'School Selection', to: '/admin/schools' },
                        { label: 'Admin Upload' },
                    ]}
                />

                <div className="pageTitle">Admin Upload</div>

                <div className="admin-upload-stack">
                    <div className="admin-upload-page">
                        <p className="section-label">Please select a school</p>
                        <select
                            className="select school-select"
                            value={this.state.school_id || ''}
                            onChange={this.handleSchoolIdChange}
                            disabled={disableSchool}
                        >
                            <option value="" disabled>
                                Select school
                            </option>
                            {this.state.schoollist.map((opt) => (
                                <option key={opt.key} value={opt.value}>
                                    {opt.text}
                                </option>
                            ))}
                        </select>

                        <div className="selection-section">
                            <div className="spacer" aria-hidden="true">
                                &nbsp;
                            </div>

                            <p className="section-label">Please select a class</p>
                            <select
                                className="select class-select"
                                value={this.state.class_id || ''}
                                onChange={this.handleClassIdChange}
                                disabled={disableClass}
                            >
                                <option value="" disabled>
                                    Select class
                                </option>
                                {this.state.classlist.map((opt) => (
                                    <option key={opt.key} value={opt.value}>
                                        {opt.text}
                                    </option>
                                ))}
                            </select>

                            <div className="spacer" aria-hidden="true">
                                &nbsp;
                            </div>

                            <p className="section-label">Please select a student</p>
                            <select
                                className="select student-select"
                                value={this.state.student_id || ''}
                                onChange={this.handleStudentIdChange}
                                disabled={disableStudent}
                            >
                                <option value="" disabled>
                                    Select student
                                </option>
                                {this.state.studentList.map((opt) => (
                                    <option key={opt.key} value={opt.value}>
                                        {opt.text}
                                    </option>
                                ))}
                            </select>

                            <div className="spacer" aria-hidden="true">
                                &nbsp;
                            </div>

                            <p className="section-label">Please select a module</p>
                            <select
                                className="select module-select"
                                value={this.state.module_id || ''}
                                onChange={this.handleModuleIdChange}
                                disabled={disableModule}
                            >
                                <option value="" disabled>
                                    Select module
                                </option>
                                {this.state.modules.map((opt) => (
                                    <option key={opt.key} value={opt.value}>
                                        {opt.text}
                                    </option>
                                ))}
                            </select>

                            {moduleChosen && (
                                <>
                                    <div className="spacer" aria-hidden="true">
                                        &nbsp;
                                    </div>

                                    <p className="section-label">Submit to</p>
                                    <select
                                        className="select checkpoint-target-select"
                                        value={
                                            this.state.selectedCheckpointId > 0
                                                ? `checkpoint:${this.state.selectedCheckpointId}`
                                                : 'main'
                                        }
                                        onChange={(e) => {
                                            const v = e.target.value || 'main'

                                            if (v === 'main') {
                                                this.setState({
                                                    selectedCheckpointId: 0,
                                                    files: [],
                                                    mainJavaFileName: '',
                                                })
                                                return
                                            }

                                            if (v.startsWith('checkpoint:')) {
                                                const idStr = v.split(':', 2)[1] || ''
                                                const checkpointId = parseInt(idStr, 10)

                                                this.setState({
                                                    selectedCheckpointId: Number.isNaN(checkpointId) ? 0 : checkpointId,
                                                    files: [],
                                                    mainJavaFileName: '',
                                                })
                                            }
                                        }}
                                        disabled={this.state.isLoading}
                                    >
                                        <option value="main">Main Problem</option>
                                        {enabledCheckpointRows.map((checkpoint) => (
                                            <option key={checkpoint.id} value={`checkpoint:${checkpoint.id}`}>
                                                {`Checkpoint ${checkpoint.number}: ${checkpoint.name}`}
                                            </option>
                                        ))}
                                    </select>
                                </>
                            )}

                            <div className="spacer" aria-hidden="true">
                                &nbsp;
                            </div>

                            <form className="upload-form" onSubmit={this.handleSubmit}>
                                <h1 className="upload-title">Upload Assignment</h1>

                                <div className="file-section">
                                    <div className="info-segment">
                                        <div
                                            className={`file-drop-area${disableUpload ? ' is-disabled' : ''}`}
                                            aria-disabled={disableUpload}
                                            onDragOver={(e) => {
                                                e.preventDefault()
                                            }}
                                            onDrop={(e) => {
                                                e.preventDefault()

                                                if (disableUpload) return

                                                const files = e.dataTransfer.files
                                                if (files && files.length > 0) {
                                                    this.handleFilesChange({ target: { files } } as any)
                                                }
                                            }}
                                        >
                                            {this.state.files.length === 0 ? (
                                                <>
                                                    <input
                                                        type="file"
                                                        className="file-input"
                                                        required
                                                        multiple
                                                        onChange={this.handleFilesChange}
                                                        disabled={disableUpload}
                                                    />
                                                    <div className="file-drop-content">
                                                        <FaCloudUploadAlt className="file-drop-cloud-icon" aria-hidden="true" />
                                                        <div className="file-drop-message">
                                                            Drag &amp; drop your file here or{' '}
                                                            <span className="browse-text">browse</span>
                                                        </div>
                                                    </div>
                                                </>
                                            ) : (
                                                <div className={`file-preview${disableUpload ? ' is-disabled' : ''}`}>
                                                    <button
                                                        type="button"
                                                        className="exchange-icon"
                                                        onClick={() => this.setState({ files: [], mainJavaFileName: '' })}
                                                        aria-label="Clear selected files"
                                                        title="Clear selected files"
                                                        disabled={disableUpload}
                                                    >
                                                        <FaExchangeAlt aria-hidden="true" />
                                                    </button>

                                                    <div className="file-preview-list" title="Selected files">
                                                        {(() => {
                                                            const isJavaFile = (f: File) => f.name.toLowerCase().endsWith('.java')
                                                            const showMainTag =
                                                                this.state.files.length > 1 &&
                                                                this.state.files.every(isJavaFile) &&
                                                                !!this.state.mainJavaFileName

                                                            return this.state.files.map((f) => (
                                                                <div key={f.name} className="file-preview-row solution-file-card">
                                                                    <span className="file-icon-wrapper" aria-hidden="true">
                                                                        <FaRegFile className="file-outline-icon" aria-hidden="true" />
                                                                        {this.getFileIcon(f.name)}
                                                                    </span>
                                                                    <span className="file-name">
                                                                        {f.name}
                                                                        {showMainTag && f.name === this.state.mainJavaFileName && (
                                                                            <span className="main-indicator">Main</span>
                                                                        )}
                                                                    </span>
                                                                </div>
                                                            ))
                                                        })()}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <div className="spacer" aria-hidden="true">
                                    &nbsp;
                                </div>

                                <button
                                    className="button upload-button"
                                    type="submit"
                                    disabled={disableUpload || this.state.isLoading || this.state.isUploading}
                                >
                                    {this.state.isUploading ? 'Uploading…' : 'Upload'}
                                </button>
                            </form>

                            {!this.state.isErrorMessageHidden && (
                                <p className="error-message" role="alert">
                                    {this.state.error_message}
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            </>
        )
    }
}

export default AdminUpload