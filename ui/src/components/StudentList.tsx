import React, { Component } from 'react'
import axios from 'axios'
import { Link } from 'react-router-dom'
import '../css/StudentList.scss'
import '../css/CodeViews.scss'
import { Icon } from 'semantic-ui-react'

interface StudentListProps {
    project_id: number;
}

class Row {
    constructor() {
        this.id = 0;
        this.Lname = '';
        this.Fname = '';
        this.numberOfSubmissions = 0;
        this.date = '';
        this.numberOfPylintErrors = 0;
        this.isPassing = false;
        this.subid = 0;
        this.lecture_number = 0;
        this.lab_number = 0;
        this.hidden = false;
        this.classId = '';
        this.grade = 0;
        this.StudentNumber = 0;
        this.IsLocked = false;
    }

    id: number;
    Lname: string;
    Fname: string;
    numberOfSubmissions: number;
    date: string;
    numberOfPylintErrors: number;
    isPassing: boolean;
    subid: number;
    lecture_number: number;
    lab_number: number;
    hidden: boolean;
    classId: string;
    grade: number;
    StudentNumber: number;
    IsLocked: boolean;
}

interface Option {
    key: number;
    text: string;
    value: number;
}

interface StudentListState {
    rows: Array<Row>;
    isLoading: boolean;
    lecture_numbers: Array<Option>;
    lab_numbers: Array<Option>;
    selectedStudent: number;
    modalIsLoading: boolean;
    modalIsOpen: boolean;
    selectedStudentData: any[];
    selectedStudentCode: string;
    selectedStudentTestResults: any[];
    selectedStudentName: string;
    selectedStudentGrade: number;
    exportModalIsOpen: boolean;
    selectedLecture: number;
    selectedLab: number;
    projectLanguage: string;

    // Added for modal "CodePage-like" UI
    activeView: 'table' | 'diff';
    selectedDiffId: string | null;
    sortBy: 'lastname' | 'lastsubmitted';

    plagiarismModalIsOpen: boolean;
    plagiarismResults: Array<{
        a: { user_id: number; name: string; class_id: string; submission_id: number; };
        b: { user_id: number; name: string; class_id: string; submission_id: number; };
        similarity_token: number;
        similarity_ast: number;
        overlap_snippet_a?: string;
        overlap_snippet_b?: string;
    }>;
}

class StudentList extends Component<StudentListProps, StudentListState> {
    constructor(props: StudentListProps) {
        super(props);

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
        };

        this.handleClick = this.handleClick.bind(this);

        this.handleLectureChange = this.handleLectureChange.bind(this);
        this.handleLabChange = this.handleLabChange.bind(this);
        this.handleSortChange = this.handleSortChange.bind(this);

