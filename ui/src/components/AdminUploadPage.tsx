import React, { Component } from 'react';
import axios from 'axios';
import { useNavigate, NavigateFunction } from 'react-router-dom';

import '../css/AdminUploadPage.scss';

interface Student {
    name: string;
    mscsnet: string;
    id: number;
}

interface DropDownOption {
    key: number;
    value: number;
    text: string;
}

interface UploadPageState {
    file?: File;
    isLoading: boolean;
    error_message: string;
    isErrorMessageHidden: boolean;
    class_id: number;
    project_name: string;
    project_id: number;
    end: string;
    classlist: Array<DropDownOption>;
    studentList: Array<DropDownOption>;
    projects: Array<DropDownOption>;
    student_id: number;
    class_selected: boolean;
}

interface ProjectObject {
    Id: number;
    Name: string;
    Start: string;
    End: string;
    TotalSubmissions: number;
}

interface AdminUploadPageProps {
    navigate: NavigateFunction;
}

class AdminUploadPage extends Component<AdminUploadPageProps, UploadPageState> {
    constructor(props: AdminUploadPageProps) {
        super(props);
        this.state = {
            isLoading: false,
            error_message: '',
            isErrorMessageHidden: true,
            project_name: '',
            project_id: 0,
            student_id: 0,
            class_id: 0,
            end: '',
            classlist: [],
            studentList: [],
            projects: [],
            class_selected: false,
        };

        this.handleSubmit = this.handleSubmit.bind(this);
        this.handleProjectIdChange = this.handleProjectIdChange.bind(this);
        this.handleStudentIdChange = this.handleStudentIdChange.bind(this);
        this.handleFileChange = this.handleFileChange.bind(this);
        this.handleClassIdChange = this.handleClassIdChange.bind(this);
    }

    handleStudentIdChange(e: React.ChangeEvent<HTMLSelectElement>) {
        const value = parseInt(e.target.value, 10);
        // Reset downstream (project + selected file) when student changes
        this.setState({
            student_id: isNaN(value) ? 0 : value,
            project_id: 0,
            file: undefined,
        });
    }

    handleProjectIdChange(e: React.ChangeEvent<HTMLSelectElement>) {
        const value = parseInt(e.target.value, 10);
        this.setState({ project_id: isNaN(value) ? 0 : value });
    }

