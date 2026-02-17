import React, { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { Helmet } from 'react-helmet'
import { useNavigate, useParams } from 'react-router-dom'

import MenuComponent from '../components/MenuComponent'
import DirectoryBreadcrumbs from '../components/DirectoryBreadcrumbs'
import LoadingAnimation from '../components/LoadingAnimation'

import '../../styling/AdminProjectManage.scss'
import '../../styling/FileUploadCommon.scss'

import { FaCircleNotch, FaDownload, FaEdit, FaPlusCircle, FaTimes, FaUpload } from 'react-icons/fa'

class Testcase {
    constructor() {
        this.id = 0
        this.name = ''
        this.description = ''
        this.input = ''
        this.output = ''
        this.hidden = false
    }

    id: number
    name: string
    description: string
    input: string
    output: string
    hidden: boolean
}

const AdminPracticeProblemsManage = () => {
    const { id, class_id } = useParams()
    const navigate = useNavigate()

    const project_id = Number(id)
    const classId = Number(class_id)

    if (Number.isNaN(project_id) || Number.isNaN(classId)) {
        return <div>Error: Missing or invalid project or class ID.</div>
    }

    const API = import.meta.env.VITE_API_URL
    const authHeader = { Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}` }

    const [ProjectName, setProjectName] = useState<string>('')
    const [ProjectStart, setProjectStart] = useState<Date | null>(null)
    const [ProjectEnd, setProjectEnd] = useState<Date | null>(null)
    const [ProjectLanguage, setProjectLanguage] = useState<string>('')

    const [testcases, setTestcases] = useState<Array<Testcase>>([])
    const [modalOpen, setModalOpen] = useState<boolean>(false)
    const [selectedTestCaseId, setSelectedTestCaseId] = useState<number>(-1)
    const [modalDraft, setModalDraft] = useState<Testcase | null>(null)

    const [jsonfilename, setjsonfilename] = useState<string>('')
    const [JsonFile, setJsonFile] = useState<File | undefined>(undefined)

    const [submittingTestcase, setSubmittingTestcase] = useState<boolean>(false)
    const [submittingJson, setSubmittingJson] = useState<boolean>(false)
    const [loading, setLoading] = useState<boolean>(false)

    const parseHidden = (v: any): boolean => {
        if (typeof v === 'boolean') return v
        if (typeof v === 'number') return v !== 0
        if (typeof v === 'string') {
            const s = v.trim().toLowerCase()
            return s === '1' || s === 'true' || s === 'yes' || s === 'y' || s === 'on'
        }
        return false
    }

    const formatDate12h = (value: Date | null): string => {
        if (!value) return ''
        return new Intl.DateTimeFormat('en-US', {
            year: 'numeric',
            month: 'short',
            day: '2-digit',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
        }).format(value)
    }

    const languageLabel = useMemo(() => {
        if (!ProjectLanguage) return 'Not detected yet'
        if (ProjectLanguage === 'java') return 'Java'
        if (ProjectLanguage === 'python') return 'Python'
        if (ProjectLanguage === 'c') return 'C'
        if (ProjectLanguage === 'racket') return 'Racket'
        return ProjectLanguage
    }, [ProjectLanguage])

    async function loadProjectInfo() {
        const res = await axios.get(`${API}/projects/get_project_id?id=${project_id}`, {
            headers: authHeader,
        })
        const data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data
        const row = data?.[project_id]
        if (!row) return

        setProjectName(row[0] ?? '')
        setProjectStart(row[1] ? new Date(row[1]) : null)
        setProjectEnd(row[2] ? new Date(row[2]) : null)
        setProjectLanguage(row[3] ?? '')
    }

    async function reloadPracticeTests() {
        const res = await axios.get(`${API}/projects/get_testcases?id=${project_id}&practice=1`, {
            headers: authHeader,
        })

        const data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data
        const rows: Array<Testcase> = []

        Object.entries(data || {}).forEach(([key, value]) => {
            const testcase = new Testcase()
            const values = value as Array<any>

            testcase.id = parseInt(key, 10)
            testcase.name = values[1] ?? ''
            testcase.description = values[2] ?? ''
            testcase.input = values[3] ?? ''
            testcase.output = values[4] ?? ''
            testcase.hidden = parseHidden(values[5])

            rows.push(testcase)
        })

        setTestcases(rows)
    }

    useEffect(() => {
        let cancelled = false
        ;(async () => {
            try {
                setLoading(true)
                await loadProjectInfo()
                await reloadPracticeTests()
            } catch (e) {
                console.log(e)
            } finally {
                if (!cancelled) setLoading(false)
            }
        })()
        return () => {
            cancelled = true
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [project_id])

    function handleOpenModal(testCaseId: number) {
        setModalOpen(true)
        setSelectedTestCaseId(testCaseId)

        if (testCaseId === -1) {
            const t = new Testcase()
            t.id = -1
            setModalDraft(t)
            return
        }
        const source = testcases.find(tc => tc.id === testCaseId)
        setModalDraft(source ? ({ ...source } as Testcase) : null)
    }

    function handleNameChange(testcase_id: number, name: string) {
        setModalDraft(prev => {
            if (prev && prev.id === testcase_id) return { ...prev, name }
            return prev
        })
    }

    function handleDescriptionChange(testcase_id: number, description: string) {
        setModalDraft(prev => {
            if (prev && prev.id === testcase_id) return { ...prev, description }
            return prev
        })
    }

    function handleInputChange(testcase_id: number, input: string) {
        setModalDraft(prev => {
            if (prev && prev.id === testcase_id) return { ...prev, input }
            return prev
        })
    }

    function handleHiddenChange(testcase_id: number, hidden: boolean) {
        setModalDraft(prev => {
            if (prev && prev.id === testcase_id) return { ...prev, hidden }
            return prev
        })
    }

    async function submitTestcase(testcaseId: number) {
        if (!modalDraft) return

        if (!modalDraft.name || !modalDraft.input || !modalDraft.description) {
            window.alert('Please fill out all fields')
            return
        }

        const formData = new FormData()
        formData.append('id', String(modalDraft.id))
        formData.append('name', modalDraft.name)
        formData.append('project_id', String(project_id))
        formData.append('class_id', String(classId))
        formData.append('input', modalDraft.input)
        formData.append('output', modalDraft.output || '')
        formData.append('description', modalDraft.description)
        formData.append('hidden', modalDraft.hidden ? 'true' : 'false')
        formData.append('practice', 'true')

        try {
            setSubmittingTestcase(true)
            await axios.post(`${API}/projects/add_or_update_testcase`, formData, {
                headers: authHeader,
            })
            await reloadPracticeTests()
            setModalOpen(false)
            setModalDraft(null)
        } catch (e) {
            console.log(e)
            window.alert('Could not save practice problem.')
        } finally {
            setSubmittingTestcase(false)
        }
    }

    async function removeTestcase(testcaseId: number) {
        try {
            const formData = new FormData()
            formData.append('id', String(testcaseId))
            await axios.post(`${API}/projects/remove_testcase`, formData, {
                headers: authHeader,
            })
            await reloadPracticeTests()
        } catch (e) {
            console.log(e)
            window.alert('Could not remove practice problem.')
        } finally {
            setModalOpen(false)
            setModalDraft(null)
        }
    }

    async function setHiddenFromRow(tc: Testcase, hidden: boolean) {
        const formData = new FormData()
        formData.append('id', String(tc.id))
        formData.append('name', tc.name)
        formData.append('project_id', String(project_id))
        formData.append('class_id', String(classId))
        formData.append('input', tc.input)
        formData.append('output', tc.output || '')
        formData.append('description', tc.description)
        formData.append('hidden', hidden ? 'true' : 'false')
        formData.append('practice', 'true')

        try {
            setSubmittingTestcase(true)
            await axios.post(`${API}/projects/add_or_update_testcase`, formData, {
                headers: authHeader,
            })
            await reloadPracticeTests()
        } catch (e) {
            console.log(e)
        } finally {
            setSubmittingTestcase(false)
        }
    }

    function exportPracticeJson() {
        const rows = testcases.map(tc => ({
            name: tc.name,
            description: tc.description,
            input: tc.input,
            output: tc.output,
            hidden: !!tc.hidden,
            practice: true,
        }))
        const fileContent = JSON.stringify(rows, null, 2)
        const fileName = `${ProjectName || 'practice_problems'}.practice.json`
        const blob = new Blob([fileContent], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = fileName
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)
    }

    function handleJsonFileChange(event: React.FormEvent) {
        const target = event.target as HTMLInputElement
        const files = target.files

        if (files != null && files.length === 1) {
            if (!/\.json$/i.test(files[0].name)) {
                window.alert('Practice problem upload must be a JSON file (.json).')
                target.value = ''
                setJsonFile(undefined)
                setjsonfilename('')
                return
            }
            setJsonFile(files[0])
            setjsonfilename(files[0].name)
        } else {
            setJsonFile(undefined)
        }
    }

    async function handleJsonSubmit() {
        if (!JsonFile) return
        try {
            setSubmittingJson(true)
            const formData = new FormData()
            formData.append('file', JsonFile)
            formData.append('project_id', String(project_id))
            formData.append('class_id', String(classId))
            formData.append('practice', 'true')

            await axios.post(`${API}/projects/json_add_testcases`, formData, {
                headers: authHeader,
            })

            await reloadPracticeTests()

            setjsonfilename('')
            const jsonInput = document.getElementById('practiceJsonFile') as HTMLInputElement | null
            if (jsonInput) jsonInput.value = ''
        } catch (e) {
            console.log(e)
            window.alert('Could not upload practice problems JSON.')
        } finally {
            setSubmittingJson(false)
        }
    }

    const showFullScreenLoader = loading || submittingTestcase || submittingJson
    const loaderMessage =
        (loading && 'Loading...') ||
        (submittingTestcase && 'Submitting practice problem...') ||
        (submittingJson && 'Uploading practice problems...') ||
        'Loading...'

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
                    { label: 'Project List', to: `/admin/${classId}/projects/` },
                    { label: 'Practice Problems' },
                ]}
            />

            <div className="main-grid">
                <div className={`admin-project-config-container${modalOpen ? ' blurred' : ''}`}>
                    <div className="pageTitle">Practice Problems</div>

                    <div className="info-segment">
                        <h1 className="info-title">Assignment Info (prefilled)</h1>

                        <div className="form-project-settings">
                            <div className="segment-main">
                                <div className="form-field input-field">
                                    <label>Project Name</label>
                                    <input type="text" value={ProjectName} readOnly aria-readonly="true" />
                                </div>

                                <div className="form-group date-range-group">
                                    <div className="form-field input-field">
                                        <label>Start Date</label>
                                        <input type="text" value={formatDate12h(ProjectStart)} readOnly aria-readonly="true" />
                                    </div>

                                    <div className="form-field input-field">
                                        <label>End Date</label>
                                        <input type="text" value={formatDate12h(ProjectEnd)} readOnly aria-readonly="true" />
                                    </div>
                                </div>

                                <div className="form-group language-group">
                                    <label>Language</label>
                                    <div className="detected-language">{languageLabel}</div>
                                </div>

                                <button
                                    type="button"
                                    className="submit-button"
                                    onClick={() => navigate(`/admin/${classId}/project/manage/${project_id}`)}
                                >
                                    Back to assignment settings
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="pane-testcases">
                        <div className="testcase-management-group">
                            <div className="form-testcases-overview">
                                <table className="testcases-table">
                                    <thead>
                                        <tr>
                                            <th>Name</th>
                                            <th>Input</th>
                                            <th>Output</th>
                                            <th>Description</th>
                                            <th>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {testcases.map(tc => (
                                            <tr
                                                key={tc.id}
                                                className={tc.hidden ? 'hidden-testcase' : undefined}
                                                aria-label={tc.hidden ? 'Hidden practice problem' : undefined}
                                            >
                                                <td>{tc.name}</td>
                                                <td>
                                                    <pre className="testcase-input">{tc.input}</pre>
                                                </td>
                                                <td>
                                                    <pre className="testcase-output">{tc.output}</pre>
                                                </td>
                                                <td>{tc.description}</td>
                                                <td>
                                                    <button
                                                        type="button"
                                                        className="testcase-edit-button"
                                                        onClick={() => handleOpenModal(tc.id)}
                                                    >
                                                        <FaEdit aria-hidden="true" /> Edit
                                                    </button>

                                                    <div className="testcase-hidden-toggle">
                                                        <span className="toggle-label">Hidden</span>
                                                        <label className="switch">
                                                            <input
                                                                type="checkbox"
                                                                checked={!!tc.hidden}
                                                                onChange={e => setHiddenFromRow(tc, e.currentTarget.checked)}
                                                                aria-label="Toggle hidden practice problem"
                                                            />
                                                            <span className="slider" aria-hidden="true" />
                                                        </label>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}

                                        <tr>
                                            <td colSpan={6} className="add-row-cell">
                                                <button
                                                    type="button"
                                                    className="add-testcase-button"
                                                    onClick={() => handleOpenModal(-1)}
                                                >
                                                    <FaPlusCircle aria-hidden="true" /> Add Practice Problem
                                                </button>
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>

                            <div className="export-json-segment">
                                <button type="button" className="export-json-button" onClick={exportPracticeJson}>
                                    <FaDownload aria-hidden="true" /> Export practice problems to JSON
                                </button>
                            </div>

                            <div className="or-separator">
                                <span>or</span>
                            </div>

                            <div className="upload-testcases-segment">
                                <h1 className="upload-title">Upload Practice Problems</h1>
                                <div className="file-drop-area" onDragOver={e => e.preventDefault()}>
                                    {!jsonfilename ? (
                                        <>
                                            <input
                                                id="practiceJsonFile"
                                                type="file"
                                                className="file-input"
                                                accept=".json,application/json"
                                                onChange={handleJsonFileChange}
                                            />
                                            <div className="file-drop-message">
                                                Drag &amp; drop your JSON file here or&nbsp;
                                                <span className="browse-text">browse</span>
                                            </div>
                                        </>
                                    ) : (
                                        <div className="file-preview json-file-preview">
                                            <span className="file-name">{jsonfilename}</span>
                                            <button
                                                type="button"
                                                className="exchange-icon"
                                                onClick={() => {
                                                    setjsonfilename('')
                                                    setJsonFile(undefined)
                                                    const jsonInput = document.getElementById('practiceJsonFile') as HTMLInputElement | null
                                                    if (jsonInput) jsonInput.value = ''
                                                }}
                                            >
                                                <FaTimes aria-hidden="true" />
                                            </button>
                                        </div>
                                    )}
                                </div>

                                <div className="json-button-group">
                                    <button
                                        type="button"
                                        className="json-submit-button"
                                        onClick={handleJsonSubmit}
                                        disabled={submittingJson || !JsonFile}
                                    >
                                        {submittingJson ? (
                                            <>
                                                <FaCircleNotch className="spin" aria-hidden="true" />
                                                &nbsp;Submitting...
                                            </>
                                        ) : (
                                            <>
                                                <FaUpload aria-hidden="true" /> Upload JSON
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {modalOpen && (
                    <>
                        <div
                            className="modal-overlay"
                            onClick={() => {
                                setModalOpen(false)
                                setModalDraft(null)
                            }}
                        />
                        <div className="testcase-modal">
                            <div className="modal-header">
                                <div className="modal-title">Practice Problem</div>
                                <button
                                    type="button"
                                    className="modal-close-button"
                                    aria-label="Close practice problem modal"
                                    onClick={() => {
                                        setModalOpen(false)
                                        setModalDraft(null)
                                    }}
                                >
                                    ✕
                                </button>
                            </div>

                            <div className="modal-content">
                                <form>
                                    <div className="form-field modal-input">
                                        <label>Name</label>
                                        <textarea
                                            className="modal-textarea"
                                            rows={1}
                                            value={modalDraft?.name || ''}
                                            onChange={e => handleNameChange(selectedTestCaseId, e.currentTarget.value)}
                                        />
                                    </div>

                                    <div className="form-field modal-textarea">
                                        <label>Input</label>
                                        <textarea
                                            className="modal-textarea"
                                            rows={1}
                                            value={modalDraft?.input || ''}
                                            onChange={e => handleInputChange(selectedTestCaseId, e.currentTarget.value)}
                                        />
                                    </div>

                                    <div className="form-field modal-textarea">
                                        <label>Output (computed)</label>
                                        <textarea
                                            className="modal-textarea"
                                            rows={1}
                                            value={modalDraft?.output || ''}
                                            readOnly
                                            aria-readonly="true"
                                        />
                                    </div>

                                    <div className="grid">
                                        <div className="grid-column grid-column-13">
                                            <div className="form-field modal-description-field">
                                                <label>Description</label>
                                                <textarea
                                                    className="modal-textarea"
                                                    rows={1}
                                                    value={modalDraft?.description || ''}
                                                    onChange={e => handleDescriptionChange(selectedTestCaseId, e.currentTarget.value)}
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    <div className="form-field modal-checkbox">
                                        <label>
                                            <input
                                                type="checkbox"
                                                checked={!!modalDraft?.hidden}
                                                onChange={e => handleHiddenChange(selectedTestCaseId, e.currentTarget.checked)}
                                            />
                                            Hidden practice problem
                                        </label>
                                    </div>

                                    <div className="modal-action-buttons">
                                        <button
                                            type="button"
                                            className="modal-submit-button"
                                            onClick={() => submitTestcase(selectedTestCaseId)}
                                            disabled={submittingTestcase}
                                        >
                                            {submittingTestcase ? (
                                                <>
                                                    <FaCircleNotch className="spin" aria-hidden="true" />
                                                    &nbsp;Submitting...
                                                </>
                                            ) : selectedTestCaseId === -1 ? (
                                                'Submit new practice problem'
                                            ) : (
                                                'Submit changes'
                                            )}
                                        </button>

                                        {selectedTestCaseId !== -1 && (
                                            <button
                                                type="button"
                                                className="modal-trash-button"
                                                onClick={() => removeTestcase(selectedTestCaseId)}
                                            >
                                                Remove practice problem
                                            </button>
                                        )}
                                    </div>
                                </form>
                            </div>
                        </div>
                    </>
                )}
            </div>

            <LoadingAnimation show={showFullScreenLoader} message={loaderMessage} />
        </div>
    )
}

export default AdminPracticeProblemsManage