        this.handleUnlockClick = this.handleUnlockClick.bind(this);
        this.submitGrades = this.submitGrades.bind(this);
        this.exportGrades = this.exportGrades.bind(this);
        this.downloadStudentCode = this.downloadStudentCode.bind(this);
    }

    async downloadStudentCode(row: Row) {
        try {
            if (row.subid === -1) return;
            const url = `${import.meta.env.VITE_API_URL}/submissions/codefinder?id=${row.subid}&class_id=${row.classId}`;
            const res = await axios.get<string | string[]>(url, {
                headers: { Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}` },
                responseType: 'text',
            });
            const code = Array.isArray(res.data) ? (res.data[0] ?? '') : (res.data ?? '');
            const safe = (s: string) => (s || '').replace(/\s+/g, '_');
            const fname = `${safe(row.Fname)}_${safe(row.Lname)}_${row.subid}.py`;
            const blob = new Blob([code], { type: 'text/x-python' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = fname;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(a.href);
        } catch (_e) {
            window.alert('Failed to download code. Please try again.');
        }
    }

    componentDidMount() {
        axios
            .post(
                import.meta.env.VITE_API_URL + `/submissions/recentsubproject`,
                { project_id: this.props.project_id },
                {
                    headers: {
                        Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}`,
                    },
                }
            )
            .then((res) => {
                var data = res.data;
                const rows: Array<Row> = [];
                const lectureSet = new Set<number>([-1]);
                const labSet = new Set<number>([-1]);

                Object.entries(data).map(([key, value]) => {
                    const row = new Row();
                    const student_output_data = value as Array<string>;
                    row.id = parseInt(key);
                    row.Lname = student_output_data[0];
                    row.Fname = student_output_data[1];
                    row.lecture_number = parseInt(student_output_data[2]);
                    row.lab_number = parseInt(student_output_data[3]); // NEW
                    lectureSet.add(row.lecture_number);
                    labSet.add(row.lab_number);
                    row.numberOfSubmissions = parseInt(student_output_data[4]);
                    row.date = student_output_data[5];

                    const passRaw = String(student_output_data[6] ?? '').toLowerCase().trim();

                    row.isPassing =
                        passRaw === 'true' ||
                        passRaw === '1' ||
                        passRaw === 'pass' ||
                        passRaw === 'passed' ||
                        passRaw === 'ok' ||
                        passRaw === 'success';

                    row.numberOfPylintErrors = parseInt(student_output_data[7]);
                    row.subid = parseInt(student_output_data[8]);
                    row.hidden = false;
                    row.classId = student_output_data[9];
                    row.grade = parseInt(student_output_data[10]);
                    row.StudentNumber = parseInt(student_output_data[11]);
                    row.IsLocked = Boolean(student_output_data[12]);
                    rows.push(row);
                    return row;
                });

                const lecture_numbers: Option[] =
                    Array.from(lectureSet)
                        .filter(v => v !== -1)
                        .sort((a, b) => a - b)
                        .map(v => ({ key: v, text: String(v), value: v }));
                lecture_numbers.unshift({ key: -1, text: 'All', value: -1 });

                const lab_numbers: Option[] =
                    Array.from(labSet)
                        .filter(v => v !== -1)
                        .sort((a, b) => a - b)
                        .map(v => ({ key: v, text: String(v), value: v }));
                lab_numbers.unshift({ key: -1, text: 'All', value: -1 });

                rows.sort((a, b) => a.Lname.localeCompare(b.Lname));

                this.setState({ rows, lecture_numbers, lab_numbers });

            });
    }

    // Run MOSS
    handleClick = () => {
        // Now runs the LOCAL detector and shows results in a modal
        this.setState({ isLoading: true });
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
                const data = res.data || {};
                const pairs = Array.isArray(data.pairs) ? data.pairs : [];
                this.setState({
                    plagiarismResults: pairs,
                    plagiarismModalIsOpen: true,
                    isLoading: false,
                });
            })
            .catch((_exc) => {
                window.alert('Error running plagiarism detector. Please try again.');
                this.setState({ isLoading: false });
            });
    }

    handleLectureChange(ev: React.ChangeEvent<HTMLSelectElement>) {
        const value = parseInt(ev.target.value, 10);
        this.setState({ selectedLecture: value }, this.applyFilters);
    }
    handleLabChange(ev: React.ChangeEvent<HTMLSelectElement>) {
        const value = parseInt(ev.target.value, 10);
        this.setState({ selectedLab: value }, this.applyFilters);
    }
    handleSortChange(ev: React.ChangeEvent<HTMLSelectElement>) {
        const value = ev.target.value as 'lastname' | 'lastsubmitted';
        this.setState({ sortBy: value });
    }
    applyFilters = () => {
        const { selectedLecture, selectedLab } = this.state;
        const new_rows = this.state.rows.map((row) => {
            const lectureOk = (selectedLecture === -1) || (row.lecture_number === selectedLecture);
            const labOk = (selectedLab === -1) || (row.lab_number === selectedLab);
            return { ...row, hidden: !(lectureOk && labOk) };
        });
        this.setState({ rows: new_rows });
    };

    handleGradeChange = (e: React.ChangeEvent<HTMLInputElement>, row: Row) => {
        const newValue = parseFloat(e.target.value);
        if (!isNaN(newValue)) {
            const updatedRows = this.state.rows.map((r) => (r.id === row.id ? { ...r, grade: newValue } : r));
            this.setState({
                rows: updatedRows,
            });
        }
    };

    // Unlock a student account
    handleUnlockClick = (UserId: number) => {
        axios
            .post(
                import.meta.env.VITE_API_URL + `/projects/unlockStudentAccount`,
                { UserId: UserId },
                {
                    headers: {
                        Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}`,
                    },
                }
            )
            .then((res) => {
                window.location.reload();
            });
    };

    submitGrades(UserId: number, grade: string) {
        const intGrade = Number.isFinite(Number(grade)) ? parseInt(grade, 10) : 0;

        this.setState({ isLoading: true });

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
                    rows: prev.rows.map((r) =>
                        r.id === UserId ? { ...r, grade: intGrade } : r
                    ),

                    modalIsOpen: false,
                    modalIsLoading: false,
                    isLoading: false,
                    selectedStudent: -1,
                    selectedStudentName: '',
                    selectedStudentGrade: 0,
                    activeView: 'table',
                    selectedDiffId: null,
                }));
            })
            .catch((_exc) => {
                this.setState({ isLoading: false });
                window.alert('Failed to submit grade. Please try again.');
            });
    }


    exportGrades() {
        axios
            .get(import.meta.env.VITE_API_URL + `/submissions/getprojectscores?projectID=${this.props.project_id}`, {
                headers: {
                    Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}`,
                },
            })
            .then((res) => {
                let projectname = res.data.projectName;
                let csvContent = [] as String[][];
                let selectedRow: any;

                csvContent.push(['OrgDefinedId', projectname + ' Points Grade', 'End-of-Line Indicator']);

                for (const value of res.data.studentData) {
                    selectedRow = this.state.rows.find((row) => row.id === value[2]);
                    if (this.state.selectedLecture === -1) {
                        csvContent.push([value[0].toString(), value[1].toString(), '#']);
                    } else {
                        if (selectedRow && selectedRow.lecture_number === this.state.selectedLecture) {
                            csvContent.push([value[0].toString(), value[1].toString(), '#']);
                        }
                    }
                }

                const csvRows = csvContent.map((row) => row.join(','));
                const csvString = csvRows.join('\n');
                const blob = new Blob([csvString], { type: 'text/csv' });
                const url = URL.createObjectURL(blob);

                const a = document.createElement('a');
                a.href = url;
                a.download = `${projectname}.csv`;
                document.body.appendChild(a);
                a.click();

                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                this.setState({ exportModalIsOpen: false });
            })
            .catch((exc) => {
            });
    }

    openGradingModule(UserId: number) {
        this.setState({ modalIsLoading: true, activeView: 'table', selectedDiffId: null });
        if (UserId === -1) {
            UserId = this.state.rows[0].id;
            this.setState({ selectedStudentName: this.state.rows[0].Fname + ' ' + this.state.rows[0].Lname });
            this.setState({ selectedStudent: UserId });
            this.setState({ selectedStudentGrade: this.state.rows[0].grade });
        } else {
            const selectedRow = this.state.rows.find((row) => row.id === UserId);
            if (selectedRow === undefined) {
                this.setState({ modalIsOpen: false, modalIsLoading: false });
                return;
            }
            this.setState({ selectedStudentName: selectedRow.Fname + ' ' + selectedRow.Lname });
            this.setState({ selectedStudent: UserId });
            this.setState({ selectedStudentGrade: selectedRow.grade });
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
                    projectLanguage: res.data.Language
                });
            })
            .catch((exc) => {
                this.setState({ modalIsLoading: false });
            });
    }

    render() {
        const levels = ['Level 1', 'Level 2', 'Level 3']; // not strictly needed, kept in case of future use

        const rowsForView = (() => {
            const visible = this.state.rows.filter(r => !r.hidden);
            if (this.state.sortBy === 'lastsubmitted') {
                const timeVal = (r: Row) => {
                    const t = Date.parse(r.date); // expects "MM/DD/YY HH:MM:SS"
                    return isNaN(t) ? -Infinity : t;
                };
                return [...visible].sort((a, b) => timeVal(b) - timeVal(a)); // newest first
            }
            // default: lastname, then firstname
            return [...visible].sort((a, b) =>
                a.Lname.localeCompare(b.Lname) || a.Fname.localeCompare(b.Fname)
            );
        })();

        // ===== Helpers for modal "CodePage-like" UI =====
        const code = this.state.selectedStudentCode || '';

        const results = (this.state.selectedStudentTestResults || []).map((t: any) => {
            const outputStr =
                typeof t.output === 'string'
                    ? t.output
                    : Array.isArray(t.output)
                        ? t.output.join('\n')
                        : '';
            const s = outputStr.replace(/\r\n/g, '\n');
            const { expected, actual, hadDiff } = parseOutputs(s);
            const norm = (x: string) => (x ?? '').replace(/\r\n/g, '\n').trimEnd();
            const passedExplicit =
                typeof t.passed === 'boolean' ? t.passed
                    : typeof t.Pass === 'boolean' ? t.Pass
                        : undefined;
            const passedHeuristic = hadDiff
                ? norm(expected) === norm(actual)
                : (/^no differences\.?$/i.test(s.trim()) || s.trim() === '~~~diff~~~' || s.trim() === '');
            const passed = (passedExplicit !== undefined) ? passedExplicit : passedHeuristic;
            return {
                skipped: false,
                passed,
                test: {
                    output: s.split('\n'),
                    type: 0,
                    name: t.name || t.test || t.testCaseName || '',
                    suite: t.level || t.suite || '',
                    hidden: t.hidden ? 'True' : 'False',
                }
            };
        });

        const suites = Array.from(new Set(results.map((r: any) => r.test.suite)));
        const suiteGroups = suites.map(s => {
            const suiteItems = results.filter((r: any) => r.test.suite === s);
            const visible = suiteItems.filter((r: any) => r.test.hidden !== 'True');
            const hiddenCount = suiteItems.length - visible.length;
            return { suite: s, visible, hiddenCount };
        });

        const labelFor = (r: any) => (r.skipped ? 'Skipped' : r.passed ? 'Passed' : 'Failed');

        function parseOutputs(raw: string): { expected: string; actual: string; hadDiff: boolean } {
            if (raw.includes('~~~diff~~~')) {
                const [userPart, expectedPart = ''] = raw.split('~~~diff~~~');
                return { expected: expectedPart, actual: userPart, hadDiff: true };
            }
            const lines = raw.replace(/\r\n/g, '\n').split('\n');
            const expectedLines: string[] = [];
            const actualLines: string[] = [];
            let sawDiffMarker = false;

            for (const l of lines) {
                const t = l.trimStart();
                if (t.startsWith('---')) { sawDiffMarker = true; continue; }
                if (t.startsWith('< ')) { expectedLines.push(t.slice(2)); sawDiffMarker = true; continue; }
                if (t.startsWith('> ')) { actualLines.push(t.slice(2)); sawDiffMarker = true; continue; }
            }

            if (sawDiffMarker) {
                return { expected: expectedLines.join('\n'), actual: actualLines.join('\n'), hadDiff: true };
            }
            return { expected: '', actual: raw, hadDiff: false };
        }

        function truncateLines(text: string, maxLines = 30) {
            const arr = text ? text.replace(/\r\n/g, '\n').split('\n') : [];
            const total = arr.length;
            const truncated = total > maxLines;
            const shown = truncated ? arr.slice(0, maxLines) : arr;
            return {
                text: shown.join('\n'),
                total,
                truncated,
                omitted: truncated ? total - maxLines : 0,
            };
        }

        function friendlySkipMessage(): string[] {
            return [
                'This test did not run due to a configuration issue.',
                'If this keeps happening, contact your TA or instructor.',
            ];
        }

        function buildUnifiedDiff(expected: string, actual: string, title: string): string {
            const e = (expected ?? '').replace(/\r\n/g, '\n').split('\n');
            const a = (actual ?? '').replace(/\r\n/g, '\n').split('\n');
            const lines: string[] = [];
            lines.push(`--- actual:${title}`);
            lines.push(`+++ expected:${title}`);
            const max = Math.max(e.length, a.length);
            for (let i = 0; i < max; i++) {
                const el = e[i] ?? '';
                const al = a[i] ?? '';
                if (el === al) {
                    lines.push(` ${el}`);
                } else {
                    if (al !== '') lines.push(`-${al}`);
                    if (el !== '') lines.push(`+${el}`);
                    if (el === '' && al === '') lines.push(' ');
                }
            }
            return lines.join('\n');
        }

        type DiffEntry = {
            id: string;
            suite: string;
            test: string;
            status: string;
            passed: boolean;
            skipped: boolean;
            expected: string;
            actual: string;
            unified: string;
        };

        const diffFilesAll: DiffEntry[] = (() => {
            const entries: DiffEntry[] = [];
            suiteGroups.forEach(g => {
                g.visible.forEach((r: any) => {
                    const rawOut = (r.skipped ? friendlySkipMessage() : (r.test.output || [])).join('\n');
                    const { expected, actual } = parseOutputs(rawOut);
                    const title = `${r.test.suite}/${r.test.name}`;
                    const unified = buildUnifiedDiff(expected, actual, title);
                    entries.push({
                        id: `${r.test.suite}__${r.test.name}`,
                        suite: r.test.suite,
                        test: r.test.name,
                        status: labelFor(r),
                        passed: r.passed,
                        skipped: r.skipped,
                        expected,
                        actual,
                        unified,
                    });
                });
            });
            return entries.sort(
                (a, b) =>
                    Number(a.passed) - Number(b.passed) ||
                    a.suite.localeCompare(b.suite) ||
                    a.test.localeCompare(b.test)
            );
        })();

        const derivedSelectedDiffId = this.state.selectedDiffId ?? (diffFilesAll[0]?.id ?? null);
        const selectedFile = diffFilesAll.find(f => f.id === derivedSelectedDiffId) || null;

        const codeLines = (code ? code.replace(/\r\n/g, '\n').split('\n') : []);

        type TestRow =
            | { kind: 'info'; suite: string; note?: string }
            | {
                kind: 'result';
                suite: string;
                test: string;
                status: string;
                passed: boolean;
                expectedExcerpt: string;
                outputExcerpt: string;
                note?: string;
            };

        const testRows: TestRow[] = [];
        suiteGroups.forEach(g => {
            if (g.hiddenCount > 0) {
                testRows.push({ kind: 'info', suite: g.suite, note: `Hidden tests not shown: ${g.hiddenCount}` });
            }
            g.visible.forEach((r: any) => {
                const status = labelFor(r);
                const rawOut = (r.skipped ? friendlySkipMessage() : (r.test.output || [])).join('\n');
                const { expected, actual, hadDiff } = parseOutputs(rawOut);
                const expTrunc = truncateLines(r.passed ? actual : expected);
                const actTrunc = truncateLines(actual);
                testRows.push({
                    kind: 'result',
                    suite: r.test.suite,
                    test: r.test.name,
                    status,
                    passed: r.passed,
                    expectedExcerpt: r.passed ? expTrunc.text : (expTrunc.text || '—'),
                    outputExcerpt: actTrunc.text || '—',
                    note: !r.passed && !hadDiff ? 'Grader did not provide a separate expected block.' : undefined,
                });
            });
        });

        const testsLoaded = !this.state.modalIsLoading;

        return (
            <>
                {/* Everything that should blur goes inside page-bg itself */}
                <div
                    className={`admin-project-config-container${this.state.modalIsOpen ? ' blurred' : ''
                        }`}
                >
                    {/* Back link (blue, top-left, outside table) */}
                    <div className="page-header">
                        <Link to="/admin/classes" className="back-link">
                            Return to Class Selection
                        </Link>
                    </div>

                    {/* Big grey title bar separated from the table */}
                    <div className="title-row">
                        <h1 className="page-title">Grade or Review Student Submissions</h1>
                    </div>

                    {/* Connected white container (Lecture Section + buttons + table) */}
                    <div className="student-sub-panel">
                        {/* Filters & Sort */}
                        <div className="filter-bar">
                            <label className="filter-label" htmlFor="lectureFilter">Lecture:&nbsp;</label>
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
                            <label className="filter-label" htmlFor="labFilter">Lab:&nbsp;</label>
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
                                <Icon name="clone" />
                                &nbsp;Run Plagiarism Detector
                            </button>
                            &nbsp;&nbsp;
                            <label className="filter-label" htmlFor="sortSelect">Sort by:&nbsp;</label>
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

                        {/*  
                        <div className="actions-bar">
                            <button
                                className="btn start-grading-btn"
                                onClick={() => this.openGradingModule(-1)}
                            >
                                Start Grading
                            </button>
                        </div>
                        */}

                        {/* Table */}
                        <div className="table-scroll" role="region" aria-label="Student submissions" tabIndex={0}>
                            <table className="students-table">
                                <thead className="table-head">
                                    <tr className="table-row">
                                        <th className="col-student-name">Student</th>
                                        <th className="col-lecture-number">Lecture</th>
                                        <th className="col-lab-number">Lab</th>
                                        <th className="col-submissions">Submissions</th>
                                        <th className="col-date">Last Submitted</th>
                                        <th className="col-pylint-errors">Pylint Errors</th>
                                        <th className="col-status">Status</th>
                                        <th className="col-view">View</th>
                                        <th className="col-download">Download</th>
                                        <th className="col-grade">Grade</th>
                                    </tr>
                                </thead>
                                <tbody className="table-body">
                                    {rowsForView.map((row) => {
                                        if (row.hidden) return null;

                                        if (row.subid === -1) {
                                            return (
                                                <tr
                                                    className="student-row student-row--no-submission"
                                                    key={`row-${row.id}-na`}
                                                >
                                                    <td className="student-name-cell">
                                                        {row.Fname + ' ' + row.Lname}{' '}
                                                        {row.IsLocked === true && (
                                                            <button
                                                                className="btn unlock-btn"
                                                                onClick={() => this.handleUnlockClick(row.id)}
                                                            >
                                                                Unlock
                                                            </button>
                                                        )}
                                                    </td>
                                                    <td className="lecture-number-cell">{row.lecture_number}</td>
                                                    <td className="lab-number-cell">{row.lab_number}</td>
                                                    <td className="submissions-cell">N/A</td>
                                                    <td className="date-cell">N/A</td>
                                                    <td className="pylint-errors-cell">N/A</td>
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
                                                        <button
                                                            className="btn grade-btn"
                                                            onClick={() => this.openGradingModule(row.id)}
                                                        >
                                                            Grade
                                                        </button>
                                                    </td>
                                                </tr>
                                            );
                                        }

                                        return (
                                            <tr className="student-row" key={`row-${row.id}`}>
                                                <td className="student-name-cell">
                                                    {row.Fname + ' ' + row.Lname}{' '}
                                                    {row.IsLocked === true && (
                                                        <button
                                                            className="btn unlock-btn"
                                                            onClick={() => this.handleUnlockClick(row.id)}
                                                        >
                                                            Unlock
                                                        </button>
                                                    )}
                                                </td>
                                                <td className="lecture-number-cell">{row.lecture_number}</td>
                                                <td className="lab-number-cell">{row.lab_number}</td>
                                                <td className="submissions-cell">{row.numberOfSubmissions}</td>
                                                <td className="date-cell">{row.date}</td>
                                                <td className="pylint-errors-cell">{row.numberOfPylintErrors}</td>
                                                <td
                                                    className={
                                                        row.isPassing ? 'status-cell status passed' : 'status-cell status failed'
                                                    }
                                                >
                                                    {row.isPassing ? 'PASSED' : 'FAILED'}
                                                </td>
                                                <td className="view-cell">
                                                    <Link
                                                        className="view-link"
                                                        to={`/class/${row.classId}/code/${row.subid}`}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                    >
                                                        <Icon name="eye" aria-label="View" /> View
                                                    </Link>
                                                </td>
                                                <td className="download-cell">
                                                    <button
                                                        className="btn download-btn"
                                                        onClick={() => this.downloadStudentCode(row)}
                                                        aria-label="Download code"
                                                        title="Download code"
                                                    >
                                                        <Icon name="download" />
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
                                                    <button
                                                        className="btn grade-btn"
                                                        onClick={() => this.openGradingModule(row.id)}
                                                    >
                                                        Grade
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div >

                {/* NEW: Plagiarism results modal */}
                {this.state.plagiarismModalIsOpen && (
                    <>
                        <div
                            className="modal-overlay"
                            onClick={() => this.setState({ plagiarismModalIsOpen: false })}
                            aria-hidden="true"
                        />
                        <div
                            className="testcase-modal"
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="plagiarism-modal-title"
                        >
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
                                    <div className="modal-title" id="plagiarism-modal-title">
                                        Potentially Similar Submissions
                                    </div>
                                </div>
                                <div className="tab-content">
                                    <section className="tests-section">
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
                                                    <tr><td className="no-data-message" colSpan={5}>No similar pairs found (above threshold).</td></tr>
                                                )}
                                                {this.state.plagiarismResults.map((p, i) => {
                                                    const pct = (v: number) => (Math.round(v * 1000) / 10).toFixed(1) + '%';
                                                    const bucketClass = (v: number) => {
                                                        const p = v * 100;
                                                        if (p < 40) return 'status-cell sim-low';
                                                        if (p < 60) return 'status-cell sim-medlow';
                                                        if (p < 75) return 'status-cell sim-medium';
                                                        if (p < 90) return 'status-cell sim-high';
                                                        return 'status-cell sim-critical';
                                                    };
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
                                                                    to={`/plagiarism/compare?ac=${p.a.class_id}&as=${p.a.submission_id}&bc=${p.b.class_id}&bs=${p.b.submission_id}&an=${encodeURIComponent(p.a.name)}&bn=${encodeURIComponent(p.b.name)}`}
                                                                    target="_blank"
                                                                    rel="noreferrer"
                                                                >
                                                                    <Icon name="eye" /> View
                                                                </Link>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </section>
                                </div>
                            </div>
                        </div>
                    </>
                )}

                {/* Real modal & overlay, rendered at the root so it floats above and locks body via :has() */}
                {
                    this.state.modalIsOpen && (
                        <>
                            <div
                                className="modal-overlay"
                                onClick={() => this.setState({ modalIsOpen: false })}
                                aria-hidden="true"
                            />
                            <div
                                className="testcase-modal"
                                role="dialog"
                                aria-modal="true"
                                aria-labelledby="grading-modal-title"
                            >
                                {/* Leave the close button as a sibling so it can sit “outside” the modal */}
                                <button
                                    type="button"
                                    className="modal-close-button"
                                    aria-label="Close"
                                    onClick={() => this.setState({ modalIsOpen: false })}
                                >
                                    ✕
                                </button>

                                {/* NEW: make this the scroll container */}
                                <div className="modal-body">
                                    <div className="modal-header">
                                        <div className="modal-title" id="grading-modal-title">
                                            Student Name: {this.state.selectedStudentName}
                                        </div>
                                    </div>

                                    <div className="tab-menu view-switch">
                                        <button
                                            className={this.state.activeView === 'table' ? 'active menu-item-table' : 'menu-item-table'}
                                            onClick={() => this.setState({ activeView: 'table' })}
                                            type="button"
                                        >
                                            Table View
                                        </button>
                                        <button
                                            className={`menu-item-diff ${this.state.activeView === 'diff' ? 'active' : ''}`}
                                            onClick={() => this.setState({ activeView: 'diff' })}
                                            type="button"
                                        >
                                            File View
                                        </button>
                                    </div>

                                    <div className="tab-content">
                                        {this.state.activeView === 'table' && (
                                            <>
                                                <section className="tests-section">
                                                    <table className="results-table">
                                                        <thead>
                                                            <tr>
                                                                <th>Difficulty Level</th>
                                                                <th>Test Name</th>
                                                                <th>Status</th>
                                                                <th>Your Program's Output</th>
                                                                <th>Expected Output</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {!testsLoaded && (
                                                                <tr>
                                                                    <td className="no-data-message" colSpan={5}>Fetching tests…</td>
                                                                </tr>
                                                            )}
                                                            {testsLoaded && testRows.length === 0 && (
                                                                <tr>
                                                                    <td className="no-data-message" colSpan={5}>No tests were returned for this submission.</td>
                                                                </tr>
                                                            )}
                                                            {testsLoaded && testRows.map((row, i) => {
                                                                if (row.kind === 'info') {
                                                                    return (
                                                                        <tr className="info-row" key={`info-${row.suite}-${i}`}>
                                                                            <td>{row.suite}</td>
                                                                            <td colSpan={4}>—</td>
                                                                        </tr>
                                                                    );
                                                                }
                                                                const isPass = row.passed;
                                                                return (
                                                                    <tr key={`res-${row.suite}-${row.test}-${i}`}>
                                                                        <td>{row.suite}</td>
                                                                        <td>{row.test}</td>
                                                                        <td
                                                                            className={`status-cell status ${/^(pass|passed|ok|success)$/i.test(row.status) ? 'passed' : 'failed'}`}
                                                                        >
                                                                            {row.status}
                                                                        </td>
                                                                        <td className={isPass ? 'status-cell passed' : undefined}>
                                                                            {isPass ? row.status : <pre className="cell-pre">{row.outputExcerpt}</pre>}
                                                                        </td>
                                                                        <td className={isPass ? 'status-cell passed' : undefined}>
                                                                            {isPass ? row.status : <pre className="cell-pre">{row.expectedExcerpt}</pre>}
                                                                        </td>
                                                                    </tr>
                                                                );
                                                            })}
                                                        </tbody>
                                                    </table>
                                                </section>
                                            </>
                                        )}

                                        {this.state.activeView === 'diff' && (
                                            <section className="diff-view">
                                                <aside className="diff-sidebar">
                                                    <ul className="diff-file-list">
                                                        {!testsLoaded && <li className="muted">Loading…</li>}
                                                        {testsLoaded && diffFilesAll.length === 0 && <li className="muted">No tests.</li>}
                                                        {diffFilesAll.map((f) => (
                                                            <li
                                                                key={f.id}
                                                                className={
                                                                    'file-item ' +
                                                                    (f.id === derivedSelectedDiffId ? 'selected ' : '') +
                                                                    (f.passed ? 'passed' : 'failed')
                                                                }
                                                                onClick={() => this.setState({ selectedDiffId: f.id })}
                                                                title={`${f.suite} / ${f.test}`}
                                                            >
                                                                <div className="file-name">{f.test}</div>
                                                                <div className="file-sub">
                                                                    <span className={'status-dot ' + (f.passed ? 'is-pass' : 'is-fail')} />
                                                                    {f.suite} • {f.status}
                                                                </div>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </aside>

                                                <div className="diff-pane">
                                                    <div className="diff-toolbar">
                                                        <div className="diff-title">
                                                            {selectedFile
                                                                ? `Difficulty: ${selectedFile.suite} Testcase Name: ${selectedFile.test}`
                                                                : 'No selection'}
                                                        </div>
                                                        <div className="spacer" />
                                                    </div>

                                                    <div className="diff-code">
                                                        {!selectedFile && <div className="muted">Select a test on the left to view its diff.</div>}
                                                        {selectedFile && (
                                                            selectedFile.passed
                                                                ? <div className="diff-line ctx">No differences.</div>
                                                                : selectedFile.unified.split('\n').map((line, i) => {
                                                                    const cls =
                                                                        line.startsWith('+') ? 'add'
                                                                            : line.startsWith('-') ? 'del'
                                                                                : (line.startsWith('@@') || line.startsWith('---') || line.startsWith('+++')) ? 'meta'
                                                                                    : 'ctx';
                                                                    return (
                                                                        <div key={i} className={`diff-line ${cls}`}>
                                                                            {line || ' '}
                                                                        </div>
                                                                    );
                                                                })
                                                        )}
                                                    </div>
                                                </div>
                                            </section>
                                        )}
                                    </div>

                                    {/* ==================== CODE SECTION (BELOW TABLES) ==================== */}
                                    <section className="code-section">
                                        <h2 className="section-title">Submitted Code</h2>
                                        {!code && <div className="no-data-message">Fetching submitted code…</div>}
                                        {!!code && (
                                            <div className="code-block code-viewer" role="region" aria-label="Submitted source code">
                                                <ol className="code-list">
                                                    {codeLines.map((text, idx) => {
                                                        const lineNo = idx + 1;
                                                        return (
                                                            <li key={lineNo} className="code-line">
                                                                <span className="gutter">
                                                                    <span className="line-number">{lineNo}</span>
                                                                </span>
                                                                <span className="code-text">{text || '\u00A0'}</span>
                                                            </li>
                                                        );
                                                    })}
                                                </ol>
                                            </div>
                                        )}
                                    </section>

                                    <div className="modal-footer" role="group" aria-label="Submit grade">
                                        <label className="footer-instruction" htmlFor="gradeInput">Enter grade here:</label>
                                        <input
                                            id="gradeInput"
                                            className="grade-input"
                                            type="number"
                                            placeholder="0"
                                            value={this.state.selectedStudentGrade ?? ''}
                                            onChange={(e) => {
                                                const v = e.target.value;
                                                this.setState({
                                                    selectedStudentGrade: v === '' ? undefined : Number(v),
                                                });
                                            }}
                                            onWheel={(e) => e.currentTarget.blur()} // stop mouse wheel from changing value
                                        />

                                        <button
                                            className="btn submit-grade-btn"
                                            onClick={() =>
                                                this.submitGrades(
                                                    this.state.selectedStudent,
                                                    String(this.state.selectedStudentGrade ?? 0)
                                                )
                                            }
                                            type="button"
                                        >
                                            Submit
                                        </button>

                                    </div>

                                </div>
                            </div>
                        </>
                    )
                }
            </>
        );
    }
}

export default StudentList;