    handleClassIdChange(e: React.ChangeEvent<HTMLSelectElement>) {
        const value = parseInt(e.target.value, 10);
        const cid = e.target.value;

        // On class change, reset everything downstream
        this.setState({
            isLoading: true,
            class_id: isNaN(value) ? 0 : value,
            class_selected: true,
            student_id: 0,
            project_id: 0,
            studentList: [],
            projects: [],
            file: undefined,
        });

        axios
            .get(import.meta.env.VITE_API_URL + `/upload/total_students_by_cid?class_id=${cid}`, {
                headers: {
                    Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}`,
                },
            })
            .then((res) => {
                const students = res.data as Array<Student>;
                const studentsDropdown: Array<DropDownOption> = students.map((s) => ({
                    key: s.id,
                    text: `${s.name}(${s.mscsnet})`,
                    value: s.id,
                }));
                this.setState({ studentList: studentsDropdown });
            })
            .catch((err) => {
                this.setState({
                    error_message: err.response?.data?.message ?? 'Error loading students',
                    isErrorMessageHidden: false,
                });
            })
            .finally(() => {
                // Note: second request below may still be in-flight; we're okay to turn this off here
                this.setState({ isLoading: false });
            });

        axios
            .get(import.meta.env.VITE_API_URL + `/projects/get_projects_by_class_id?id=${cid}`, {
                headers: {
                    Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}`,
                },
            })
            .then((res) => {
                const projects: Array<ProjectObject> = [];
                res.data.forEach((str: any) => {
                    projects.push(JSON.parse(str) as ProjectObject);
                });

                const projectDropdown: Array<DropDownOption> = projects.map((p) => ({
                    key: p.Id,
                    text: p.Name,
                    value: p.Id,
                }));
                this.setState({ projects: projectDropdown });
            })
            .catch((err) => {
                this.setState({
                    error_message: err.response?.data?.message ?? 'Error loading projects',
                    isErrorMessageHidden: false,
                });
            });
    }

    componentDidMount() {
        axios
            .get(import.meta.env.VITE_API_URL + `/class/all`, {
                headers: {
                    Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}`,
                },
            })
            .then((res) => {
                const classes = res.data as Array<Student>;
                const classesDropdown: Array<DropDownOption> = classes.map((c) => ({
                    key: c.id,
                    text: c.name,
                    value: c.id,
                }));
                this.setState({ classlist: classesDropdown });
            })
            .catch((err) => {
                this.setState({
                    error_message: err.response?.data?.message ?? 'Error loading classes',
                    isErrorMessageHidden: false,
                    isLoading: false,
                });
            });
    }

    handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
        const files = e.target.files;
        if (files && files.length === 1) {
            this.setState({ file: files[0] });
        } else {
            this.setState({ file: undefined });
        }
    }

    handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();

        const uploadDisabled = this.state.isLoading || !(this.state.project_id > 0);
        if (uploadDisabled) {
            // Hard guard in case submit is somehow triggered
            this.setState({
                isErrorMessageHidden: false,
                error_message: 'Please select a project before uploading.',
            });
            return;
        }

        if (this.state.file !== undefined) {
            this.setState({ isErrorMessageHidden: true, isLoading: true });

            const formData = new FormData();
            formData.append('file', this.state.file, this.state.file.name);
            formData.append('student_id', String(this.state.student_id));
            formData.append('project_id', String(this.state.project_id));
            formData.append('class_id', String(this.state.class_id));

            axios
                .post(import.meta.env.VITE_API_URL + `/upload/`, formData, {
                    headers: {
                        Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}`,
                    },
                })
                .then((res) => {
                    window.location.href = `/class/${this.state.class_id.toString()}/code/${res.data.sid.toString()}`;
                })
                .catch((err) => {
                    this.setState({
                        error_message: err.response?.data?.message ?? 'Upload failed',
                        isErrorMessageHidden: false,
                        isLoading: false,
                    });
                });
        } else {
            this.setState({
                isErrorMessageHidden: false,
                error_message: 'Please choose a file to upload.',
            });
        }
    }

    render() {
        // Progressive enablement flags
        const classChosen = this.state.class_id > 0;
        const studentChosen = this.state.student_id > 0;
        const projectChosen = this.state.project_id > 0;

        const disableStudent =
            !classChosen || this.state.isLoading || this.state.studentList.length === 0;

        const disableProject =
            !studentChosen || this.state.isLoading || this.state.projects.length === 0;

        const disableUpload = !projectChosen || this.state.isLoading;

        return (
            <>
                <div className="admin-upload-stack">
                    <div className="back-container">
                        <button
                            type="button"
                            className="upload-back-button"
                            onClick={() => this.props.navigate(`/admin/classes/`)}
                        >
                            <span className="icon-arrow-left" /> Return to Class Selection
                        </button>
                    </div>

                    <div className="admin-upload-page">
                        <h1 className="page-title">Admin Upload</h1>

                        {/* Class select (always first) */}
                        <p className="section-label">Please select a class</p>
                        <select
                            className="select class-select"
                            value={this.state.class_id || ''}
                            onChange={this.handleClassIdChange}
                            disabled={this.state.isLoading}
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

                        <div className="selection-section">
                            <div className="spacer" aria-hidden="true">
                                &nbsp;
                            </div>

                            {/* Student select (unlocked by class) */}
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

                            {/* Project select (unlocked by student) */}
                            <p className="section-label">Please select a project</p>
                            <select
                                className="select project-select"
                                value={this.state.project_id || ''}
                                onChange={this.handleProjectIdChange}
                                disabled={disableProject}
                            >
                                <option value="" disabled>
                                    Select project
                                </option>
                                {this.state.projects.map((opt) => (
                                    <option key={opt.key} value={opt.value}>
                                        {opt.text}
                                    </option>
                                ))}
                            </select>

                            <div className="spacer" aria-hidden="true">
                                &nbsp;
                            </div>

                            {/* Upload section (unlocked by project) */}
                            <form className="upload-form" onSubmit={this.handleSubmit}>
                                <h1 className="upload-title">Upload Assignment</h1>

                                <div className="file-section">
                                    <div className="info-segment">
                                        <div
                                            className={`file-drop-area${disableUpload ? ' is-disabled' : ''}`}
                                            aria-disabled={disableUpload}
                                            onDragOver={(e) => {
                                                e.preventDefault();
                                            }}
                                            onDrop={(e) => {
                                                e.preventDefault();
                                                if (disableUpload) return;
                                                const files = e.dataTransfer.files;
                                                if (files && files.length === 1) {
                                                    this.handleFileChange({ target: { files } } as any);
                                                }
                                            }}
                                        >
                                            {!this.state.file ? (
                                                <>
                                                    <input
                                                        type="file"
                                                        className="file-input"
                                                        required
                                                        onChange={this.handleFileChange}
                                                        disabled={disableUpload}
                                                    />
                                                    <div className="file-drop-message">
                                                        Drag &amp; drop your file here or&nbsp;
                                                        <span className="browse-text">browse</span>
                                                    </div>
                                                </>
                                            ) : (
                                                <div className={`file-preview${disableUpload ? ' is-disabled' : ''}`}>
                                                    <button
                                                        type="button"
                                                        className="file-name"
                                                        title="Selected file"
                                                        disabled={disableUpload}
                                                    >
                                                        {this.state.file.name}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="exchange-icon"
                                                        onClick={() => this.setState({ file: undefined })}
                                                        aria-label="Change file"
                                                        title="Change file"
                                                        disabled={disableUpload}
                                                    >
                                                        <i className="exchange icon"></i>
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <div className="spacer" aria-hidden="true">&nbsp;</div>

                                <button
                                    className="button upload-button"
                                    type="submit"
                                    disabled={disableUpload || this.state.isLoading}
                                >
                                    {this.state.isLoading ? 'Uploading…' : 'Upload'}
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
        );
    }
}

// Wrapper that injects the navigate function for the class component:
const AdminUploadPageWrapper: React.FC = () => {
    const navigate = useNavigate();
    return <AdminUploadPage navigate={navigate} />;
};

export default AdminUploadPageWrapper;
