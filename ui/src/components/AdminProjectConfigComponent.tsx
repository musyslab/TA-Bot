import { useEffect, useState } from 'react'
import { eachDayOfInterval } from 'date-fns'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import '../css/AdminProjectConfigComponent.scss'
import 'semantic-ui-css/semantic.min.css'

interface AdminProjectConfigProps {
    id: number,
    class_id: number
}

class Testcase {
    constructor() {
        this.id = 0;
        this.name = "";
        this.levelid = 0;
        this.description = "";
        this.input = "";
        this.output = "";
        this.isHidden = false;
        this.levelname = "";
    }

    id: number;
    name: string;
    levelid: number;
    description: string;
    input: string;
    output: string;
    isHidden: boolean;
    levelname: string;
}

const AdminProjectConfigComponent = (props: AdminProjectConfigProps) => {
    const [CreateNewState, setCreateNewState] = useState<boolean>();
    const [testcases, setTestcases] = useState<Array<Testcase>>([]);
    const [ProjectName, setProjectName] = useState<string>("");
    const [ProjectLanguage, setProjectLanguage] = useState<string>("java");
    const [SubmitButton, setSubmitButton] = useState<string>("Create new assignment");
    const [SubmitJSON, setSubmitJSON] = useState<string>("Submit JSON file");
    const [getJSON, setGetJSON] = useState<string>("Export test cases");
    const [File, setFile] = useState<File>();
    const [AssignmentDesc, setDesc] = useState<File>();
    const [edit, setEdit] = useState<boolean>(false);
    const [selectedAddFile, setSelectedAddFile] = useState<File>();
    const [modalOpen, setModalOpen] = useState<boolean>(false);
    const [selectedTestCaseId, setSelectedTestCaseId] = useState<number>(-4);
    const [solutionfileName, setSolutionFileName] = useState<string>("");
    const [descfileName, setDescFileName] = useState<string>("");
    const [jsonfilename, setjsonfilename] = useState<string>("");
    const [activeTab, setActiveTab] = useState<'psettings' | 'testcases'>('psettings');
    const [submittingProject, setSubmittingProject] = useState<boolean>(false);
    const [submittingTestcase, setSubmittingTestcase] = useState<boolean>(false);
    const [submittingJson, setSubmittingJson] = useState<boolean>(false);
    const [modalDraft, setModalDraft] = useState<Testcase | null>(null);
    const [previewOpen, setPreviewOpen] = useState(false);
    const [previewTitle, setPreviewTitle] = useState("");
    const [previewText, setPreviewText] = useState("");
    const [serverFiles, setServerFiles] = useState<string[] | null>(null);
    const [showAdditionalFile, setShowAdditionalFile] = useState<boolean>(false);
    const [additionalFileName, setAdditionalFileName] = useState<string>("");

    const API = import.meta.env.VITE_API_URL;
    const authHeader = { 'Authorization': `Bearer ${localStorage.getItem("AUTOTA_AUTH_TOKEN")}` };
    const SUPPORTED_RE = /\.(py|c|h|java|rkt|scm|cpp)$/i;
    const VALID_LEVELS = new Set(['Level 1', 'Level 2', 'Level 3']);

    function fileIconFor(filename: string): string {
        const lower = filename.toLowerCase();
        if (/\.(py|c|cpp|h|java|rkt|scm)$/.test(lower)) return "file code outline icon";
        if (/\.(pdf|docx?|md|txt)$/.test(lower)) return "file alternate outline icon";
        return "file outline icon";
    }

    async function openLocalPreview(file: File) {
        if (!SUPPORTED_RE.test(file.name)) { window.alert("Preview supports .py .c .h .java .rkt .scm (.cpp optional)"); return; }
        const text = await file.text();
        setPreviewTitle(file.name); setPreviewText(text); setPreviewOpen(true);
    }
    async function fetchServerFileList(): Promise<string[]> {
        const res = await fetch(`${API}/projects/list_source_files?project_id=${props.id}`, { headers: authHeader });
        if (!res.ok) return []; const data = await res.json(); const list = data.files.map((f: any) => f.relpath); setServerFiles(list); return list;
    }
    async function openServerPreview(relpath?: string) {
        const url = new URL(`${API}/projects/get_source_file`); url.searchParams.set('project_id', String(props.id)); if (relpath) url.searchParams.set('relpath', relpath);
        const res = await fetch(url, { headers: authHeader }); if (!res.ok) return; const text = await res.text();
        setPreviewTitle(relpath || solutionfileName || "source"); setPreviewText(text); setPreviewOpen(true);
    }

    useEffect(() => {
        if (showAdditionalFile && edit) { fetchServerFileList(); }
    }, [showAdditionalFile, edit]);


    const navigate = useNavigate();

    // compute “today at 23:59”
    const defaultStart = (() => {
        const d = new Date();
        d.setHours(23, 59, 0, 0);
        return d;
    })();

    const defaultEnd = (() => {
        const d = new Date();
        d.setDate(d.getDate() + 7);
        d.setHours(23, 59, 0, 0);
        return d;
    })();

    // if new, seed with Date objects at 23:59; otherwise null
    const [ProjectStartDate, setProjectStartDate] = useState<Date | null>(
        () => props.id === 0 ? defaultStart : null
    );
    const [ProjectEndDate, setProjectEndDate] = useState<Date | null>(
        () => props.id === 0 ? defaultEnd : null
    );
    // build list of dates to highlight between start and end
    const highlightDates: Date[] = (ProjectStartDate && ProjectEndDate)
        ? eachDayOfInterval({ start: ProjectStartDate, end: ProjectEndDate })
        : [];


    useEffect(() => {
        axios.get(import.meta.env.VITE_API_URL + `/projects/get_testcases?id=${props.id}`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem("AUTOTA_AUTH_TOKEN")}`
            }
        })
            .then(res => {
                var data = res.data

                var rows: Array<Testcase> = [];

                Object.entries(data).map(([key, value]) => {
                    var testcase = new Testcase();
                    var values = (value as Array<string>);


                    testcase.id = parseInt(key);
                    testcase.levelid = parseInt(values[0]);
                    testcase.name = values[1];
                    testcase.description = values[2];
                    testcase.input = values[3];
                    testcase.output = values[4];
                    testcase.isHidden = !!values[5];
                    testcase.levelname = values[6]


                    rows.push(testcase);

                    return testcase;
                });

                var testcase = new Testcase();
                testcase.id = -1;
                testcase.levelid = -1;
                testcase.name = "";
                testcase.description = "";
                testcase.input = "";
                testcase.output = "";
                testcase.isHidden = false;
                testcase.levelname = "";

                rows.push(testcase);

                setTestcases(rows);
            })
            .catch(err => {
                console.log(err);
            });
        if (!CreateNewState && props.id != 0) {
            axios.get(import.meta.env.VITE_API_URL + `/projects/get_project_id?id=${props.id}`, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem("AUTOTA_AUTH_TOKEN")}`
                }
            })
                .then(res => {
                    var data = res.data
                    if (!CreateNewState) {
                        setProjectName(data[props.id][0]);
                        // parse ISO strings into Date objects for DatePicker
                        setProjectStartDate(new Date(data[props.id][1]));
                        setProjectEndDate(new Date(data[props.id][2]));
                        setProjectLanguage(data[props.id][3]);
                        setSolutionFileName(data[props.id][4]);
                        setDescFileName(data[props.id][5]);
                        const addName = (data[props.id][6] || "") as string;
                        setAdditionalFileName(addName);
                        setShowAdditionalFile(!!addName);
                        setEdit(true);
                        setSubmitButton("Submit changes");
                    }
                })
                .catch(err => {
                    console.log(err);
                });
        }
    }, [])



    function handleNameChange(testcase_id: number, name: string) {
        // Edit only the modal draft; do not touch global state
        setModalDraft(prev => {
            if (prev && prev.id === testcase_id) {
                return { ...prev, name };
            }
            return prev;
        });
    }

    function handleDescriptionChange(testcase_id: number, description: string) {
        setModalDraft(prev => {
            if (prev && prev.id === testcase_id) {
                return { ...prev, description };
            }
            return prev;
        });
    }

    function handleHiddenChange(testcase_id: number, checked: boolean) {
        setModalDraft(prev => {
            if (prev && prev.id === testcase_id) {
                return { ...prev, isHidden: !prev.isHidden };
            }
            return prev;
        });
    }


    function handleLevelChange(testcase_id: number, level: string) {
        setModalDraft(prev => {
            if (prev && prev.id === testcase_id) {
                return { ...prev, levelname: level };
            }
            return prev;
        });
    }

    function handleInputChange(testcase_id: number, input_data: string) {
        setModalDraft(prev => {
            if (prev && prev.id === testcase_id) {
                return { ...prev, input: input_data };
            }
            return prev;
        });
    }

    function handleOutputChange(testcase_id: number, output_data: string) {
        let new_testcases = [...testcases];

        for (var i = 0; i < new_testcases.length; i++) {
            if (new_testcases[i].id === testcase_id) {
                new_testcases[i].output = output_data;
                setTestcases(new_testcases);
                break;
            }
        }
    }

    function buttonhandleTrashClick(testcase: number) {
        //loop through testcase and return the one with the id
        var test: Testcase = new Testcase();
        for (var i = 0; i < testcases.length; i++) {
            if (testcases[i].id === testcase) {
                test = testcases[i];
                break;
            }
        }

        const formData = new FormData();
        formData.append('id', test.id.toString());

        axios.post(import.meta.env.VITE_API_URL + `/projects/remove_testcase`, formData, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem("AUTOTA_AUTH_TOKEN")}`
            }
        }).then(function (response) {
            reloadtests();
        }).catch(function (error) {
            console.log(error);
        });
        setModalOpen(false);
    }

    function reloadtests() {
        return axios.get(import.meta.env.VITE_API_URL + `/projects/get_testcases?id=${props.id}`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem("AUTOTA_AUTH_TOKEN")}`
            }
        })
            .then(res => {
                var data = res.data

                var rows: Array<Testcase> = [];

                Object.entries(data).map(([key, value]) => {
                    var testcase = new Testcase();
                    var values = (value as Array<string>);

                    testcase.id = parseInt(key);
                    testcase.levelid = parseInt(values[0]);
                    testcase.name = values[1];
                    testcase.description = values[2];
                    testcase.input = values[3];
                    testcase.output = values[4];
                    testcase.isHidden = !!values[5];
                    testcase.levelname = values[6];
                    rows.push(testcase);

                    return testcase;
                });

                var testcase = new Testcase();
                testcase.id = -1;
                testcase.levelid = -1;
                testcase.name = "";
                testcase.description = "";
                testcase.input = "";
                testcase.output = "";
                testcase.isHidden = false;
                testcase.levelname = "";

                rows.push(testcase);

                setTestcases(rows)
            })
            .catch(err => {
                console.log(err);
            });
    }

    async function handleJsonSubmit() {
        try {
            setSubmittingJson(true);
            const formData = new FormData();
            formData.append("file", File!);
            formData.append("project_id", props.id.toString());
            formData.append("class_id", props.class_id.toString());
            await axios.post(
                import.meta.env.VITE_API_URL + `/projects/json_add_testcases`,
                formData,
                { headers: { 'Authorization': `Bearer ${localStorage.getItem("AUTOTA_AUTH_TOKEN")}` } }
            );
            await reloadtests();

            // Reset JSON file UI back to drag & drop
            setjsonfilename('');
            const jsonInput = document.getElementById('jsonFile') as HTMLInputElement | null;
            if (jsonInput) jsonInput.value = '';

        } catch (error) {
            console.log(error);
        } finally {
            setSubmittingJson(false);
        }
    }

    async function handleNewSubmit() {
        // Basic client-side validation
        if (!ProjectName || !ProjectStartDate || !ProjectEndDate || !ProjectLanguage) {
            window.alert("Please fill out all fields");
            return;
        }
        if (!File || !AssignmentDesc) {
            window.alert("Please upload both the solution file and the assignment description.");
            return;
        }
        if (ProjectStartDate.getTime() >= ProjectEndDate.getTime()) {
            window.alert("End date must be after start date.");
            return;
        }

        try {
            // 1) Check for time conflicts BEFORE creating
            const conflictCheck = await axios.post(
                `${import.meta.env.VITE_API_URL}/projects/check_time_conflict`,
                {
                    project_id: props.id, // 0 for new projects
                    class_id: props.class_id,
                    start_date: formatDateTimeLocal(ProjectStartDate),
                    end_date: formatDateTimeLocal(ProjectEndDate),
                },
                { headers: { 'Authorization': `Bearer ${localStorage.getItem("AUTOTA_AUTH_TOKEN")}` } }
            );

            if (conflictCheck?.data?.conflict) {
                const first = conflictCheck.data.conflicts?.[0];
                const s = first?.start ? new Date(first.start).toLocaleString() : "";
                const e = first?.end ? new Date(first.end).toLocaleString() : "";
                window.alert(
                    `The selected dates overlap with an existing assignment ` +
                    `"${first?.name ?? 'Unknown'}" (${s} – ${e}). Please adjust your dates.`
                );
                return; // do not create
            }

            // 2) No conflict -> proceed to create
            setSubmittingProject(true);
            const formData = new FormData();
            formData.append("file", File);
            formData.append("assignmentdesc", AssignmentDesc);
            if (selectedAddFile) {
                formData.append("additionalFile", selectedAddFile);
            } else if (!additionalFileName.trim()) {
                // only clear when user explicitly removed via exchange icon (name emptied)
                formData.append("clearAdditionalFile", "true");
            }
            formData.append("name", ProjectName);
            formData.append("start_date", formatDateTimeLocal(ProjectStartDate));
            formData.append("end_date", formatDateTimeLocal(ProjectEndDate));
            formData.append("language", ProjectLanguage);
            formData.append("class_id", props.class_id.toString());

            const res = await axios.post(
                `${import.meta.env.VITE_API_URL}/projects/create_project`,
                formData,
                { headers: { 'Authorization': `Bearer ${localStorage.getItem("AUTOTA_AUTH_TOKEN")}` } }
            );
            const newId = res.data;

            // 3) Success notice: tell the user to go to Test Cases
            window.alert('Your project has been created! Next, open the "Test Cases" tab to add test cases.');
            window.location.href = `/admin/project/edit/${props.class_id}/${newId}`;
        } catch (error) {
            console.log(error);
            setSubmittingProject(false);
        }
    }

    // replace the existing handleEditSubmit with this version
    async function handleEditSubmit() {
        try {
            // 1) Check for time conflicts BEFORE saving
            const conflictCheck = await axios.post(
                `${import.meta.env.VITE_API_URL}/projects/check_time_conflict`,
                {
                    project_id: props.id,
                    class_id: props.class_id,
                    start_date: formatDateTimeLocal(ProjectStartDate!),
                    end_date: formatDateTimeLocal(ProjectEndDate!)
                },
                { headers: { 'Authorization': `Bearer ${localStorage.getItem("AUTOTA_AUTH_TOKEN")}` } }
            );

            if (conflictCheck?.data?.conflict) {
                const first = conflictCheck.data.conflicts?.[0];
                const s = first?.start ? new Date(first.start).toLocaleString() : "";
                const e = first?.end ? new Date(first.end).toLocaleString() : "";
                window.alert(
                    `The selected dates overlap with an existing assignment ` +
                    `"${first?.name ?? 'Unknown'}" (${s} – ${e}). Please adjust your dates.`
                );
                return; // do not submit changes
            }

            // 2) No conflict -> proceed to save
            setSubmittingProject(true);
            const formData = new FormData();
            formData.append("id", props.id.toString());
            if (File) formData.append("file", File);
            if (AssignmentDesc) formData.append("assignmentdesc", AssignmentDesc);
            if (selectedAddFile) {
                formData.append("additionalFile", selectedAddFile);
            }
            formData.append("name", ProjectName);
            formData.append("start_date", formatDateTimeLocal(ProjectStartDate!));
            formData.append("end_date", formatDateTimeLocal(ProjectEndDate!));
            formData.append("language", ProjectLanguage);
            formData.append("class_id", props.class_id.toString());

            await axios.post(
                `${import.meta.env.VITE_API_URL}/projects/edit_project`,
                formData,
                { headers: { 'Authorization': `Bearer ${localStorage.getItem("AUTOTA_AUTH_TOKEN")}` } }
            );

            // 3) Success notice: tell the user to go to Test Cases
            window.alert('Project information saved. Next, go to the "Test Cases" tab to create test cases.');

            // keep existing navigation behavior
            window.location.href = `/admin/project/edit/${props.class_id}/${props.id}`;
        } catch (error) {
            console.log(error);
            setSubmittingProject(false);
        }
    }

    function handleOpenModal(TestCaseId: number) {
        setModalOpen(true);
        setSelectedTestCaseId(TestCaseId);
        // Initialize a local draft copy so edits don't affect background
        if (TestCaseId === -1) {
            const t = new Testcase();
            t.id = -1;
            t.levelid = -1;
            t.name = "";
            t.description = "";
            t.input = "";
            t.output = "";
            t.isHidden = false;
            t.levelname = "";
            setModalDraft(t);
        } else {
            const source = testcases.find(tc => tc.id === TestCaseId);
            let draft: Testcase | null = null;
            if (source) {
                draft = { ...source } as Testcase;
            }
            setModalDraft(draft);
        }
    }


    function handleFileChange(event: React.FormEvent) {

        const target = event.target as HTMLInputElement;
        const files = target.files;

        if (files != null && files.length === 1) {
            // Update the state
            setFile(files[0]);
            setSolutionFileName(files[0].name);
        } else {
            setFile(undefined);
        }
    };

    function handleJsonFileChange(event: React.FormEvent) {

        const target = event.target as HTMLInputElement;
        const files = target.files;

        if (files != null && files.length === 1) {
            // Update the state
            setFile(files[0]);
            setjsonfilename(files[0].name);
        } else {
            setFile(undefined);
        }
    };

    function handleDescFileChange(event: React.FormEvent) {

        const target = event.target as HTMLInputElement;
        const files = target.files;

        if (files != null && files.length === 1) {
            // Update the state
            setDesc(files[0]);
            setDescFileName(files[0].name);
        } else {
            setDesc(undefined);
        }
    };

    // Download the current assignment description from the server (edit mode)
    async function downloadAssignmentDescription() {
        try {
            const url = `${import.meta.env.VITE_API_URL}/projects/getAssignmentDescription?project_id=${props.id}`;
            const res = await axios.get(url, {
                responseType: 'blob',
                headers: { 'Authorization': `Bearer ${localStorage.getItem("AUTOTA_AUTH_TOKEN")}` }
            });
            const extMatch = (descfileName || '').match(/\.[^.]+$/);
            const ext = extMatch ? extMatch[0] : '.pdf';
            const filename = (descfileName && descfileName.trim()) ? descfileName : `assignment_description${ext}`;
            const blob = new Blob([res.data]);
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            URL.revokeObjectURL(a.href);
            a.remove();
        } catch (err) {
            console.log(err);
            window.alert('Could not download the assignment description.');
        }
    }

    function handleAdditionalFileChange(event: React.FormEvent) {

        const target = event.target as HTMLInputElement;
        const files = target.files;

        if (files != null && files.length === 1) {
            // Update the state
            setSelectedAddFile(files[0]);
        } else {
            setSelectedAddFile(undefined);
        }
    };

    function formatDateTimeLocal(date: Date): string {
        const pad = (n: number) => n.toString().padStart(2, '0');
        return [
            date.getFullYear(),
            '-',
            pad(date.getMonth() + 1),
            '-',
            pad(date.getDate()),
            'T',
            pad(date.getHours()),
            ':',
            pad(date.getMinutes())
        ].join('');
    }

    async function buttonhandleClick(testcase: number) {
        // Use only the modal draft; persist on Save
        if (!modalDraft) return;
        const formData = new FormData();
        formData.append('id', modalDraft.id.toString());
        formData.append('name', modalDraft.name);
        formData.append('levelName', modalDraft.levelname.toString());
        formData.append('project_id', props.id.toString());
        formData.append('class_id', props.class_id.toString());
        formData.append('input', modalDraft.input.toString());
        formData.append('output', modalDraft.output.toString());
        formData.append('isHidden', modalDraft.isHidden.toString());
        formData.append('description', modalDraft.description.toString());

        if (modalDraft.name === "" || modalDraft.levelname === "" || modalDraft.input === "" || modalDraft.description === "") {
            window.alert("Please fill out all fields");
            return;
        }

        if (!VALID_LEVELS.has(modalDraft.levelname)) {
            window.alert("Please select a level (Level 1, Level 2, or Level 3).");
            return;
        }

        try {
            if (modalDraft.id === -1) setSubmittingTestcase(true);
            await axios.post(import.meta.env.VITE_API_URL + `/projects/add_or_update_testcase`, formData, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem("AUTOTA_AUTH_TOKEN")}`
                }
            });
            await reloadtests();
            setModalOpen(false);
            setModalDraft(null);
        } catch (error) {
            console.log(error);
        } finally {
            setSubmittingTestcase(false);
        }
    }



    function get_testcase_json() {
        axios.get(import.meta.env.VITE_API_URL + `/projects/get_testcases?id=${props.id}`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem("AUTOTA_AUTH_TOKEN")}`
            }
        })
            .then(res => {
                var data = res.data

                var rows: Array<Testcase> = [];

                Object.entries(data).map(([key, value]) => {
                    var testcase = new Testcase();
                    var values = (value as Array<string>);
                    testcase.id = -1;
                    testcase.levelid = parseInt(values[0]);
                    testcase.name = values[1];
                    testcase.description = values[2];
                    testcase.input = values[3];
                    testcase.output = values[4];
                    testcase.isHidden = !!values[5];
                    testcase.levelname = values[6];
                    rows.push(testcase);

                    return testcase;
                });
                const fileContent = JSON.stringify(rows, null, 2);
                const fileName = ProjectName + '.json';
                const blob = new Blob([fileContent], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = fileName;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            })
            .catch(error => {
                console.error(error);
            });
    }

    const selectedTestCase = modalDraft;
    const directoryEntries = Array.from(new Set([
        ...(serverFiles ?? []),
        ...(solutionfileName ? [solutionfileName] : []),
        ...(selectedAddFile ? [selectedAddFile.name] : []),
        ...(additionalFileName ? [additionalFileName] : []),
    ].map(p => p.split(/[\\/]/).pop()!)))
        .filter(Boolean)
        .sort();

    return (
        <>
            <div className={`admin-project-config-container${modalOpen ? ' blurred' : ''}`}>
                {/* Back button */}
                <div className="back-container">
                    <button
                        type="button"
                        className="back-button"
                        onClick={() => navigate(`/admin/projects/${props.class_id}`)}
                    >
                        <span className="icon-arrow-left" /> Return to Project List
                    </button>
                </div>

                {/* Assignment header (moved out of Project Settings) */}
                <div className="assignment-title">
                    {edit ? 'Edit Assignment' : 'Create Assignment'}
                </div>

                {/* Tab buttons */}
                <div className="tab-menu">
                    <button
                        className={activeTab === 'psettings' ? 'active menu-item-project-settings' : 'menu-item-project-settings'}
                        onClick={() => setActiveTab('psettings')}
                    >
                        Project Settings
                    </button>
                    <button
                        className={`menu-item-testcases ${activeTab === 'testcases' ? 'active' : ''}`}
                        onClick={() => setActiveTab('testcases')}
                    >
                        <span className="icon-clipboard-check" />
                        Test Cases
                    </button>
                </div>

                {/* Tab content */}
                <div className="tab-content">
                    {activeTab === 'psettings' && (
                        <div className="pane-project-settings">
                            <form className="form-project-settings">
                                <div className="segment-main">

                                    {/* Project Name */}
                                    <div className="form-field input-field">
                                        <label>Project Name</label>
                                        <input
                                            type="text"
                                            value={ProjectName}
                                            onChange={e => setProjectName(e.currentTarget.value)}
                                        />
                                    </div>

                                    {/* Dates */}
                                    <div className="form-group date-range-group">
                                        <div className="form-field input-field">
                                            <label>Start Date</label>
                                            <DatePicker
                                                selected={ProjectStartDate}
                                                onChange={(date: Date | null) => setProjectStartDate(date)}
                                                showTimeSelect
                                                timeFormat="h:mm aa"
                                                timeIntervals={1}
                                                timeCaption="Time"
                                                dateFormat="yyyy-MM-dd h:mm aa"
                                                highlightDates={highlightDates}
                                                selectsStart
                                                startDate={ProjectStartDate}
                                                endDate={ProjectEndDate}
                                                placeholderText="Select start date"
                                            />
                                        </div>
                                        <div className="form-field input-field">
                                            <label>End Date</label>
                                            <DatePicker
                                                selected={ProjectEndDate}
                                                onChange={(date: Date | null) => setProjectEndDate(date)}
                                                showTimeSelect
                                                timeFormat="h:mm aa"
                                                timeIntervals={1}
                                                timeCaption="Time"
                                                dateFormat="yyyy-MM-dd h:mm aa"
                                                highlightDates={highlightDates}
                                                selectsEnd
                                                startDate={ProjectStartDate}
                                                endDate={ProjectEndDate}
                                                placeholderText="Select end date"
                                            />
                                        </div>
                                    </div>


                                    {/* Language */}
                                    <div className="form-group language-group">
                                        <label>Language</label>
                                        <select
                                            className="dropdown-field"
                                            value={ProjectLanguage}
                                            onChange={e => setProjectLanguage(e.currentTarget.value)}
                                        >
                                            <option value="java">Java</option>
                                            <option value="racket">Racket</option>
                                            <option value="c">C</option>
                                            <option value="python">Python</option>
                                        </select>
                                    </div>

                                    {/* File sections */}
                                    <div className="file-section">
                                        {/* Solution File Upload */}
                                        <div className="info-segment">
                                            <h1 className="info-title">
                                                {edit ? 'Preview or Change Solution Files' : 'Upload solution files'}
                                            </h1>
                                            <div
                                                className="file-drop-area"
                                                onDragOver={e => e.preventDefault()}
                                                onDrop={e => {
                                                    e.preventDefault();
                                                    const files = e.dataTransfer.files;
                                                    if (files && files.length === 1) {
                                                        handleFileChange({ target: { files } } as any);
                                                    }
                                                }}
                                            >
                                                {!solutionfileName ? (
                                                    <>
                                                        <input
                                                            type="file"
                                                            className="file-input"
                                                            onChange={handleFileChange}
                                                        />
                                                        <div className="file-drop-message">
                                                            Drag &amp; drop your file here or&nbsp;
                                                            <span className="browse-text">browse</span>
                                                        </div>
                                                    </>
                                                ) : (
                                                    <div className="file-preview">
                                                        <button
                                                            type="button"
                                                            className="file-name"
                                                            onClick={async (e) => {
                                                                e.preventDefault();
                                                                if (File) {
                                                                    openLocalPreview(File);
                                                                } else if (edit) {
                                                                    // Show existing server-stored program
                                                                    // If project is a single-file project, this will open it directly.
                                                                    // If it's a directory, we first list then let user pick.
                                                                    fetchServerFileList().then(() => {
                                                                        if (serverFiles && serverFiles.length === 1) {
                                                                            openServerPreview(serverFiles[0]);
                                                                        } else {
                                                                            // open a simple chooser modal
                                                                            setPreviewTitle("Select a file to preview");
                                                                            setPreviewText(""); // we’ll render a clickable list below
                                                                            setPreviewOpen(true);
                                                                        }
                                                                    });
                                                                }
                                                            }}
                                                            title="Click to preview"
                                                        >
                                                            {solutionfileName}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className="exchange-icon"
                                                            onClick={() => {
                                                                setSolutionFileName('');
                                                                setFile(undefined);
                                                            }}
                                                        >
                                                            <i className="exchange icon"></i>
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* Description File Upload */}
                                        <div className="info-segment">
                                            <h1 className="info-title">
                                                {edit ? 'Download or Change Assignment Description File' : 'Upload assignment description'}
                                            </h1>
                                            <div
                                                className="file-drop-area"
                                                onDragOver={e => e.preventDefault()}
                                                onDrop={e => {
                                                    e.preventDefault();
                                                    const files = e.dataTransfer.files;
                                                    if (files && files.length === 1) {
                                                        handleDescFileChange({ target: { files } } as any);
                                                    }
                                                }}
                                            >
                                                {!descfileName ? (
                                                    <>
                                                        <input
                                                            type="file"
                                                            className="file-input"
                                                            onChange={handleDescFileChange}
                                                        />
                                                        <div className="file-drop-message">
                                                            Drag &amp; drop your file here or&nbsp;
                                                            <span className="browse-text">browse</span>
                                                        </div>
                                                    </>
                                                ) : (
                                                    <div className="file-preview">

                                                        <button
                                                            type="button"
                                                            className="file-name"
                                                            title="Click to download"
                                                            onClick={(e) => {
                                                                e.preventDefault();
                                                                const lower = (descfileName || '').toLowerCase();
                                                                // Only download server copy when editing and no new local file is chosen
                                                                if (/\.(pdf|docx?)$/.test(lower) && edit && !AssignmentDesc) {
                                                                    downloadAssignmentDescription();
                                                                }
                                                            }}

                                                        >
                                                            {descfileName}
                                                        </button>

                                                        <button
                                                            type="button"
                                                            className="exchange-icon"
                                                            onClick={() => {
                                                                setDescFileName('');
                                                                setDesc(undefined);
                                                            }}
                                                        >
                                                            <i className="exchange icon"></i>
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        <div className="optional-file-toggle">
                                            <button
                                                type="button"
                                                className={`toggle-optional-file ${showAdditionalFile ? 'on' : 'off'}`}
                                                aria-pressed={showAdditionalFile}
                                                onClick={() => {
                                                    setShowAdditionalFile(prev => !prev);
                                                }}
                                            >
                                                {showAdditionalFile ? 'Optional additional file: On' : 'Optional additional file: Off'}
                                            </button>
                                        </div>

                                        {showAdditionalFile && (
                                            <div className="info-segment optional-additional-file-segment">
                                                <h1 className="info-title">File Structure</h1>
                                                {/* Directory-like listing shown above the drop zone */}
                                                {directoryEntries.length > 0 && (
                                                    <div className="directory-tree" role="tree" aria-label="Current directory">
                                                        <div className="tree-rail" aria-hidden="true"></div>
                                                        <ul className="tree-list">
                                                            {directoryEntries.map((name) => (
                                                                <li className="tree-row" role="treeitem" key={name}>
                                                                    <span className="tree-icon" aria-hidden="true">
                                                                        <i className={fileIconFor(name)} />
                                                                    </span>
                                                                    <span className="tree-name">{name}</span>
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    </div>
                                                )}
                                                <h1 className="info-title">Optional Additional File</h1>
                                                <div
                                                    className="file-drop-area optional-additional-file-drop"
                                                    onDragOver={e => e.preventDefault()}
                                                    onDrop={e => {
                                                        e.preventDefault();
                                                        const files = e.dataTransfer.files;
                                                        if (files && files.length === 1) {
                                                            handleAdditionalFileChange({ target: { files } } as any);
                                                        }
                                                    }}
                                                >
                                                    {selectedAddFile ? (
                                                        <div className="file-preview optional-additional-file-preview">
                                                            <span className="file-name">{selectedAddFile.name}</span>
                                                            <button
                                                                type="button"
                                                                className="exchange-icon"
                                                                onClick={() => setSelectedAddFile(undefined)}
                                                                title="Remove file"
                                                            >
                                                                <i className="exchange icon"></i>
                                                            </button>
                                                        </div>
                                                    ) : additionalFileName ? (
                                                        <div className="file-preview optional-additional-file-preview">
                                                            <button
                                                                type="button"
                                                                className="file-name"
                                                                title="(Server) additional file"
                                                                onClick={(e) => e.preventDefault()}
                                                            >
                                                                {additionalFileName}
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="exchange-icon"
                                                                onClick={() => setAdditionalFileName("")}
                                                                title="Clear (choose another)"
                                                            >
                                                                <i className="exchange icon"></i>
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <>
                                                            <input
                                                                type="file"
                                                                className="file-input optional-additional-file-input"
                                                                onChange={handleAdditionalFileChange}
                                                            />
                                                            <div className="file-drop-message">
                                                                Drag &amp; drop your file here or&nbsp;
                                                                <span className="browse-text">browse</span>
                                                            </div>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        )}

                                    </div>

                                    {/* Submit */}
                                    <button
                                        type="button"
                                        className="submit-button"
                                        onClick={edit ? handleEditSubmit : handleNewSubmit}
                                        disabled={submittingProject}
                                    >
                                        {submittingProject ? (
                                            <>
                                                <i className="notched circle loading icon"></i>
                                                &nbsp;{edit ? 'Saving...' : 'Creating...'}
                                            </>
                                        ) : (
                                            SubmitButton
                                        )}
                                    </button>
                                </div>
                            </form>
                        </div>

                    )}

                    {activeTab === 'testcases' && (
                        <div className="pane-testcases">
                            <div className="testcase-management-group">
                                <div className="form-testcases-overview">
                                    <table className="testcases-table">
                                        <thead>
                                            <tr>
                                                <th>Name</th>
                                                <th>Level</th>
                                                <th>Input</th>
                                                <th>Output</th>
                                                <th>Description</th>
                                                <th>Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {testcases
                                                .filter(tc => tc.id !== -1)
                                                .map(tc => (
                                                    <tr key={tc.id}>
                                                        <td>{tc.name}</td>
                                                        <td>{tc.levelname}</td>
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
                                                                <i className="edit icon"></i> Edit
                                                            </button>
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
                                                        <i className="plus circle icon"></i> Add Test Case
                                                    </button>
                                                </td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>

                                <div className="or-separator">
                                    <span>or</span>
                                </div>

                                <div className="upload-testcases-segment">
                                    <h1 className="upload-title">Upload Test Cases</h1>
                                    <div
                                        className="file-drop-area"
                                        onDragOver={e => e.preventDefault()}
                                        onDrop={e => {
                                            e.preventDefault();
                                            const files = e.dataTransfer.files;
                                            if (files && files.length === 1) {
                                                handleJsonFileChange({ target: { files } } as any);
                                            }
                                        }}
                                    >
                                        {!jsonfilename ? (
                                            <>
                                                <input
                                                    id="jsonFile"
                                                    type="file"
                                                    className="file-input"
                                                    onChange={handleJsonFileChange}
                                                />
                                                <div className="file-drop-message">
                                                    Drag &amp; drop your JSON file here or&nbsp;
                                                    <span className="browse-text">browse</span>
                                                </div>
                                            </>
                                        ) : (
                                            <div className="file-preview">
                                                <span className="file-name">{jsonfilename}</span>
                                                <button
                                                    type="button"
                                                    className="exchange-icon"
                                                    onClick={() => {
                                                        setjsonfilename('');
                                                        const jsonInput = document.getElementById('jsonFile') as HTMLInputElement | null;
                                                        if (jsonInput) jsonInput.value = '';
                                                    }}
                                                >
                                                    <i className="exchange icon"></i>
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="json-button-group">
                                    <button
                                        type="button"
                                        className="json-submit-button"
                                        onClick={handleJsonSubmit}
                                        disabled={submittingJson}
                                    >
                                        {submittingJson ? (
                                            <>
                                                <i className="notched circle loading icon"></i>
                                                &nbsp;Submitting...
                                            </>
                                        ) : (
                                            <>
                                                <i className="upload icon"></i> {SubmitJSON}
                                            </>
                                        )}
                                    </button>
                                    <div className="json-button-spacer" />
                                    <button
                                        type="button"
                                        className="get-json-button"
                                        onClick={get_testcase_json}
                                    >
                                        <i className="download icon"></i> {getJSON}
                                    </button>
                                </div>
                            </div>

                            <div className="testcase-info-grid">
                                <div className="info-segment">
                                    <h2>Level 1: Base Cases (Simple Cases)</h2>
                                    <ul className="bulleted">
                                        <li>Test basic functionality with simple inputs.</li>
                                    </ul>
                                </div>
                                <div className="info-segment">
                                    <h2>Level 2: Main Functionality Cases</h2>
                                    <ul className="bulleted">
                                        <li>Test core features and main tasks.</li>
                                        <li>Use a variety of inputs, positive/negative scenarios.</li>
                                    </ul>
                                </div>
                                <div className="info-segment">
                                    <h2>Level 3: Edge Cases (Boundary and Extreme Cases)</h2>
                                    <ul className="bulleted">
                                        <li>Test less common or extreme situations.</li>
                                    </ul>
                                </div>
                                <div className="info-segment">
                                    <h2>General Best Practices for Test Cases:</h2>
                                    <ul className="bulleted">
                                        <li>Clear and descriptive names.</li>
                                        <li>Complete coverage with representative cases.</li>
                                        <li>Descriptions are robust for students.</li>
                                    </ul>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Modals rendered OUTSIDE blurred container */}

            {previewOpen && (
                <div className="preview-overlay">
                    <div className="preview-modal">
                        <div className="preview-header">
                            <strong>{previewTitle}</strong>
                            <button
                                type="button"
                                className="preview-close-button"
                                onClick={() => { setPreviewOpen(false); setServerFiles(null); }}
                            >
                                &times;
                            </button>
                        </div>

                        {serverFiles && (
                            <div className="preview-file-list">
                                {serverFiles.length === 0 ? (
                                    <div>No previewable files.</div>
                                ) : (
                                    <ul>
                                        {serverFiles.map(fp => (
                                            <li key={fp}>
                                                <button
                                                    type="button"
                                                    className="preview-file-link"
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        openServerPreview(fp);
                                                    }}
                                                >
                                                    {fp}
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        )}

                        <div
                            className="preview-body"
                        >
                            {previewText || (!serverFiles ? "No content loaded." : "Pick a file above.")}
                        </div>
                    </div>
                </div>
            )}


            {modalOpen && (
                <>
                    <div
                        className="modal-overlay"
                        onClick={() => { setModalOpen(false); setModalDraft(null); }}
                    />
                    <div className="testcase-modal">
                        <div className="modal-header">
                            <div className="modal-title">Test Case Information</div>
                            <button
                                type="button"
                                className="modal-close-button"
                                aria-label="Close test case modal"
                                onClick={() => { setModalOpen(false); setModalDraft(null); }}
                            >
                                ✕
                            </button>
                        </div>
                        <div className="modal-content">
                            <form>
                                <div className="form-field modal-input">
                                    <label>Test Case Name</label>
                                    <textarea
                                        className="modal-textarea"
                                        rows={1}
                                        value={selectedTestCase?.name || ''}
                                        onChange={e =>
                                            handleNameChange(selectedTestCaseId!, e.currentTarget.value)
                                        }
                                    />
                                </div>
                                <div className="form-field modal-textarea">
                                    <label>Input</label>
                                    <textarea
                                        className="modal-textarea"
                                        rows={1}
                                        value={selectedTestCase?.input || ''}
                                        onChange={e =>
                                            handleInputChange(selectedTestCaseId!, e.currentTarget.value)
                                        }
                                    />
                                </div>

                                <div className="form-field modal-textarea">
                                    <label>Output</label>
                                    <textarea
                                        className="modal-textarea"
                                        rows={1}
                                        value={selectedTestCase?.output || ''}
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
                                                value={selectedTestCase?.description || ''}
                                                onChange={e =>
                                                    handleDescriptionChange(selectedTestCaseId!, e.currentTarget.value)
                                                }
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div className="form-field modal-checkbox">
                                    <label>
                                        <input
                                            type="checkbox"
                                            checked={selectedTestCase?.isHidden || false}
                                            onChange={() =>
                                                handleHiddenChange(selectedTestCaseId!, true)
                                            }
                                        />
                                        Hidden
                                    </label>
                                </div>

                                <div className="form-group level-radio-group">
                                    {['Level 1', 'Level 2', 'Level 3'].map(level => (
                                        <div key={level} className="form-field modal-radio">
                                            <label>
                                                <input
                                                    type="radio"
                                                    name={`levelRadio-${selectedTestCaseId}-${level}`}
                                                    value={level}
                                                    checked={selectedTestCase?.levelname === level}
                                                    onChange={() =>
                                                        handleLevelChange(selectedTestCaseId!, level)
                                                    }
                                                />
                                                {level}
                                            </label>
                                        </div>
                                    ))}
                                </div>

                                <div className="modal-action-buttons">
                                    <button
                                        type="button"
                                        className="modal-submit-button"
                                        onClick={() => buttonhandleClick(selectedTestCaseId!)}
                                        disabled={selectedTestCaseId === -1 && submittingTestcase}
                                    >
                                        {selectedTestCaseId === -1 ? (
                                            submittingTestcase ? (
                                                <>
                                                    <i className="notched circle loading icon"></i>
                                                    &nbsp;Submitting...
                                                </>
                                            ) : (
                                                'Submit new testcase'
                                            )
                                        ) : (
                                            'Submit changes'
                                        )}
                                    </button>
                                    {selectedTestCaseId !== -1 && (
                                        <button
                                            type="button"
                                            className="modal-trash-button"
                                            onClick={() => buttonhandleTrashClick(selectedTestCaseId!)}
                                        >
                                            Remove testcase
                                        </button>
                                    )}
                                </div>
                            </form>
                        </div>
                    </div>
                </>
            )}
        </>
    );


};

export default AdminProjectConfigComponent;