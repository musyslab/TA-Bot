import React, { CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import MenuComponent from "../components/MenuComponent";
import ErrorMessage from "../components/ErrorMessage";
import LoadingAnimation from "../components/LoadingAnimation";
import { Helmet } from "react-helmet";
import { useParams, Link } from "react-router-dom";
import DirectoryBreadcrumbs from "../components/DirectoryBreadcrumbs";
import "../../styling/StudentUpload.scss";
import "../../styling/FileUploadCommon.scss";

import {
  FaAlignJustify,
  FaBan,
  FaCloudUploadAlt,
  FaCode,
  FaDownload,
  FaExchangeAlt,
  FaRegFile,
  FaTimesCircle,
  FaExternalLinkAlt,
  FaCheckCircle,
  FaEye,
  FaFilePowerpoint,
} from "react-icons/fa";

type CheckpointLite = {
  id: number;
  number?: number;
  name?: string;
  enabled?: boolean;
  solved?: boolean;
  rewarded?: boolean;
};

type AssignedClassLite = {
  id: number;
  school_id?: number;
};

type ModuleObjectLite = {
  Id: number;
  ClassId: number;
  Name: string;
  Start: string;
  End: string;
  MainProjectId?: number;
};

type PastSubmissionMain = {
  submissionId?: number;
  submission_id?: number;
  id?: number;
  Id?: number;
  passed?: boolean;
  time?: string;
};

type PastSubmissionCheckpoint = {
  checkpointId?: number;
  checkpoint_id?: number;
  practiceProblemId?: number;
  practice_problem_id?: number;
  id?: number;
  Id?: number;
  number?: number;
  name?: string;
  submissionId?: number;
  submission_id?: number;
  passed?: boolean;
  time?: string;
};

type ApiPastSubmissionsProject = {
  projectId?: number;
  project_id?: number;
  id?: number;
  Id?: number;
  projectName?: string;
  project_name?: string;
  main?: PastSubmissionMain | null;
  checkpoints?: PastSubmissionCheckpoint[];
  practices?: PastSubmissionCheckpoint[];
};

const RECENT_SUBMISSION_STORAGE_PREFIX = "AUTOTA_RECENT_STUDENT_SUBMISSION";

const authHeader = () => ({
  Authorization: `Bearer ${localStorage.getItem("AUTOTA_AUTH_TOKEN")}`,
});

const parsePositiveInt = (value: string | undefined): number | null => {
  if (value === undefined || !/^\d+$/.test(value)) return null;

  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const normalizeMaybeJson = <T,>(item: unknown): T => {
  if (typeof item === "string") {
    return JSON.parse(item) as T;
  }

  return item as T;
};

const normalizePositiveSubmissionId = (
  value: number | string | null | undefined,
): number | string | null => {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const n = Number(value);
  if (Number.isFinite(n) && n > 0) {
    return Number.isInteger(n) ? n : String(value);
  }

  return null;
};

const getPayloadSubmissionId = (payload: any): number | string | null => {
  const candidates = [
    payload?.submission_id,
    payload?.SubmissionId,
    payload?.submissionId,
    payload?.sid,
    payload?.Sid,
    payload?.id,
    payload?.Id,
    payload?.latest_submission_id,
    payload?.LatestSubmissionId,
    payload?.submission?.id,
    payload?.submission?.Id,
  ];

  const found = candidates.find(
    (candidate) => candidate !== undefined && candidate !== null && candidate !== "",
  );

  return normalizePositiveSubmissionId(found);
};

const getPastProjectId = (row: ApiPastSubmissionsProject): number => {
  return Number(row?.projectId ?? row?.project_id ?? row?.id ?? row?.Id ?? 0);
};

const getPastMainSubmissionId = (
  row: ApiPastSubmissionsProject,
): number | string | null => {
  const main = row?.main;
  if (!main) return null;

  return normalizePositiveSubmissionId(
    main.submissionId ?? main.submission_id ?? main.id ?? main.Id,
  );
};

const getPastCheckpointId = (row: PastSubmissionCheckpoint): number => {
  return Number(
    row?.checkpointId ??
    row?.checkpoint_id ??
    row?.practiceProblemId ??
    row?.practice_problem_id ??
    row?.id ??
    row?.Id ??
    0,
  );
};

const getPastCheckpointSubmissionId = (
  row: PastSubmissionCheckpoint,
): number | string | null => {
  return normalizePositiveSubmissionId(
    row?.submissionId ?? row?.submission_id,
  );
};

const downloadBlobResponse = (res: any, fallbackName: string) => {
  const type =
    (res.headers as any)["content-type"] || "application/octet-stream";
  const blob = new Blob([res.data], { type });
  const name = (res.headers as any)["x-filename"] || fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = name;

  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
};

const StudentUpload = () => {
  const {
    school_id,
    class_id,
    module_id,
    project_id: route_project_id,
    checkpoint_id,
  } = useParams<{
    school_id?: string;
    class_id?: string;
    module_id?: string;
    project_id?: string;
    checkpoint_id?: string;
  }>();

  const cid = parsePositiveInt(class_id) ?? -1;
  const schoolId = parsePositiveInt(school_id);
  const moduleId = parsePositiveInt(module_id);
  const routeProjectId = parsePositiveInt(route_project_id);

  const checkpointId = parsePositiveInt(checkpoint_id);
  const isCheckpoint = checkpointId !== null;

  const hasModuleRoute =
    schoolId !== null && moduleId !== null && routeProjectId !== null;

  const [files, setFiles] = useState<File[]>([]);
  const [mainJavaFileName, setMainJavaFileName] = useState<string>("");

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error_message, setError_Message] = useState<string>("");
  const [isErrorMessageHidden, setIsErrorMessageHidden] =
    useState<boolean>(true);

  const [project_id, setProject_id] = useState<number>(routeProjectId ?? 0);
  const [is_allowed_to_submit] = useState<boolean>(true);

  const [suggestions, setSuggestions] = useState<string>("");
  const feedbackRef = useRef<HTMLTextAreaElement | null>(null);

  const [project_name, setProject_name] = useState<string>("");
  const [dueDate, setDueDate] = useState<string>("");

  const [passedAllTests, setPassedAllTests] = useState<boolean>(false);
  const [checkedPassedAll, setCheckedPassedAll] = useState<boolean>(false);
  const [testcasesPassedCount, setTestcasesPassedCount] = useState<number>(0);
  const [testcasesTotalCount, setTestcasesTotalCount] = useState<number>(0);
  const [previousSubmissionId, setPreviousSubmissionId] = useState<number | string | null>(null);

  const [moduleName, setModuleName] = useState<string>("");
  const [checkpointLabel, setCheckpointLabel] = useState<string>("");
  const [hideClassSelectionCrumb, setHideClassSelectionCrumb] =
    useState<boolean>(false);

  const autoGrowTextarea = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  const testcaseProgress = useMemo(() => {
    const total = Math.max(0, testcasesTotalCount);
    const passed = Math.max(0, Math.min(testcasesPassedCount, total));
    const pct = total === 0 ? 0 : Math.round((passed / total) * 100);
    return { total, passed, pct };
  }, [testcasesPassedCount, testcasesTotalCount]);

  const canSubmit = !passedAllTests;

  const ALLOWED_EXTS = [".py", ".java", ".c", ".rkt"];
  const isJavaFile = (f: File) => f.name.toLowerCase().endsWith(".java");
  const isJavaFileName = (n: string) => /\.java$/i.test(n);

  const isAllowedFileName = (name: string) => {
    const ext = "." + (name.split(".").pop() || "").toLowerCase();
    return ALLOWED_EXTS.includes(ext);
  };

  const previousSubmissionStorageKey = useMemo(() => {
    if (!Number.isFinite(cid) || cid <= 0 || !project_id || project_id <= 0 || project_id === -1) {
      return "";
    }

    const checkpointPart =
      isCheckpoint && checkpointId ? `checkpoint:${checkpointId}` : "main";

    return `${RECENT_SUBMISSION_STORAGE_PREFIX}:${cid}:${project_id}:${checkpointPart}`;
  }, [cid, project_id, isCheckpoint, checkpointId]);

  const rememberPreviousSubmissionId = (submissionId: number | string | null) => {
    const normalized = normalizePositiveSubmissionId(submissionId);

    if (normalized === null) {
      return;
    }

    setPreviousSubmissionId(normalized);

    if (previousSubmissionStorageKey) {
      localStorage.setItem(previousSubmissionStorageKey, String(normalized));
    }
  };

  const clearPreviousSubmissionId = () => {
    setPreviousSubmissionId(null);

    if (previousSubmissionStorageKey) {
      localStorage.removeItem(previousSubmissionStorageKey);
    }
  };

  const resolveLatestSubmissionFromPastSubmissions = (
    rows: ApiPastSubmissionsProject[],
  ): number | string | null => {
    if (!project_id || project_id <= 0 || project_id === -1) {
      return null;
    }

    const projectRow = rows.find((row) => getPastProjectId(row) === project_id);

    if (!projectRow) {
      return null;
    }

    if (isCheckpoint) {
      if (!checkpointId) {
        return null;
      }

      const checkpointRows = [
        ...(Array.isArray(projectRow.checkpoints) ? projectRow.checkpoints : []),
        ...(Array.isArray(projectRow.practices) ? projectRow.practices : []),
      ];

      const checkpointRow = checkpointRows.find(
        (row) => getPastCheckpointId(row) === checkpointId,
      );

      return getPastCheckpointSubmissionId(checkpointRow as PastSubmissionCheckpoint);
    }

    return getPastMainSubmissionId(projectRow);
  };

  const fetchLatestSubmissionFromPastSubmissions = () => {
    const token = localStorage.getItem("AUTOTA_AUTH_TOKEN");

    if (
      !token ||
      !Number.isFinite(cid) ||
      cid <= 0 ||
      !project_id ||
      project_id <= 0 ||
      project_id === -1
    ) {
      clearPreviousSubmissionId();
      return;
    }

    axios
      .get(`${import.meta.env.VITE_API_URL}/projects/past-submissions`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((res) => {
        const rows: ApiPastSubmissionsProject[] =
          typeof res.data === "string" ? JSON.parse(res.data) : (res.data ?? []);

        const latestSubmissionId = resolveLatestSubmissionFromPastSubmissions(rows);

        if (latestSubmissionId !== null) {
          rememberPreviousSubmissionId(latestSubmissionId);
          return;
        }

        clearPreviousSubmissionId();
      })
      .catch(() => {
        clearPreviousSubmissionId();
      });
  };

  const JAVA_MAIN_RE = /\bpublic\s+static\s+void\s+main\s*\(/;

  function pickMainJavaFile(
    allJavaNames: string[],
    namesWithMain: string[],
  ): string {
    if (namesWithMain.length === 1) return namesWithMain[0];

    const mainDotJava = allJavaNames.find(
      (n) => n.toLowerCase() === "main.java",
    );
    if (mainDotJava) return mainDotJava;

    return namesWithMain[0] || "";
  }

  async function computeMainJavaFromLocal(localFiles: File[]) {
    const javaFiles = localFiles.filter((f) => isJavaFileName(f.name));

    if (javaFiles.length <= 1) {
      setMainJavaFileName("");
      return;
    }

    const withMain: string[] = [];

    for (const f of javaFiles) {
      try {
        const txt = await f.text();
        if (JAVA_MAIN_RE.test(txt)) withMain.push(f.name);
      } catch {
        // Ignore read failures.
      }
    }

    setMainJavaFileName(
      pickMainJavaFile(
        javaFiles.map((f) => f.name),
        withMain,
      ),
    );
  }

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!(files.length > 1 && files.every(isJavaFile))) {
        if (!cancelled) setMainJavaFileName("");
        return;
      }

      await computeMainJavaFromLocal(files);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files]);

  useEffect(() => {
    autoGrowTextarea(feedbackRef.current);
  }, [suggestions]);

  useEffect(() => {
    const token = localStorage.getItem("AUTOTA_AUTH_TOKEN");

    if (!token || !Number.isFinite(cid) || cid <= 0) {
      setHideClassSelectionCrumb(false);
      return;
    }

    axios
      .get(`${import.meta.env.VITE_API_URL}/class/all?filter=true`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((res) => {
        const rows = Array.isArray(res.data)
          ? (res.data as AssignedClassLite[])
          : [];
        const uniqueSchoolIds = new Set(
          rows
            .map((row) => Number(row.school_id))
            .filter(
              (rowSchoolId) => Number.isFinite(rowSchoolId) && rowSchoolId > 0,
            ),
        );

        setHideClassSelectionCrumb(
          rows.length === 1 &&
          uniqueSchoolIds.size === 1 &&
          Number(rows[0]?.id) === cid,
        );
      })
      .catch(() => {
        setHideClassSelectionCrumb(false);
      });
  }, [cid]);

  useEffect(() => {
    getSubmissionDetails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid, routeProjectId, moduleId]);

  useEffect(() => {
    if (!previousSubmissionStorageKey) {
      return;
    }

    const storedSubmissionId = localStorage.getItem(previousSubmissionStorageKey);
    if (storedSubmissionId) {
      setPreviousSubmissionId(storedSubmissionId);
    }
  }, [previousSubmissionStorageKey]);

  useEffect(() => {
    if (!project_id || project_id <= 0 || project_id === -1) {
      setPassedAllTests(false);
      setCheckedPassedAll(true);
      setTestcasesPassedCount(0);
      setTestcasesTotalCount(0);
      clearPreviousSubmissionId();
      return;
    }

    setCheckedPassedAll(false);

    const qs =
      isCheckpoint && checkpointId
        ? `&checkpoint=1&checkpoint_id=${checkpointId}`
        : "";

    axios
      .get(
        `${import.meta.env.VITE_API_URL}/submissions/testcaseerrors?class_id=${cid}&id=${project_id}${qs}`,
        { headers: authHeader() },
      )
      .then((res) => {
        let payload: any = res?.data;

        if (typeof payload === "string") {
          try {
            payload = JSON.parse(payload);
          } catch {
            payload = {};
          }
        }

        const results = Array.isArray(payload?.results) ? payload.results : [];
        const passedCount = results.filter((r: any) => {
          const v = r?.passed ?? r?.ok ?? r?.State;
          return v === true;
        }).length;
        const allPassed = results.length > 0 && passedCount === results.length;

        setTestcasesPassedCount(passedCount);
        setTestcasesTotalCount(results.length);
        setPassedAllTests(allPassed);
        setCheckedPassedAll(true);

        const payloadSubmissionId = getPayloadSubmissionId(payload);
        if (payloadSubmissionId !== null) {
          rememberPreviousSubmissionId(payloadSubmissionId);
        }
      })
      .catch(() => {
        setTestcasesPassedCount(0);
        setTestcasesTotalCount(0);
        setPassedAllTests(false);
        setCheckedPassedAll(true);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project_id, isCheckpoint, checkpointId, cid]);

  useEffect(() => {
    fetchLatestSubmissionFromPastSubmissions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project_id, isCheckpoint, checkpointId, cid]);

  useEffect(() => {
    if (passedAllTests) {
      setFiles([]);
      setIsErrorMessageHidden(true);
      setError_Message("");
    }
  }, [passedAllTests]);

  useEffect(() => {
    if (!isCheckpoint || !checkpointId || !project_id || project_id <= 0) {
      setCheckpointLabel("");
      return;
    }

    axios
      .get(
        `${import.meta.env.VITE_API_URL}/projects/list_checkpoints_student?project_id=${project_id}`,
        { headers: authHeader() },
      )
      .then((res) => {
        const probs = (res?.data?.problems ?? []) as CheckpointLite[];
        const found = Array.isArray(probs)
          ? probs.find((p) => Number(p?.id) === checkpointId)
          : undefined;

        const n = Number(found?.number ?? checkpointId);
        const left = n ? `Checkpoint ${n}` : "Checkpoint";
        const name = String(
          found?.name || (n ? `Checkpoint ${n}` : "Checkpoint"),
        );

        setCheckpointLabel(`${left}: ${name}`);
      })
      .catch(() => {
        setCheckpointLabel(
          `Checkpoint ${checkpointId}: Checkpoint ${checkpointId}`,
        );
      });
  }, [isCheckpoint, checkpointId, project_id]);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    if (passedAllTests) {
      setFiles([]);
      setError_Message("");
      setIsErrorMessageHidden(true);
      event.currentTarget.value = "";
      return;
    }

    const selected = event.target.files ? Array.from(event.target.files) : [];
    const valid = selected.filter((f) => isAllowedFileName(f.name));

    if (selected.length && valid.length === 0) {
      setError_Message("Only .py, .java, .c, or .rkt files are allowed.");
      setIsErrorMessageHidden(false);
      event.currentTarget.value = "";
      return;
    }

    if (selected.length !== valid.length) {
      setError_Message("Only .py, .java, .c, or .rkt files are allowed.");
      setIsErrorMessageHidden(false);
      event.currentTarget.value = "";
      return;
    }

    if (valid.length > 1 && !valid.every(isJavaFile)) {
      setFiles([]);
      setError_Message(
        "Multi-file upload is only available for Java (.java) files.",
      );
      setIsErrorMessageHidden(false);
      event.currentTarget.value = "";
      return;
    }

    setIsErrorMessageHidden(true);
    setFiles(valid);
  }

  function getSubmissionDetails() {
    if (!Number.isFinite(cid) || cid <= 0) {
      setProject_name("");
      setProject_id(-1);
      return;
    }

    if (hasModuleRoute && routeProjectId) {
      setProject_id(routeProjectId);

      axios
        .get(
          `${import.meta.env.VITE_API_URL}/projects/get_modules_by_class_id_student?id=${cid}`,
          {
            headers: authHeader(),
          },
        )
        .then((res) => {
          const modules: ModuleObjectLite[] = Array.isArray(res.data)
            ? res.data.map((item: unknown) =>
              normalizeMaybeJson<ModuleObjectLite>(item),
            )
            : [];

          const selectedModule =
            modules.find((item) => Number(item.Id) === Number(moduleId)) ||
            null;

          if (selectedModule) {
            setModuleName(selectedModule.Name || "");
          }
        })
        .catch(() => {
          setModuleName("");
        });

      axios
        .get(
          `${import.meta.env.VITE_API_URL}/submissions/GetSubmissionDetails?class_id=${cid}`,
          {
            headers: authHeader(),
          },
        )
        .then((res) => {
          const activeProjectId = Number(res.data?.[5] || 0);

          if (activeProjectId === routeProjectId) {
            setProject_name(res.data?.[3] || "");
            setDueDate(res.data?.[4] || "");
            return;
          }

          setProject_name("");
          setDueDate("");
        })
        .catch(() => {
          setProject_name("");
          setDueDate("");
        });

      return;
    }

    axios
      .get(
        `${import.meta.env.VITE_API_URL}/submissions/GetSubmissionDetails?class_id=${cid}`,
        {
          headers: authHeader(),
        },
      )
      .then((res) => {
        setProject_name(res.data[3]);
        setDueDate(res.data[4]);
        setProject_id(Number(res.data[5] || 0));
      })
      .catch(() => {
        setProject_name("");
        setProject_id(-1);
      });
  }

  const downloadAssignment = (pid: number) => {
    if (!pid || pid <= 0) return;

    const qs =
      isCheckpoint && checkpointId ? `&checkpoint_id=${checkpointId}` : "";

    axios
      .get(
        `${import.meta.env.VITE_API_URL}/projects/getAssignmentDescription?project_id=${pid}${qs}`,
        {
          headers: authHeader(),
          responseType: "blob",
        },
      )
      .then((res) => downloadBlobResponse(res, "assignment_description"))
      .catch((err) => console.error("Download failed:", err));
  };

  function submitSuggestions() {
    axios
      .post(
        `${import.meta.env.VITE_API_URL}/submissions/submit_suggestion`,
        { suggestion: suggestions },
        { headers: authHeader() },
      )
      .then(
        () => {
          alert(
            "Thank you for your constructive feedback. If you have any other suggestions, please submit them.",
          );
        },
        () => {
          alert(
            "There was an error submitting your feedback. Please try again later.",
          );
        },
      );
  }

  function getResultsHref(submissionId?: number | string) {
    const sidPart = submissionId !== undefined ? `/${submissionId}` : "";

    if (hasModuleRoute && schoolId && moduleId && routeProjectId) {
      if (isCheckpoint && checkpointId) {
        return `/student/school/${schoolId}/class/${cid}/module/${moduleId}/project/${routeProjectId}/checkpoint/${checkpointId}/code${sidPart}`;
      }

      return `/student/school/${schoolId}/class/${cid}/module/${moduleId}/project/${routeProjectId}/code${sidPart}`;
    }

    const qs =
      isCheckpoint && checkpointId
        ? `?checkpoint=1&checkpoint_id=${checkpointId}`
        : "";

    if (class_id !== undefined) {
      return `/student/${class_id}/code${sidPart}${qs}`;
    }

    return `code${sidPart}${qs}`;
  }

  function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();

    if (passedAllTests) return;

    if (!Number.isFinite(cid) || cid <= 0) {
      setError_Message("Missing class id.");
      setIsErrorMessageHidden(false);
      return;
    }

    if (!project_id || project_id <= 0 || project_id === -1) {
      setError_Message("No active project was found for this upload.");
      setIsErrorMessageHidden(false);
      return;
    }

    if (files.length === 0) {
      setError_Message("Please select a file to upload.");
      setIsErrorMessageHidden(false);
      return;
    }

    if (files.length > 1 && !files.every(isJavaFile)) {
      setError_Message(
        "Multi-file upload is only available for Java (.java) files.",
      );
      setIsErrorMessageHidden(false);
      return;
    }

    if (files.some((f) => !isAllowedFileName(f.name))) {
      setError_Message("Only .py, .java, .c, or .rkt files are allowed.");
      setIsErrorMessageHidden(false);
      return;
    }

    setIsErrorMessageHidden(true);
    setIsLoading(true);

    const formData = new FormData();

    files.forEach((f) => formData.append("files", f, f.name));
    formData.append("class_id", cid.toString());
    formData.append("project_id", project_id.toString());

    if (hasModuleRoute && moduleId) {
      formData.append("module_id", moduleId.toString());
    }

    if (isCheckpoint) {
      if (!checkpointId) {
        setError_Message("Missing checkpoint id.");
        setIsErrorMessageHidden(false);
        setIsLoading(false);
        return;
      }

      formData.append("checkpoint", "true");
      formData.append("checkpoint_id", String(checkpointId));
    }

    axios
      .post(`${import.meta.env.VITE_API_URL}/upload/`, formData, {
        headers: authHeader(),
      })
      .then((res) => {
        const sid = getPayloadSubmissionId(res?.data);

        if (sid !== null) {
          rememberPreviousSubmissionId(sid);
          window.location.href = getResultsHref(sid);
          return;
        }

        fetchLatestSubmissionFromPastSubmissions();
        window.location.href = getResultsHref();
      })
      .catch((err) => {
        setError_Message(err.response?.data?.message || "Upload failed.");
        setIsErrorMessageHidden(false);
        setIsLoading(false);
      });
  }

  const CODE_ICON_RE = /\.(py|java|c|h|rkt|scm|cpp)$/i;
  const TEXT_ICON_RE = /\.(txt|md|pdf|doc|docx)$/i;

  const getFileIcon = (filename: string) => {
    if (CODE_ICON_RE.test(filename))
      return <FaCode className="file-language-icon" aria-hidden="true" />;
    if (TEXT_ICON_RE.test(filename)) {
      return (
        <FaAlignJustify className="file-language-icon" aria-hidden="true" />
      );
    }

    return <FaTimesCircle className="file-language-icon" aria-hidden="true" />;
  };

  const pageTitle = useMemo(() => {
    if (isCheckpoint) {
      return (
        checkpointLabel ||
        (checkpointId
          ? `Checkpoint ${checkpointId}: Checkpoint ${checkpointId}`
          : "")
      );
    }

    if (project_name) return `Main Project: ${project_name.replace(/_/g, " ")}`;
    if (moduleName) return `Main Project: ${moduleName}`;

    return "";
  }, [isCheckpoint, checkpointLabel, checkpointId, project_name, moduleName]);

  const breadcrumbsItems = useMemo(() => {
    const titleLabel =
      pageTitle || (isCheckpoint ? "Checkpoint Upload" : "Project Upload");

    if (hasModuleRoute && schoolId && moduleId) {
      return [
        { label: "School Selection", to: "/student/schools" },
        { label: "Class Selection", to: `/student/school/${schoolId}/classes` },
        {
          label: "Module List",
          to: `/student/school/${schoolId}/class/${cid}/modules`,
        },
        {
          label: "Module Details",
          to: `/student/school/${schoolId}/class/${cid}/module/${moduleId}`,
        },
        { label: "Student Upload" },
      ];
    }

    if (isCheckpoint) {
      return hideClassSelectionCrumb
        ? [
          { label: "Project Upload", to: `/student/${class_id}/upload` },
          {
            label: "Checkpoint Select",
            to: `/student/${class_id}/checkpoint`,
          },
          { label: titleLabel },
        ]
        : [
          { label: "Class Selection", to: "/student/classes" },
          { label: "Project Upload", to: `/student/${class_id}/upload` },
          {
            label: "Checkpoint Select",
            to: `/student/${class_id}/checkpoint`,
          },
          { label: titleLabel },
        ];
    }

    return hideClassSelectionCrumb
      ? [{ label: titleLabel }]
      : [
        { label: "Class Selection", to: "/student/classes" },
        { label: titleLabel },
      ];
  }, [
    pageTitle,
    hasModuleRoute,
    schoolId,
    moduleId,
    cid,
    isCheckpoint,
    hideClassSelectionCrumb,
    class_id,
  ]);

  const latestSubmissionHref = previousSubmissionId
    ? getResultsHref(previousSubmissionId)
    : "";

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
          <header className="panel-header assignment-quest-hero">
            <div className="assignment-quest-copy">
              <h1 className="panel-title panel-title--project">
                {pageTitle || "No Active Project"}
              </h1>
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
                  <span>Download Instructions</span>
                </button>

                <button
                  type="button"
                  className="presentation-download"
                  disabled
                  aria-disabled="true"
                  aria-label="Download presentation unavailable"
                  title="Download presentation unavailable"
                >
                  <FaFilePowerpoint aria-hidden="true" />
                  <span>Download Presentation</span>
                </button>
              </div>
            </div>

            <div className="assignment-quest-side">
              <div className="assignment-quest-progress-card">
                <div
                  className="assignment-quest-progress-ring"
                  style={
                    {
                      "--progress-percent": `${testcaseProgress.pct}%`,
                    } as CSSProperties
                  }
                >
                  <span>{testcaseProgress.pct}%</span>
                </div>

                <div className="assignment-quest-progress-title">
                  {checkedPassedAll
                    ? `${testcaseProgress.passed} / ${testcaseProgress.total} testcases passed`
                    : "Checking testcases..."}
                </div>
              </div>

              <div className="previous-submission-card">
                <div>
                  <div className="previous-submission-title">Previous Submission</div>
                  <p>Review your latest submitted code and testcase results.</p>
                </div>

                {previousSubmissionId ? (
                  <Link
                    to={latestSubmissionHref}
                    className="previous-submission-button"
                    aria-label="View previous submission"
                  >
                    <FaEye aria-hidden="true" />
                    <span>View Submission</span>
                  </Link>
                ) : (
                  <button
                    type="button"
                    className="previous-submission-button is-disabled"
                    disabled
                    aria-disabled="true"
                  >
                    <FaEye aria-hidden="true" />
                    <span>No Submission Yet</span>
                  </button>
                )}
              </div>
            </div>
          </header>

          <form
            className={`upload-form ${isLoading ? "is-loading" : ""}`}
            onSubmit={handleSubmit}
          >
            <div className="dropzone">
              <div
                className="file-drop-area"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();

                  if (passedAllTests) return;

                  const dropped = Array.from(e.dataTransfer.files || []);
                  const valid = dropped.filter((f) =>
                    isAllowedFileName(f.name),
                  );

                  if (dropped.length && valid.length === 0) {
                    setError_Message(
                      "Only .py, .java, .c, or .rkt files are allowed.",
                    );
                    setIsErrorMessageHidden(false);
                    return;
                  }

                  if (dropped.length !== valid.length) {
                    setError_Message(
                      "Only .py, .java, .c, or .rkt files are allowed.",
                    );
                    setIsErrorMessageHidden(false);
                    return;
                  }

                  if (valid.length > 1 && !valid.every(isJavaFile)) {
                    setFiles([]);
                    setError_Message(
                      "Multi-file upload is only available for Java (.java) files.",
                    );
                    setIsErrorMessageHidden(false);
                    return;
                  }

                  setIsErrorMessageHidden(true);
                  setFiles(valid);
                }}
              >
                {passedAllTests ? (
                  <div
                    className="complete-message"
                    role="status"
                    aria-live="polite"
                  >
                    <FaCheckCircle
                      className="complete-icon"
                      aria-hidden="true"
                    />
                    <h2 className="complete-title">All tests passed!</h2>
                    <p className="complete-text">
                      You&apos;re finished
                      {isCheckpoint
                        ? " with this checkpoint"
                        : " with this assignment"}
                      . Further submissions are disabled.
                    </p>

                    {previousSubmissionId ? (
                      <Link to={latestSubmissionHref} className="complete-link">
                        View your latest results{" "}
                        <FaExternalLinkAlt aria-hidden="true" />
                      </Link>
                    ) : (
                      <span className="complete-link is-disabled">
                        Latest results unavailable
                      </span>
                    )}
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
                      <FaCloudUploadAlt
                        className="file-drop-icon"
                        aria-hidden="true"
                      />
                      <p>
                        Drag &amp; drop your file(s) here or{" "}
                        <span className="browse-text">browse</span>
                      </p>
                      <p className="file-drop-hint">
                        Multi-file upload is supported for Java only.
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
                        <div
                          key={f.name}
                          className="file-preview-row solution-file-card"
                        >
                          <div className="file-icon-wrapper" aria-hidden="true">
                            <FaRegFile
                              className="file-outline-icon"
                              aria-hidden="true"
                            />
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

              {project_id === -1 && (
                <div
                  className="no-active-project-overlay"
                  role="alert"
                  aria-live="assertive"
                >
                  <div className="no-active-project-content">
                    <FaBan
                      className="no-active-project-icon"
                      aria-hidden="true"
                    />
                    <h2 className="no-active-project-title">
                      No active project
                    </h2>
                  </div>
                </div>
              )}
            </div>

            <div className="actions">
              <button
                type="submit"
                disabled={!is_allowed_to_submit || !canSubmit || passedAllTests}
                className={`primary ${!is_allowed_to_submit || !canSubmit ? "disabled" : ""}`}
              >
                Upload
              </button>
            </div>
          </form>

          <div className="below-upload">
            <ErrorMessage
              message={error_message}
              isHidden={isErrorMessageHidden}
            />
          </div>
        </section>
      </div>
    </div>
  );
};

export default StudentUpload;