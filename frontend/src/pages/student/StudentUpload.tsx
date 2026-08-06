import React, { CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  FaArrowRight,
  FaBan,
  FaBolt,
  FaCloudUploadAlt,
  FaCode,
  FaClock,
  FaDownload,
  FaExchangeAlt,
  FaRegFile,
  FaTimesCircle,
  FaExternalLinkAlt,
  FaCheckCircle,
  FaEye,
  FaFilePowerpoint,
  FaForward,
  FaInfoCircle,
  FaLock,
  FaStar,
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
  HasPresentation?: boolean;
  PresentationFileName?: string;
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

type LatestPastSubmission = {
  submissionId: number | string;
  passed: boolean;
};

type IncentiveState = {
  stars?: number;
  star_balance?: number;
  cooldown_skip_cost?: number;
  checkpoint_cooldown_skip_cost?: number;
  main_project_cooldown_skip_cost?: number;
  submission_cooldown_seconds?: number;
  cooldown_remaining_seconds?: number;
  submission_attempt_count?: number;
  next_attempt_number?: number;
  checkpoint_completion_stars?: number;
  main_project_completion_stars?: number;
  early_start_multiplier?: number;
  early_start_deadline?: string | null;
  early_start_remaining_seconds?: number;
  early_start_window_open?: boolean;
  reward_base_stars?: number;
  reward_multiplier?: number;
  reward_total_stars?: number;
  reward_already_awarded?: boolean;
  reward_started_early?: boolean;
};

const CHECKPOINT_SCHEDULE = [
  { attempt: 1, label: "Attempt 1", value: "No wait" },
  { attempt: 2, label: "Attempt 2", value: "1 minute" },
  { attempt: 3, label: "Attempt 3", value: "2 minutes" },
  { attempt: 4, label: "Attempt 4+", value: "5 minutes" },
];

const MAIN_SCHEDULE = [
  { attempt: 1, label: "Attempt 1", value: "No wait" },
  { attempt: 2, label: "Attempt 2", value: "2 minutes" },
  { attempt: 3, label: "Attempt 3", value: "5 minutes" },
  { attempt: 4, label: "Attempt 4", value: "10 minutes" },
  { attempt: 5, label: "Attempt 5+", value: "20 minutes" },
];

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

const isPassedValue = (value: unknown): boolean => {
  if (value === true || value === 1) return true;
  if (typeof value !== "string") return false;

  return ["true", "1", "pass", "passed", "ok"].includes(
    value.trim().toLowerCase(),
  );
};

const isPassedTestcase = (result: any): boolean => {
  return isPassedValue(
    result?.passed ??
    result?.ok ??
    result?.State ??
    result?.state ??
    result?.status,
  );
};

const getPastProjectId = (row: ApiPastSubmissionsProject): number => {
  return Number(row?.projectId ?? row?.project_id ?? row?.id ?? row?.Id ?? 0);
};

const getPastMainSubmission = (
  row: ApiPastSubmissionsProject,
): LatestPastSubmission | null => {
  const main = row?.main;
  if (!main) return null;

  const submissionId = normalizePositiveSubmissionId(
    main.submissionId ?? main.submission_id ?? main.id ?? main.Id,
  );

  return submissionId === null
    ? null
    : {
      submissionId,
      passed: isPassedValue(main.passed),
    };
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

const getPastCheckpointSubmission = (
  row: PastSubmissionCheckpoint,
): LatestPastSubmission | null => {
  const submissionId = normalizePositiveSubmissionId(
    row?.submissionId ?? row?.submission_id,
  );

  return submissionId === null
    ? null
    : {
      submissionId,
      passed: isPassedValue(row?.passed),
    };
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
  const [cooldownLiftedAtMs, setCooldownLiftedAtMs] = useState<number>(0);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [incentives, setIncentives] = useState<IncentiveState | null>(null);
  const [isSkippingCooldown, setIsSkippingCooldown] = useState<boolean>(false);
  const [isSkipConfirmationOpen, setIsSkipConfirmationOpen] =
    useState<boolean>(false);
  const [isCooldownStateLoading, setIsCooldownStateLoading] = useState<boolean>(true);

  const [moduleName, setModuleName] = useState<string>("");
  const [hasModulePresentation, setHasModulePresentation] =
    useState<boolean>(false);
  const [modulePresentationFileName, setModulePresentationFileName] =
    useState<string>("");
  const [checkpointLabel, setCheckpointLabel] = useState<string>("");
  const [hideClassSelectionCrumb, setHideClassSelectionCrumb] =
    useState<boolean>(false);

  const autoGrowTextarea = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  const loadModulePresentationStatus = useCallback(
    (targetProjectId: number) => {
      if (!Number.isFinite(cid) || cid <= 0 || targetProjectId <= 0) {
        setHasModulePresentation(false);
        setModulePresentationFileName("");
        return;
      }

      setHasModulePresentation(false);
      setModulePresentationFileName("");

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
            (moduleId
              ? modules.find((item) => Number(item.Id) === Number(moduleId))
              : null) ||
            modules.find(
              (item) => Number(item.MainProjectId) === Number(targetProjectId),
            ) ||
            null;

          setModuleName(selectedModule?.Name || "");
          setHasModulePresentation(Boolean(selectedModule?.HasPresentation));
          setModulePresentationFileName(
            selectedModule?.PresentationFileName || "",
          );
        })
        .catch(() => {
          setHasModulePresentation(false);
          setModulePresentationFileName("");
          if (hasModuleRoute) {
            setModuleName("");
          }
        });
    },
    [cid, hasModuleRoute, moduleId],
  );

  const testcaseProgress = useMemo(() => {
    const total = Math.max(0, testcasesTotalCount);
    const passed = Math.max(0, Math.min(testcasesPassedCount, total));
    const pct = total === 0 ? 0 : Math.round((passed / total) * 100);
    return { total, passed, pct };
  }, [testcasesPassedCount, testcasesTotalCount]);

  const cooldownRemainingSeconds = useMemo(() => {
    return Math.max(0, Math.ceil((cooldownLiftedAtMs - nowMs) / 1000));
  }, [cooldownLiftedAtMs, nowMs]);

  const isCoolingDown = cooldownRemainingSeconds > 0;
  const starBalance = Number(incentives?.star_balance ?? incentives?.stars ?? 0);
  const cooldownSkipCost = Math.max(
    0,
    Number(
      incentives?.cooldown_skip_cost ??
      (isCheckpoint
        ? incentives?.checkpoint_cooldown_skip_cost ?? 1
        : incentives?.main_project_cooldown_skip_cost ?? 2),
    ),
  );
  const cooldownSkipStarLabel = cooldownSkipCost === 1 ? "star" : "stars";
  const submissionAttemptCount = Math.max(
    0,
    Number(incentives?.submission_attempt_count ?? 0),
  );
  const nextAttemptNumber = Math.max(
    1,
    Number(incentives?.next_attempt_number ?? submissionAttemptCount + 1),
  );
  const submissionTypeLabel = isCheckpoint
    ? "Checkpoint submission"
    : "Main submission";
  const submissionTypeShortLabel = isCheckpoint ? "Checkpoint" : "Main";
  const canSkipCooldown = isCoolingDown && cooldownSkipCost > 0 && starBalance >= cooldownSkipCost;
  const canSubmit = !passedAllTests && !isCoolingDown && !isCooldownStateLoading;

  const formatCooldown = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const formatDuration = (seconds: number) => {
    const safeSeconds = Math.max(0, Math.ceil(seconds));
    const days = Math.floor(safeSeconds / 86400);
    const hours = Math.floor((safeSeconds % 86400) / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);
    const secs = safeSeconds % 60;

    if (days > 0) {
      return `${days}d ${hours}h ${minutes}m ${secs}s`;
    }

    if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    }

    return `${minutes}:${secs.toString().padStart(2, "0")}`;
  };

  const formatStarValue = (value: number): string => {
    if (!Number.isFinite(value)) return "0";
    return Number.isInteger(value) ? `${value}` : value.toFixed(1);
  };

  const formatStarCount = (value: number): string => {
    return `${formatStarValue(value)} ${value === 1 ? "star" : "stars"}`;
  };

  const earlyStartDeadlineMs = useMemo(() => {
    const rawDeadline = incentives?.early_start_deadline;
    if (!rawDeadline) return 0;

    const parsed = Date.parse(rawDeadline);
    return Number.isFinite(parsed) ? parsed : 0;
  }, [incentives?.early_start_deadline]);

  const earlyBonusRemainingSeconds = earlyStartDeadlineMs
    ? Math.max(0, Math.ceil((earlyStartDeadlineMs - nowMs) / 1000))
    : Math.max(0, Number(incentives?.early_start_remaining_seconds ?? 0));
  const earlyStartMultiplier = Math.max(1, Number(incentives?.early_start_multiplier ?? 2));
  const earlyBonusWindowOpen = earlyStartDeadlineMs
    ? nowMs <= earlyStartDeadlineMs
    : Boolean(incentives?.early_start_window_open && earlyBonusRemainingSeconds > 0);
  const rewardBaseStars = Math.max(
    0,
    Number(
      incentives?.reward_base_stars ??
      (isCheckpoint
        ? incentives?.checkpoint_completion_stars ?? 1
        : incentives?.main_project_completion_stars ?? 3),
    ),
  );
  const rewardAlreadyAwarded = Boolean(incentives?.reward_already_awarded || passedAllTests);
  const rewardStartedEarly = Boolean(incentives?.reward_started_early);
  const rewardMultiplier = rewardAlreadyAwarded
    ? Math.max(1, Number(incentives?.reward_multiplier ?? 1))
    : earlyBonusWindowOpen || rewardStartedEarly
      ? earlyStartMultiplier
      : 1;
  const rewardTotalStars = rewardAlreadyAwarded
    ? 0
    : rewardBaseStars * rewardMultiplier;
  const rewardIsDoubled = !rewardAlreadyAwarded && rewardMultiplier > 1;
  const rewardSummaryText = rewardAlreadyAwarded
    ? "Reward already earned for this assignment."
    : rewardIsDoubled
      ? `Earn ${formatStarValue(rewardTotalStars)} stars when all tests pass.`
      : `Earn ${formatStarValue(rewardTotalStars)} stars when all tests pass.`;
  const earlyBonusTimerText = earlyStartDeadlineMs
    ? earlyBonusWindowOpen
      ? `${formatDuration(earlyBonusRemainingSeconds)} until early bonus ends.`
      : rewardStartedEarly
        ? `${earlyStartMultiplier}x early bonus is locked in for this assignment.`
        : "Early bonus window closed."
    : "Early bonus timer unavailable.";

  const cooldownLiftedAtToMs = (
    cooldownLiftedAt: unknown,
    remainingSeconds: unknown,
  ): number => {
    if (typeof cooldownLiftedAt === "string" && cooldownLiftedAt.trim()) {
      const parsed = Date.parse(cooldownLiftedAt);
      if (Number.isFinite(parsed) && parsed > Date.now()) {
        return parsed;
      }
    }

    const fallbackSeconds = Number(remainingSeconds);
    if (Number.isFinite(fallbackSeconds) && fallbackSeconds > 0) {
      return Date.now() + Math.ceil(fallbackSeconds) * 1000;
    }

    return 0;
  };

  const buildUploadStateScope = useCallback(() => {
    if (!Number.isFinite(cid) || cid <= 0 || !project_id || project_id <= 0 || project_id === -1) {
      return null;
    }

    return {
      class_id: cid,
      project_id,
      checkpoint: Boolean(isCheckpoint),
      checkpoint_id: isCheckpoint && checkpointId ? checkpointId : null,
    };
  }, [cid, project_id, isCheckpoint, checkpointId]);

  const loadStudentUploadState = useCallback(() => {
    const scope = buildUploadStateScope();
    const token = localStorage.getItem("AUTOTA_AUTH_TOKEN");

    if (!scope || !token) {
      setCooldownLiftedAtMs(0);
      return;
    }

    axios
      .get(`${import.meta.env.VITE_API_URL}/submissions/student-upload-state`, {
        headers: { Authorization: `Bearer ${token}` },
        params: scope,
      })
      .then((res) => {
        const latestSubmission = normalizePositiveSubmissionId(
          res?.data?.last_submission_id ?? res?.data?.previous_submission_id,
        );
        const cooldownUntil = cooldownLiftedAtToMs(
          res?.data?.cooldown_lifted_at,
          res?.data?.cooldown_remaining_seconds,
        );

        setPreviousSubmissionId(latestSubmission);
        setCooldownLiftedAtMs(cooldownUntil);
        setIncentives((previous) => ({
          ...(previous || {}),
          submission_attempt_count: Number(res?.data?.submission_attempt_count ?? 0),
          next_attempt_number: Number(res?.data?.next_attempt_number ?? 1),
          submission_cooldown_seconds: Number(res?.data?.submission_cooldown_seconds ?? 0),
          cooldown_remaining_seconds: Number(res?.data?.cooldown_remaining_seconds ?? 0),
        }));
      })
      .catch(() => {
        // incentive-state independently loads the authoritative cooldown timer.
      });
  }, [buildUploadStateScope]);


  const loadIncentiveState = useCallback(() => {
    const scope = buildUploadStateScope();
    const token = localStorage.getItem("AUTOTA_AUTH_TOKEN");

    if (!scope || !token) {
      setIncentives(null);
      setCooldownLiftedAtMs(0);
      setIsCooldownStateLoading(false);
      return;
    }

    setCooldownLiftedAtMs(0);
    setIsCooldownStateLoading(true);

    axios
      .get(`${import.meta.env.VITE_API_URL}/submissions/incentive-state`, {
        headers: { Authorization: `Bearer ${token}` },
        params: scope,
      })
      .then((res) => {
        const state = res.data || null;
        setIncentives(state);
        setCooldownLiftedAtMs(
          cooldownLiftedAtToMs(
            state?.cooldown_lifted_at,
            state?.cooldown_remaining_seconds,
          ),
        );
      })
      .catch(() => {
        setIncentives(null);
        setCooldownLiftedAtMs(0);
      })
      .finally(() => {
        setIsCooldownStateLoading(false);
      });
  }, [buildUploadStateScope]);

  const skipSubmissionCooldown = () => {
    const scope = buildUploadStateScope();
    const token = localStorage.getItem("AUTOTA_AUTH_TOKEN");

    if (!scope || !token || !isCoolingDown || isSkippingCooldown) {
      setIsSkipConfirmationOpen(false);
      return;
    }

    setIsSkippingCooldown(true);
    setIsErrorMessageHidden(true);
    setError_Message("");

    axios
      .post(
        `${import.meta.env.VITE_API_URL}/submissions/skip-submission-cooldown`,
        scope,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      .then((res) => {
        setCooldownLiftedAtMs(0);
        setNowMs(Date.now());
        setIncentives(res.data || null);
      })
      .catch((err) => {
        setError_Message(
          err.response?.data?.message ||
          "Could not skip the submission timer. Please try again.",
        );
        setIsErrorMessageHidden(false);
      })
      .finally(() => {
        setIsSkippingCooldown(false);
        setIsSkipConfirmationOpen(false);
      });
  };

  const startSubmissionCooldown = (seconds: number) => {
    const safeSeconds = Math.max(0, Math.ceil(seconds));

    setCooldownLiftedAtMs(
      safeSeconds > 0 ? Date.now() + safeSeconds * 1000 : 0,
    );
    setNowMs(Date.now());
  };

  const ALLOWED_EXTS = [".py", ".java", ".c", ".rkt"];
  const isJavaFile = (f: File) => f.name.toLowerCase().endsWith(".java");
  const isJavaFileName = (n: string) => /\.java$/i.test(n);

  const isAllowedFileName = (name: string) => {
    const ext = "." + (name.split(".").pop() || "").toLowerCase();
    return ALLOWED_EXTS.includes(ext);
  };

  const rememberPreviousSubmissionId = (submissionId: number | string | null) => {
    const normalized = normalizePositiveSubmissionId(submissionId);

    if (normalized === null) {
      return;
    }

    setPreviousSubmissionId(normalized);
  };

  const clearPreviousSubmissionId = () => {
    setPreviousSubmissionId(null);
  };

  const resolveLatestSubmissionFromPastSubmissions = (
    rows: ApiPastSubmissionsProject[],
  ): LatestPastSubmission | null => {
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

      return checkpointRow
        ? getPastCheckpointSubmission(checkpointRow)
        : null;
    }

    return getPastMainSubmission(projectRow);
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

        const latestSubmission = resolveLatestSubmissionFromPastSubmissions(rows);

        if (latestSubmission !== null) {
          rememberPreviousSubmissionId(latestSubmission.submissionId);
          setPassedAllTests(latestSubmission.passed);
          return;
        }

        clearPreviousSubmissionId();
        setPassedAllTests(false);
        setTestcasesPassedCount(0);
        setTestcasesTotalCount(0);
        setCheckedPassedAll(true);
      })
      .catch(() => {
        clearPreviousSubmissionId();
        setTestcasesPassedCount(0);
        setTestcasesTotalCount(0);
        setCheckedPassedAll(true);
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
    loadStudentUploadState();
  }, [loadStudentUploadState]);

  useEffect(() => {
    loadIncentiveState();
  }, [loadIncentiveState]);

  useEffect(() => {
    const refreshCooldownState = () => {
      if (document.visibilityState !== "visible") return;
      loadStudentUploadState();
      loadIncentiveState();
    };

    window.addEventListener("focus", refreshCooldownState);
    document.addEventListener("visibilitychange", refreshCooldownState);

    return () => {
      window.removeEventListener("focus", refreshCooldownState);
      document.removeEventListener("visibilitychange", refreshCooldownState);
    };
  }, [loadStudentUploadState, loadIncentiveState]);

  useEffect(() => {
    if (!isCoolingDown && !earlyBonusWindowOpen) return;

    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => window.clearInterval(timer);
  }, [isCoolingDown, earlyBonusWindowOpen]);

  useEffect(() => {
    if (isCoolingDown) {
      setFiles([]);
    } else {
      setIsSkipConfirmationOpen(false);
    }
  }, [isCoolingDown]);

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
    if (!project_id || project_id <= 0 || project_id === -1) {
      setPassedAllTests(false);
      setCheckedPassedAll(true);
      setTestcasesPassedCount(0);
      setTestcasesTotalCount(0);
      clearPreviousSubmissionId();
      return;
    }

    if (previousSubmissionId === null) {
      setCheckedPassedAll(false);
      setTestcasesPassedCount(0);
      setTestcasesTotalCount(0);
      return;
    }

    let cancelled = false;
    setCheckedPassedAll(false);

    const qs =
      isCheckpoint && checkpointId
        ? `&checkpoint=1&checkpoint_id=${checkpointId}`
        : "";

    axios
      .get(
        `${import.meta.env.VITE_API_URL}/submissions/testcaseerrors?class_id=${cid}&id=${encodeURIComponent(String(previousSubmissionId))}${qs}`,
        { headers: authHeader() },
      )
      .then((res) => {
        if (cancelled) return;

        let payload: any = res?.data;

        if (typeof payload === "string") {
          try {
            payload = JSON.parse(payload);
          } catch {
            payload = {};
          }
        }

        const results = Array.isArray(payload?.results) ? payload.results : [];
        const passedCount = results.filter(isPassedTestcase).length;
        const allPassed = results.length > 0 && passedCount === results.length;

        setTestcasesPassedCount(passedCount);
        setTestcasesTotalCount(results.length);
        setPassedAllTests((current) => current || allPassed);
        setCheckedPassedAll(true);

        const payloadSubmissionId = getPayloadSubmissionId(payload);
        if (payloadSubmissionId !== null) {
          rememberPreviousSubmissionId(payloadSubmissionId);
        }
      })
      .catch(() => {
        if (cancelled) return;

        setTestcasesPassedCount(0);
        setTestcasesTotalCount(0);
        setCheckedPassedAll(true);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previousSubmissionId, project_id, isCheckpoint, checkpointId, cid]);

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
      setHasModulePresentation(false);
      setModulePresentationFileName("");
      return;
    }

    if (hasModuleRoute && routeProjectId) {
      setProject_id(routeProjectId);
      loadModulePresentationStatus(routeProjectId);

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
        const activeProjectId = Number(res.data[5] || 0);
        setProject_name(res.data[3]);
        setDueDate(res.data[4]);
        setProject_id(activeProjectId);
        loadModulePresentationStatus(activeProjectId);
      })
      .catch(() => {
        setProject_name("");
        setProject_id(-1);
        setHasModulePresentation(false);
        setModulePresentationFileName("");
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

  const downloadModulePresentation = () => {
    const params = moduleId
      ? { module_id: moduleId }
      : { project_id };

    if ((!moduleId && project_id <= 0) || !hasModulePresentation) return;

    axios
      .get(
        `${import.meta.env.VITE_API_URL}/projects/module_presentation`,
        {
          headers: authHeader(),
          params,
          responseType: "blob",
        },
      )
      .then((res) =>
        downloadBlobResponse(
          res,
          modulePresentationFileName || "module_presentation",
        ),
      )
      .catch(() => {
        setError_Message("The module presentation could not be downloaded.");
        setIsErrorMessageHidden(false);
      });
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

    if (isCoolingDown) {
      setError_Message(
        canSkipCooldown
          ? `Please wait ${formatCooldown(cooldownRemainingSeconds)} or skip the timer for ${cooldownSkipCost} stars. Test your code in your local deployment before submitting again.`
          : `Please wait ${formatCooldown(cooldownRemainingSeconds)} before submitting again. Test your code in your local deployment first.`,
      );
      setIsErrorMessageHidden(false);
      return;
    }

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
        startSubmissionCooldown(Number(res?.data?.cooldown_seconds ?? 0));
        setIncentives((previous) => ({
          ...(previous || {}),
          stars: Number(res?.data?.stars ?? previous?.stars ?? 0),
          star_balance: Number(res?.data?.stars ?? previous?.star_balance ?? 0),
          submission_attempt_count: Number(
            res?.data?.submission_attempt_count ??
            previous?.submission_attempt_count ??
            0,
          ),
          next_attempt_number: Number(
            res?.data?.next_attempt_number ?? previous?.next_attempt_number ?? 1,
          ),
          submission_cooldown_seconds: Number(res?.data?.cooldown_seconds ?? 0),
        }));

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
        const retryAfterSeconds = Number(
          err.response?.data?.retry_after_seconds ?? err.response?.headers?.["retry-after"],
        );

        if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
          startSubmissionCooldown(retryAfterSeconds);
          setIncentives((previous) => ({
            ...(previous || {}),
            submission_attempt_count: Number(
              err.response?.data?.submission_attempt_count ??
              previous?.submission_attempt_count ??
              0,
            ),
            next_attempt_number: Number(
              err.response?.data?.next_attempt_number ??
              previous?.next_attempt_number ??
              1,
            ),
            submission_cooldown_seconds: Number(
              err.response?.data?.cooldown_seconds ??
              previous?.submission_cooldown_seconds ??
              retryAfterSeconds,
            ),
          }));
        }

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
        { label: "School Selection", to: "/schools" },
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
        <section
          className="panel panel-upload"
          aria-label={passedAllTests ? "Assignment Complete" : "Upload Assignment"}
        >
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
                  onClick={downloadModulePresentation}
                  disabled={!hasModulePresentation}
                  aria-disabled={!hasModulePresentation}
                  aria-label={
                    hasModulePresentation
                      ? "Download module presentation"
                      : "Module presentation unavailable"
                  }
                  title={
                    hasModulePresentation
                      ? `Download ${modulePresentationFileName || "module presentation"}`
                      : "No presentation has been saved for this module"
                  }
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

              <div className="student-stars-card" aria-label="Student stars and possible reward">
                <FaStar aria-hidden="true" />
                <div className="student-stars-card__body">
                  <div className="student-stars-card__topline">
                    <div>
                      <div className="student-stars-card__count">
                        {formatStarValue(starBalance)}
                      </div>
                      <div className="student-stars-card__label">Stars available</div>
                    </div>
                  </div>

                  <div className="student-stars-card__reward">
                    {rewardSummaryText}
                  </div>
                  <div className="student-stars-card__timer">
                    {earlyBonusTimerText}
                  </div>
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

          {passedAllTests ? (
            <section
              className="assignment-complete-screen"
              role="status"
              aria-live="polite"
              aria-labelledby="assignment-complete-title"
            >
              <div className="assignment-complete-screen__content">
                <span
                  className="assignment-complete-screen__icon"
                  aria-hidden="true"
                >
                  <FaCheckCircle />
                </span>
                <p className="assignment-complete-screen__eyebrow">
                  Submission complete
                </p>
                <h2 id="assignment-complete-title">
                  You passed all testcases!
                </h2>
                <p>
                  You&apos;re finished
                  {isCheckpoint
                    ? " with this checkpoint"
                    : " with this assignment"}
                  . Additional submissions are disabled.
                </p>

                {previousSubmissionId ? (
                  <Link
                    to={latestSubmissionHref}
                    className="assignment-complete-screen__link"
                  >
                    <FaEye aria-hidden="true" />
                    <span>View previous testcases</span>
                    <FaExternalLinkAlt aria-hidden="true" />
                  </Link>
                ) : (
                  <span className="assignment-complete-screen__link is-disabled">
                    Previous testcases unavailable
                  </span>
                )}
              </div>
            </section>
          ) : (
            <form
              className={`upload-form ${isLoading ? "is-loading" : ""}`}
              onSubmit={handleSubmit}
            >
            <div className="dropzone">
              <div
                className={`file-drop-area ${isCoolingDown ? "is-cooldown-locked" : ""}`}
                aria-disabled={isCoolingDown}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (isCoolingDown) e.dataTransfer.dropEffect = "none";
                }}
                onDrop={(e) => {
                  e.preventDefault();

                  if (passedAllTests || isCoolingDown) return;

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
                {!files.length ? (
                  <>
                    <input
                      type="file"
                      className="file-input"
                      accept=".py,.java,.c,.rkt"
                      multiple
                      disabled={passedAllTests || isCoolingDown}
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
                      disabled={isCoolingDown}
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

              {isCooldownStateLoading && !passedAllTests ? (
                <div
                  className="submission-cooldown-lock is-checking"
                  role="status"
                  aria-live="polite"
                >
                  <div className="submission-cooldown-lock__content">
                    <FaClock aria-hidden="true" />
                    <h2>Checking submission cooldown</h2>
                    <p>Verifying whether this project is ready for another submission.</p>
                  </div>
                </div>
              ) : isCoolingDown && !passedAllTests ? (
                <div
                  className="submission-cooldown-lock"
                  role="status"
                  aria-live="polite"
                >
                  <div className="submission-cooldown-lock__content">
                    <FaLock aria-hidden="true" />
                    <h2>{submissionTypeLabel} cooldown active</h2>
                    <p className="submission-cooldown-lock__timer">
                      Attempt {nextAttemptNumber} unlocks in{" "}
                      {formatCooldown(cooldownRemainingSeconds)}
                    </p>
                    <p>
                      Test your code in your local deployment before submitting it again.
                    </p>
                    <Link
                      to={latestSubmissionHref || getResultsHref()}
                      className="previous-submission-button submission-cooldown-view-button"
                      aria-label="View latest submission"
                    >
                      <FaEye aria-hidden="true" />
                      <span>View Submission</span>
                    </Link>
                    <button
                      type="button"
                      className={`skip-cooldown-button ${!canSkipCooldown || isSkippingCooldown ? "disabled" : ""}`}
                      disabled={!canSkipCooldown || isSkippingCooldown}
                      onClick={() => setIsSkipConfirmationOpen(true)}
                      title={
                        canSkipCooldown
                          ? `Spend ${cooldownSkipCost} ${cooldownSkipStarLabel} to skip the timer`
                          : `You need ${cooldownSkipCost} ${cooldownSkipStarLabel} to skip the timer`
                      }
                    >
                      <FaForward aria-hidden="true" />
                      {isSkippingCooldown
                        ? "Skipping..."
                        : `Skip Timer (${cooldownSkipCost} ${cooldownSkipStarLabel})`}
                    </button>
                  </div>
                </div>
              ) : null}

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
                disabled={!is_allowed_to_submit || !canSubmit || passedAllTests || isLoading}
                className={`primary ${!is_allowed_to_submit || !canSubmit || isLoading ? "disabled" : ""}`}
              >
                {isCooldownStateLoading ? "Checking Cooldown" : isCoolingDown ? "Cooling Down" : "Upload"}
              </button>
            </div>

            <section className="submission-cooldown-policy" aria-labelledby="submission-cooldown-title">
              <div className="submission-cooldown-policy__header">
                <div className="submission-cooldown-policy__heading">
                  <span className="submission-cooldown-policy__icon" aria-hidden="true">
                    <FaClock />
                  </span>
                  <div>
                    <h2 id="submission-cooldown-title">
                      {isCheckpoint ? "Checkpoint Cooldowns" : "Main Project Cooldowns"}
                    </h2>
                    <p>
                      After each attempt, wait the time shown before submitting again.
                    </p>
                  </div>
                </div>
                <div
                  className={[
                    "submission-cooldown-policy__current",
                    isCooldownStateLoading
                      ? "is-loading"
                      : isCoolingDown
                        ? "is-active"
                        : "is-ready",
                  ].join(" ")}
                  role="status"
                  aria-live="polite"
                >
                  {isCooldownStateLoading ? (
                    <>
                      <FaClock aria-hidden="true" />
                      <span>Checking cooldown</span>
                    </>
                  ) : isCoolingDown ? (
                    <>
                      <FaClock aria-hidden="true" />
                      <span>Cooldown ends in</span>
                      <strong>{formatCooldown(cooldownRemainingSeconds)}</strong>
                    </>
                  ) : (
                    <>
                      <FaCheckCircle aria-hidden="true" />
                      <span>Ready</span>
                      <strong>Attempt {nextAttemptNumber}</strong>
                    </>
                  )}
                </div>
              </div>

              <ol
                className={`submission-cooldown-policy__grid ${isCheckpoint ? "is-checkpoint" : "is-main"}`}
                aria-label={`${submissionTypeShortLabel} submission cooldown schedule`}
              >
                {(isCheckpoint ? CHECKPOINT_SCHEDULE : MAIN_SCHEDULE).map((item, index, arr) => {
                  const isLast = index === arr.length - 1;
                  const isCurrent =
                    isCoolingDown &&
                    (
                      submissionAttemptCount === item.attempt ||
                      (isLast && submissionAttemptCount >= item.attempt)
                    );
                  const isNext =
                    !isCoolingDown &&
                    (
                      nextAttemptNumber === item.attempt ||
                      (isLast && nextAttemptNumber >= item.attempt)
                    );

                  return (
                    <li
                      className={[
                        "submission-cooldown-policy__step",
                        isCurrent ? "is-current" : "",
                        isNext ? "is-next" : "",
                      ].filter(Boolean).join(" ")}
                      key={item.attempt}
                      aria-current={isCurrent ? "step" : undefined}
                      aria-label={`${item.label}: ${item.value} cooldown afterward${isCurrent ? ", active cooldown" : isNext ? ", next cooldown" : ""}`}
                    >
                      <div className="submission-cooldown-policy__step-header">
                        <span className="submission-cooldown-policy__attempt">
                          {item.label}
                        </span>
                      </div>
                      <span
                        className="submission-cooldown-policy__connector"
                        aria-hidden="true"
                      >
                        <span>After this attempt</span>
                        <FaArrowRight aria-hidden="true" />
                      </span>
                      <div className="submission-cooldown-policy__value">
                        {isCurrent ? (
                          <span className="submission-cooldown-policy__state is-current">
                            Active
                          </span>
                        ) : isNext ? (
                          <span className="submission-cooldown-policy__state">
                            Next cooldown
                          </span>
                        ) : null}
                        <span className="submission-cooldown-policy__value-icon" aria-hidden="true">
                          <FaClock />
                        </span>
                        <span className="submission-cooldown-policy__value-copy">
                          <span>Cooldown</span>
                          <strong>{item.value}</strong>
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
            </form>
          )}

          <div className="below-upload">
            <ErrorMessage
              message={error_message}
              isHidden={isErrorMessageHidden}
            />
          </div>
        </section>
      </div>

      {isSkipConfirmationOpen ? (
        <div
          className="skip-cooldown-confirmation"
          onMouseDown={(event) => {
            if (
              event.target === event.currentTarget &&
              !isSkippingCooldown
            ) {
              setIsSkipConfirmationOpen(false);
            }
          }}
        >
          <div
            className="skip-cooldown-confirmation__dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="skip-cooldown-confirmation-title"
            aria-describedby="skip-cooldown-confirmation-description"
            onKeyDown={(event) => {
              if (event.key === "Escape" && !isSkippingCooldown) {
                setIsSkipConfirmationOpen(false);
              }
            }}
          >
            <span
              className="skip-cooldown-confirmation__icon"
              aria-hidden="true"
            >
              <FaStar />
            </span>
            <h2 id="skip-cooldown-confirmation-title">
              Spend {cooldownSkipCost} {cooldownSkipStarLabel}?
            </h2>
            <p id="skip-cooldown-confirmation-description">
              This will immediately end the {submissionTypeShortLabel.toLowerCase()}{" "}
              submission cooldown. This purchase cannot be undone.
            </p>

            <div className="skip-cooldown-confirmation__balance">
              <span>
                Current balance
                <strong>{formatStarCount(starBalance)}</strong>
              </span>
              <FaArrowRight aria-hidden="true" />
              <span>
                Balance after
                <strong>
                  {formatStarCount(Math.max(0, starBalance - cooldownSkipCost))}
                </strong>
              </span>
            </div>

            <div className="skip-cooldown-confirmation__actions">
              <button
                type="button"
                className="skip-cooldown-confirmation__cancel"
                disabled={isSkippingCooldown}
                onClick={() => setIsSkipConfirmationOpen(false)}
                autoFocus
              >
                Cancel
              </button>
              <button
                type="button"
                className="skip-cooldown-confirmation__confirm"
                disabled={isSkippingCooldown}
                onClick={skipSubmissionCooldown}
              >
                <FaForward aria-hidden="true" />
                {isSkippingCooldown
                  ? "Spending..."
                  : `Confirm and spend ${cooldownSkipCost} ${cooldownSkipStarLabel}`}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default StudentUpload;
