import { useEffect, useState } from 'react'
import { eachDayOfInterval } from 'date-fns'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import '../css/AdminProjectConfigComponent.scss'
import '../css/FileUploadCommon.scss'
import 'semantic-ui-css/semantic.min.css'

interface AdminProjectConfigProps {
    id: number,
    class_id: number
}

class Testcase {
    constructor() {
        this.id = 0;
        this.name = "";
        this.description = "";
        this.input = "";
        this.output = "";
        this.isHidden = false;
    }

    id: number;
    name: string;
    description: string;
    input: string;
    output: string;
    isHidden: boolean;
}

const AdminProjectConfigComponent = (props: AdminProjectConfigProps) => {
    const [CreateNewState, setCreateNewState] = useState<boolean>();
    const [testcases, setTestcases] = useState<Array<Testcase>>([]);
    const [ProjectName, setProjectName] = useState<string>("");
    const [ProjectLanguage, setProjectLanguage] = useState<string>("");
    const [serverProjectLanguageSnapshot, setServerProjectLanguageSnapshot] = useState<string>("");
    const [SubmitButton, setSubmitButton] = useState<string>("Create new assignment");
    const [SubmitJSON, setSubmitJSON] = useState<string>("Submit JSON file");
    const [getJSON, setGetJSON] = useState<string>("Export test cases");
    const [SolutionFiles, setSolutionFiles] = useState<File[]>([]);
    const [serverSolutionFileNames, setServerSolutionFileNames] = useState<string[]>([]);
    const [serverSolutionFileNamesSnapshot, setServerSolutionFileNamesSnapshot] = useState<string[]>([]);
    const [JsonFile, setJsonFile] = useState<File | undefined>(undefined);
    const [AssignmentDesc, setDesc] = useState<File>();
    const [edit, setEdit] = useState<boolean>(false);
    const [selectedAddFiles, setSelectedAddFiles] = useState<File[]>([]);
    const [modalOpen, setModalOpen] = useState<boolean>(false);
    const [selectedTestCaseId, setSelectedTestCaseId] = useState<number>(-4);
    const [solutionFileNames, setSolutionFileNames] = useState<string[]>([]);
    const [descfileName, setDescFileName] = useState<string>("");
    const [serverDescFileName, setServerDescFileName] = useState<string>("");
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
    const [additionalFileNames, setAdditionalFileNames] = useState<string[]>([]);
    const [removedAdditionalFiles, setRemovedAdditionalFiles] = useState<string[]>([]);
    const [mainJavaFileName, setMainJavaFileName] = useState<string>("");

    const API = import.meta.env.VITE_API_URL;
    const authHeader = { 'Authorization': `Bearer ${localStorage.getItem("AUTOTA_AUTH_TOKEN")}` };

    const SUPPORTED_RE = /\.(py|c|h|java|rkt|scm|cpp)$/i;
    const SOLUTION_ALLOWED_RE = /\.(py|java|c|h|rkt|scm)$/i;
    const DESC_ALLOWED_RE = /\.(pdf|docx?|txt)$/i;
    const SOLUTION_ACCEPT = ".py,.java,.c,.h,.rkt,.scm";
    const DESC_ACCEPT = ".pdf,.doc,.docx,.txt";

    const ADD_ALLOWED_RE = /\.(txt)$/i;
    const ADD_ACCEPT = ".txt";

    const JAVA_MAIN_RE = /\bpublic\s+static\s+void\s+main\s*\(/;
    const isJavaFileName = (n: string) => /\.java$/i.test(n);

    const basename = (p: string) => (p || "").split(/[\\/]/).pop() || "";

    type SolutionLang = 'java' | 'python' | 'c' | 'racket';
    const solutionLangFor = (name: string): SolutionLang | null => {
        const lower = name.toLowerCase();
        if (lower.endsWith('.java')) return 'java';
        if (lower.endsWith('.py')) return 'python';
        if (lower.endsWith('.c') || lower.endsWith('.h')) return 'c';
        if (lower.endsWith('.rkt') || lower.endsWith('.scm')) return 'racket';
        return null;
    };

    function pickMainJavaFile(allJavaNames: string[], namesWithMain: string[]): string {
        if (namesWithMain.length === 1) return namesWithMain[0];
        const mainDotJava = allJavaNames.find(n => n.toLowerCase() === "main.java");
        if (mainDotJava) return mainDotJava;
        return namesWithMain[0] || "";
    }

    async function computeMainJavaFromLocal(files: File[]) {
        const javaFiles = files.filter(f => isJavaFileName(f.name));
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

    async function computeMainJavaFromServer(names: string[]) {
        const javaNames = names.filter(isJavaFileName);
        if (javaNames.length <= 1) { setMainJavaFileName(""); return; }
        const withMain: string[] = [];
        await Promise.all(javaNames.map(async (name) => {
            try {
                const url = new URL(`${API}/projects/get_source_file`);
                url.searchParams.set('project_id', String(props.id));
                url.searchParams.set('relpath', name);
                const res = await fetch(url, { headers: authHeader });
                if (!res.ok) return;
                const txt = await res.text();
                if (JAVA_MAIN_RE.test(txt)) withMain.push(name);
            } catch {
                // ignore fetch failures
            }
        }));
        setMainJavaFileName(pickMainJavaFile(javaNames, withMain));
    }

    async function loadServerSolutionFiles() {
        try {
            const res = await axios.get(
                import.meta.env.VITE_API_URL + `/projects/list_solution_files?id=${props.id}`,
                { headers: { 'Authorization': `Bearer ${localStorage.getItem("AUTOTA_AUTH_TOKEN")}` } }
            );
            const names = Array.isArray(res.data) ? res.data : [];
            setServerSolutionFileNames(names);
            setServerSolutionFileNamesSnapshot(names);
        } catch (e) {
            console.log(e);
            setServerSolutionFileNames([]);
            setServerSolutionFileNamesSnapshot([]);
        }
    }
    useEffect(() => {
        if (edit && props.id > 0) {
            loadServerSolutionFiles();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [edit, props.id]);

    // Detect which Java file is the entry point (only matters when multiple .java files exist)
    useEffect(() => {
        let cancelled = false;
        (async () => {
            if (ProjectLanguage !== "java") { if (!cancelled) setMainJavaFileName(""); return; }

            // Prefer local selection if present, otherwise server solution files
            if (SolutionFiles.length > 0) {
                await computeMainJavaFromLocal(SolutionFiles);
                return;
            }
            if (edit && serverSolutionFileNames.length > 0) {
                await computeMainJavaFromServer(serverSolutionFileNames);
                return;
            }
            if (!cancelled) setMainJavaFileName("");
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ProjectLanguage, SolutionFiles, serverSolutionFileNames, edit, props.id]);

    // Simplified icons:
    // - Code (java, python, c, racket) => code icon
    // - Text (text, word, pdf) => two-line text icon
    // - Otherwise => alternate icon
    const CODE_ICON_RE = /\.(java|py|c|h|rkt|scm)$/i;
    const TEXT_ICON_RE = /\.(txt|doc|docx|pdf)$/i;

    function getFileIconName(filename: string): string {
        if (CODE_ICON_RE.test(filename)) return 'code';
        if (TEXT_ICON_RE.test(filename)) return 'align justify';
        return 'x icon';
    }

    async function openLocalPreview(file: File) {
        if (!SUPPORTED_RE.test(file.name)) { window.alert("Preview supports .py .c .h .java .rkt .scm (.cpp optional)"); return; }
        const text = await file.text();
        setPreviewTitle(file.name); setPreviewText(text); setPreviewOpen(true);
    }

    // When multiple solution files exist, preview ALL of them in one modal
    async function openAllSolutionPreview() {
        const isLocal = SolutionFiles.length > 0;
        const names = isLocal ? SolutionFiles.map(f => f.name) : serverSolutionFileNames;
        if (names.length === 0) return;

        try {
            if (isLocal) {
                const parts = await Promise.all(
                    SolutionFiles.map(async (f) => `// ===== ${f.name} =====\n${await f.text()}`)
                );
                setPreviewTitle("Solution Files");
                setPreviewText(parts.join("\n\n"));
                setPreviewOpen(true);
                return;
            }

            // Server-side solution files: fetch each and concatenate
            const parts = await Promise.all(
                serverSolutionFileNames.map(async (name) => {
                    const url = new URL(`${API}/projects/get_source_file`);
                    url.searchParams.set('project_id', String(props.id));
                    url.searchParams.set('relpath', name);
                    const res = await fetch(url, { headers: authHeader });
                    const text = res.ok ? await res.text() : "[Could not load file from server]";
                    return `// ===== ${name} =====\n${text}`;
                })
            );
            setPreviewTitle("Solution Files");
            setPreviewText(parts.join("\n\n"));
            setPreviewOpen(true);
        } catch (e) {
            console.log(e);
            window.alert("Could not preview solution files.");
        }
    }

    const languageLabel = (() => {
        if (!ProjectLanguage) return "Not detected yet";
        if (ProjectLanguage === "java") return "Java";
        if (ProjectLanguage === "python") return "Python";
        if (ProjectLanguage === "c") return "C";
        if (ProjectLanguage === "racket") return "Racket";
        return ProjectLanguage;
    })();


    async function fetchServerFileList(): Promise<string[]> {
        const res = await fetch(`${API}/projects/list_source_files?project_id=${props.id}`, { headers: authHeader });
        if (!res.ok) return []; const data = await res.json(); const list = data.files.map((f: any) => f.relpath); setServerFiles(list); return list;
    }
    async function openServerPreview(relpath?: string) {
        const url = new URL(`${API}/projects/get_source_file`); url.searchParams.set('project_id', String(props.id)); if (relpath) url.searchParams.set('relpath', relpath);
        const res = await fetch(url, { headers: authHeader }); if (!res.ok) return; const text = await res.text();
        setPreviewTitle(relpath || "source"); setPreviewText(text); setPreviewOpen(true);
    }

    useEffect(() => {
        if (edit && props.id > 0) { fetchServerFileList(); }
    }, [edit, props.id]);


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
                    testcase.name = values[1];
                    testcase.description = values[2];
                    testcase.input = values[3];
                    testcase.output = values[4];
                    testcase.isHidden = !!values[5];


                    rows.push(testcase);

                    return testcase;
                });

                var testcase = new Testcase();
                testcase.id = -1;
                testcase.name = "";
                testcase.description = "";
                testcase.input = "";
                testcase.output = "";
                testcase.isHidden = false;

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
                        setServerProjectLanguageSnapshot(data[props.id][3]);
                        setSolutionFileNames([]);
                        setSolutionFiles([]);
                        const serverDesc = (data[props.id][5] || "") as string;
                        setDescFileName(serverDesc);
                        setServerDescFileName(serverDesc);
                        const rawAdd = data[props.id][6] ?? [];
                        let addList: string[] = [];
                        if (Array.isArray(rawAdd)) {
                            addList = rawAdd as string[];
                        } else if (typeof rawAdd === "string") {
                            try {
                                // backend sometimes returns JSON string
                                const parsed = JSON.parse(rawAdd);
                                addList = Array.isArray(parsed) ? parsed : (rawAdd ? [rawAdd] : []);
                            } catch {
                                addList = rawAdd ? [rawAdd] : [];
                            }
                        }
                        setAdditionalFileNames(addList.map(basename).filter(Boolean));
                        setShowAdditionalFile(addList.length > 0);
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

    function handleInputChange(testcase_id: number, input_data: string) {
        setModalDraft(prev => {
            if (prev && prev.id === testcase_id) {
                return { ...prev, input: input_data };
            }
            return prev;
        });
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
                    testcase.name = values[1];
                    testcase.description = values[2];
                    testcase.input = values[3];
                    testcase.output = values[4];
                    testcase.isHidden = !!values[5];
                    rows.push(testcase);

                    return testcase;
                });

                var testcase = new Testcase();
                testcase.id = -1;
                testcase.name = "";
                testcase.description = "";
                testcase.input = "";
                testcase.output = "";
                testcase.isHidden = false;

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
            formData.append("file", JsonFile!);
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
        if (SolutionFiles.length === 0 || !AssignmentDesc) {
            window.alert("Please upload your solution file(s) and the assignment description.");
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
            SolutionFiles.forEach(f => formData.append("solutionFiles", f));
            formData.append("assignmentdesc", AssignmentDesc);
            selectedAddFiles.forEach(f => formData.append("additionalFiles", f));
            if (selectedAddFiles.length === 0 && additionalFileNames.length === 0) {
                formData.append("clearAdditionalFiles", "true");
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

    async function handleEditSubmit() {
        try {
            if (!ProjectName || !ProjectStartDate || !ProjectEndDate || !ProjectLanguage) {
                window.alert("Please fill out all fields");
                return;
            }
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
            if (SolutionFiles.length > 0) {
                SolutionFiles.forEach(f => formData.append("solutionFiles", f));
            }
            if (AssignmentDesc) formData.append("assignmentdesc", AssignmentDesc);
            selectedAddFiles.forEach(f => formData.append("additionalFiles", f));
            if (removedAdditionalFiles.length > 0) {
                formData.append("removeAdditionalFiles", JSON.stringify(removedAdditionalFiles));
            }
            if (selectedAddFiles.length === 0 && additionalFileNames.length === 0) {
                formData.append("clearAdditionalFiles", "true");
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
            t.name = "";
            t.description = "";
            t.input = "";
            t.output = "";
            t.isHidden = false;
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


    function handleSolutionFilesChange(event: React.FormEvent) {

        const target = event.target as HTMLInputElement;
        const files = target.files;

        if (!files || files.length === 0) {
            setSolutionFiles([]);
            setSolutionFileNames([]);
            setProjectLanguage(edit ? (serverProjectLanguageSnapshot || ProjectLanguage) : "");
            return;
        }
        const arr = Array.from(files);

        // Enforce allowed solution-file types
        if (arr.some(f => !SOLUTION_ALLOWED_RE.test(f.name))) {
            window.alert("Solution files must be Python (.py), Java (.java), C (.c/.h), or Racket (.rkt/.scm).");
            target.value = '';
            setSolutionFiles([]);
            setSolutionFileNames([]);
            setProjectLanguage(edit ? (serverProjectLanguageSnapshot || ProjectLanguage) : "");
            return;
        }

        // Do not allow mixing solution languages in one upload
        const langs = new Set(arr.map(f => solutionLangFor(f.name)));
        langs.delete(null);
        if (langs.size > 1) {
            window.alert("Do not mix solution file types. Upload files for only ONE language at a time.");
            target.value = '';
            setSolutionFiles([]);
            setSolutionFileNames([]);
            setProjectLanguage(edit ? (serverProjectLanguageSnapshot || ProjectLanguage) : "");
            return;
        }

        // Multiple solution files are ONLY allowed for Java (and therefore must all be .java)
        const onlyLang = Array.from(langs)[0] as SolutionLang | undefined;
        if (arr.length > 1 && onlyLang !== 'java') {
            window.alert("Multiple solution files are only supported for Java. Upload a single file for other languages.");
            target.value = '';
            setSolutionFiles([]);
            setSolutionFileNames([]);
            setProjectLanguage(edit ? (serverProjectLanguageSnapshot || ProjectLanguage) : "");
            return;
        }

        setSolutionFiles(arr);
        setSolutionFileNames(arr.map(f => f.name));
        setProjectLanguage(onlyLang ?? "");
    };

    function handleJsonFileChange(event: React.FormEvent) {

        const target = event.target as HTMLInputElement;
        const files = target.files;

        if (files != null && files.length === 1) {
            setJsonFile(files[0]);
            setjsonfilename(files[0].name);
        } else {
            setJsonFile(undefined);
        }
    };

    function handleDescFileChange(event: React.FormEvent) {

        const target = event.target as HTMLInputElement;
        const files = target.files;

        if (files != null && files.length === 1) {
            // Enforce allowed description-file types
            if (!DESC_ALLOWED_RE.test(files[0].name)) {
                window.alert("Description file must be a Word document (.doc/.docx), PDF (.pdf), or text file (.txt).");
                target.value = '';
                setDescFileName('');
                setDesc(undefined);
                return;
            }
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
        if (Array.from(files).some(f => !ADD_ALLOWED_RE.test(f.name))) {
            window.alert("Additional files must be .txt");
            target.value = '';
            return;
        }
        setSelectedAddFiles(prev => {
            const existing = new Set(prev.map(f => f.name));
            const merged = [...prev];
            Array.from(files).forEach(f => {
                if (!existing.has(f.name)) merged.push(f);
            });
            return merged;
        });
    };

    function removeSelectedAdditional(name: string) {
        // Remove a newly added (not yet uploaded) file by name
        setSelectedAddFiles(prev => prev.filter(f => f.name !== name));
    }

    function removeServerAdditional(name: string) {
        // Mark an existing server additional file for removal
        setRemovedAdditionalFiles(prev => (prev.includes(name) ? prev : [...prev, name]));
        setAdditionalFileNames(prev => prev.filter(n => n !== name));
    }

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
        formData.append('project_id', props.id.toString());
        formData.append('class_id', props.class_id.toString());
        formData.append('input', modalDraft.input.toString());
        formData.append('output', modalDraft.output.toString());
        formData.append('isHidden', modalDraft.isHidden.toString());
        formData.append('description', modalDraft.description.toString());

        if (modalDraft.name === "" || modalDraft.input === "" || modalDraft.description === "") {
            window.alert("Please fill out all fields");
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
                    testcase.name = values[1];
                    testcase.description = values[2];
                    testcase.input = values[3];
                    testcase.output = values[4];
                    testcase.isHidden = !!values[5];
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

    type DirEntry = { key: string; name: string; status: 'none' | 'add' | 'remove'; kind: 'server' | 'local' | 'other' };
    const baseName = (p: string) => (p || "").split(/[\\/]/).pop()!;

    const serverNames = [
        ...(serverFiles ?? []),
        ...(serverSolutionFileNamesSnapshot ?? []),
        ...additionalFileNames,
        ...(serverDescFileName ? [serverDescFileName] : []),
    ].map(baseName);

    const localNames = [
        ...solutionFileNames,
        ...selectedAddFiles.map(f => f.name),
        ...(AssignmentDesc ? [AssignmentDesc.name] : []),
    ].map(baseName);

    const removedNames = removedAdditionalFiles.map(baseName);

    type Flag = { server: boolean; local: boolean; removed: boolean };

    const flags = new Map<string, Flag>();

    const mkEntry = (
        key: string,
        name: string,
        status: DirEntry['status'],
        kind: DirEntry['kind']
    ): DirEntry => ({ key, name, status, kind });

    const mark = (names: string[], k: 'server' | 'local' | 'removed') => {
        names.forEach(n => {
            if (!n) return;
            const cur = flags.get(n) ?? { server: false, local: false, removed: false };
            if (k === 'server') cur.server = true;
            if (k === 'local') cur.local = true;
            if (k === 'removed') cur.removed = true;
            flags.set(n, cur);
        });
    };
    mark(serverNames, 'server');
    mark(localNames, 'local');
    mark(removedNames, 'removed');

    // If user selected a NEW description file while editing, the OLD server description should be marked for removal
    if (edit && AssignmentDesc && serverDescFileName) {
        mark([baseName(serverDescFileName)], 'removed');
    }

    // If user selected NEW solution files while editing, ALL existing server solution files are replaced
    // so every pre-existing solution file should be marked "Submit changes to remove".
    if (edit && SolutionFiles.length > 0 && serverSolutionFileNamesSnapshot.length > 0) {
        mark(serverSolutionFileNamesSnapshot.map(baseName), 'removed');
    }

    const directoryEntries: DirEntry[] = Array.from(flags.entries())
        .flatMap<DirEntry>(([name, f]) => {
            if (f.server && f.local) {
                return [
                    mkEntry(`${name}__server_remove`, name, 'remove', 'server'),
                    mkEntry(`${name}__local_add`, name, 'add', 'local'),
                ];
            }
            if (f.local) {
                return [mkEntry(`${name}__add`, name, 'add', 'local')];
            }
            if (f.server || f.removed) {
                const status: DirEntry['status'] = f.removed ? 'remove' : 'none';
                return [mkEntry(`${name}__server`, name, status, 'server')];
            }
            return [mkEntry(`${name}__other`, name, 'none', 'other')];
        })
        // Ensure all "remove" rows appear above "add" rows (and both above "none")
        .sort((a, b) => {
            const rank = (s: DirEntry['status']) => (s === 'remove' ? 0 : s === 'add' ? 1 : 2);
            return (
                rank(a.status) - rank(b.status) ||
                a.name.localeCompare(b.name) ||
                a.kind.localeCompare(b.kind)
            );
        });

    // Filesystem view "Main" tag: directoryEntries is objects now, so compute using their names (deduped)
    const fsUniqueJavaNames = Array.from(new Set(directoryEntries.map(e => e.name).filter(isJavaFileName)));
    const fsShowMainTag =
        ProjectLanguage === "java" &&
        fsUniqueJavaNames.length > 1 &&
        !!mainJavaFileName;

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

                                    {/* Language (auto-detected from solution file type) */}
                                    <div className="form-group language-group">
                                        <label>Language</label>
                                        <div className="detected-language">{languageLabel}</div>
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
                                                    if (files && files.length > 0) {
                                                        handleSolutionFilesChange({ target: { files } } as any);
                                                    }
                                                }}
                                            >
                                                {(SolutionFiles.length === 0 && (!edit || serverSolutionFileNames.length === 0)) ? (
                                                    <>
                                                        <input
                                                            type="file"
                                                            className="file-input"
                                                            multiple
                                                            accept={SOLUTION_ACCEPT}
                                                            onChange={handleSolutionFilesChange}
                                                        />
                                                        <div className="file-drop-message">
                                                            Drag &amp; drop your file here or&nbsp;
                                                            <span className="browse-text">browse</span>
                                                        </div>
                                                    </>
                                                ) : (
                                                    <div className="file-preview">
                                                        {(() => {
                                                            const shownNames = (SolutionFiles.length > 0 ? SolutionFiles.map(f => f.name) : serverSolutionFileNames);
                                                            const showMainTag =
                                                                ProjectLanguage === "java" &&
                                                                shownNames.filter(isJavaFileName).length > 1 &&
                                                                !!mainJavaFileName;
                                                            return (
                                                                <>
                                                                    {/* Always show ONLY the blue switch icon */}
                                                                    <button
                                                                        type="button"
                                                                        className="exchange-icon"
                                                                        title={SolutionFiles.length > 0 ? "Clear selected solution files" : "Replace server solution files"}
                                                                        aria-label={SolutionFiles.length > 0 ? "Clear selected solution files" : "Replace server solution files"}
                                                                        onClick={(e) => {
                                                                            e.preventDefault();
                                                                            if (SolutionFiles.length > 0) {
                                                                                setSolutionFiles([]);
                                                                                setSolutionFileNames([]);
                                                                            } else if (edit && serverSolutionFileNames.length > 0) {
                                                                                setServerSolutionFileNames([]);
                                                                            }
                                                                        }}
                                                                    >
                                                                        <i className="exchange icon" aria-hidden="true"></i>
                                                                    </button>

                                                                    <div
                                                                        className="file-preview-list"
                                                                        role={(shownNames.length > 1) ? "button" : undefined}
                                                                        tabIndex={(shownNames.length > 1) ? 0 : undefined}
                                                                        title={(shownNames.length > 1) ? "Click to preview ALL solution files" : undefined}
                                                                        onClick={(e) => {
                                                                            if (shownNames.length > 1) {
                                                                                e.preventDefault();
                                                                                openAllSolutionPreview();
                                                                            }
                                                                        }}
                                                                        onKeyDown={(e) => {
                                                                            if (shownNames.length > 1 && (e.key === "Enter" || e.key === " ")) {
                                                                                e.preventDefault();
                                                                                openAllSolutionPreview();
                                                                            }
                                                                        }}
                                                                    >
                                                                        {shownNames.map((name) => (
                                                                            <div key={name} className="file-preview-row solution-file-card">
                                                                                <span className="file-icon-wrapper" aria-hidden="true">
                                                                                    <i className="file outline icon file-outline-icon" />
                                                                                    <i className={`${getFileIconName(name)} icon file-language-icon`} />
                                                                                </span>
                                                                                {(shownNames.length > 1) ? (
                                                                                    <span className="file-name">
                                                                                        {name}
                                                                                        {showMainTag && isJavaFileName(name) && name === mainJavaFileName && (
                                                                                            <span className="main-indicator">Main</span>
                                                                                        )}
                                                                                    </span>
                                                                                ) : (
                                                                                    <button
                                                                                        type="button"
                                                                                        className="file-name"
                                                                                        title="Click to preview"
                                                                                        onClick={(e) => {
                                                                                            e.preventDefault();
                                                                                            if (SolutionFiles.length > 0) {
                                                                                                const file = SolutionFiles.find(x => x.name === name);
                                                                                                if (file) openLocalPreview(file);
                                                                                            } else {
                                                                                                openServerPreview(name);
                                                                                            }
                                                                                        }}
                                                                                    >
                                                                                        {name}
                                                                                        {showMainTag && isJavaFileName(name) && name === mainJavaFileName && (
                                                                                            <span className="main-indicator">Main</span>
                                                                                        )}
                                                                                    </button>
                                                                                )}
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </>
                                                            );
                                                        })()}
                                                    </div >
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
                                                    if (files && files.length > 0) {
                                                        handleSolutionFilesChange({ target: { files } } as any);
                                                    }
                                                }}
                                            >
                                                {!descfileName ? (
                                                    <>
                                                        <input
                                                            type="file"
                                                            className="file-input"
                                                            id="descFile"
                                                            accept={DESC_ACCEPT}
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
                                                            className="exchange-icon"
                                                            onClick={() => {
                                                                setDescFileName('');
                                                                setDesc(undefined);
                                                                const el = document.getElementById('descFile') as HTMLInputElement | null;
                                                                if (el) el.value = '';
                                                            }}
                                                        >
                                                            <i className="exchange icon"></i>
                                                        </button>

                                                        <div className="file-preview-list">
                                                            <div className="file-preview-row solution-file-card">
                                                                <span className="file-icon-wrapper" aria-hidden="true">
                                                                    <i className="file outline icon file-outline-icon" />
                                                                    <i className={`${getFileIconName(descfileName)} icon file-language-icon`} />
                                                                </span>
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
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>


                                        {/* Project Filesystem View (always visible, not part of the file-section row) */}
                                        <div className="filesystem-segment">
                                            <h1 className="info-title">Project Filesystem View</h1>
                                            {directoryEntries.length > 0 ? (
                                                <div className="directory-tree" role="tree" aria-label="Current directory">
                                                    <div className="tree-rail" aria-hidden="true"></div>
                                                    <ul className="tree-list">
                                                        {directoryEntries.map((entry) => {
                                                            const name = entry.name;
                                                            const isAdded = !!selectedAddFiles.find(f => f.name === name);
                                                            const isServer = additionalFileNames.includes(name);

                                                            return (
                                                                <li className="tree-row" role="treeitem" key={entry.key}>
                                                                    <span className="tree-icon" aria-hidden="true">
                                                                        <span className="fs-file-icon-wrapper">
                                                                            <i className="file outline icon fs-file-outline-icon" />
                                                                            <i className={`${getFileIconName(name)} icon fs-file-language-icon`} />
                                                                        </span>
                                                                    </span>
                                                                    <span className="tree-name">
                                                                        {name}
                                                                        {fsShowMainTag && isJavaFileName(name) && name === mainJavaFileName && (
                                                                            <span className="main-indicator">Main</span>
                                                                        )}
                                                                    </span>
                                                                    {entry.status === 'remove' && (
                                                                        <span className="file-status removed">Submit changes to remove</span>
                                                                    )}
                                                                    {entry.status === 'add' && (
                                                                        <span className="file-status added">Submit changes to add</span>
                                                                    )}
                                                                    {isServer ? (
                                                                        <button
                                                                            type="button"
                                                                            className="tree-remove-button from-server"
                                                                            onClick={() => removeServerAdditional(name)}
                                                                        >
                                                                            Remove
                                                                        </button>
                                                                    ) : isAdded ? (
                                                                        <button
                                                                            type="button"
                                                                            className="tree-remove-button from-selected"
                                                                            onClick={() => removeSelectedAdditional(name)}
                                                                        >
                                                                            Remove
                                                                        </button>
                                                                    ) : null}
                                                                </li>
                                                            );
                                                        })}
                                                    </ul>
                                                </div>
                                            ) : (
                                                <div className="filesystem-empty">No files yet.</div>
                                            )}
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
                                                {showAdditionalFile ? 'Optional additional text file: On' : 'Optional additional text file: Off'}
                                            </button>
                                        </div>

                                        {showAdditionalFile && (
                                            <div className="info-segment optional-additional-file-segment">
                                                <h1 className="info-title">Optional Additional Files</h1>
                                                <div
                                                    className="file-drop-area optional-additional-file-drop"
                                                    onDragOver={e => e.preventDefault()}
                                                    onDrop={e => {
                                                        e.preventDefault();
                                                        const files = e.dataTransfer.files;
                                                        if (files && files.length > 0) {
                                                            handleAdditionalFileChange({ target: { files } } as any);
                                                        }
                                                    }}
                                                >
                                                    <input
                                                        type="file"
                                                        className="file-input optional-additional-file-input"
                                                        multiple
                                                        accept={ADD_ACCEPT}
                                                        onChange={handleAdditionalFileChange}
                                                    />
                                                    <div className="file-drop-message">
                                                        Drag &amp; drop your file(s) here or&nbsp;
                                                        <span className="browse-text">browse</span>
                                                    </div>
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
                                            if (files && files.length > 0) {
                                                handleDescFileChange({ target: { files } } as any);
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
                                                <span className="file-icon-wrapper" aria-hidden="true">
                                                    <i className="file outline icon file-outline-icon" />
                                                    <i className={`${getFileIconName(jsonfilename)} icon file-language-icon`} />
                                                </span>
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
                                onClick={() => { setPreviewOpen(false); }}
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