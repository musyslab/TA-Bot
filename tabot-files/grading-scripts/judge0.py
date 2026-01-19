# judge0-runner.py
"""
Judge0 execution helpers.

Key behavior:
  - Uses Judge0 "Multi-file program" (language_id=89) and sends ALL files via `additional_files` zip.
  - For Java, compiles all .java files and runs a selected main class (optionally overridden by entry_class).
  - For C/C++, compiles all sources into ./main and runs it.
  - For Python, runs a selected entry .py file (optionally overridden by entry_class).

Judge0 multi-file programs require scripts named `run` (required) and `compile` (optional) in the zip root.
"""

import base64
import io
import json
import os
import re
import time
import zipfile
from typing import Any, Dict, List, Optional, Tuple

import requests

# Judge0 base URL. Override for self-hosted instances.
JUDGE0_URL = "https://ce.judge0.com"

# Judge0 "Multi-file program" language id (Judge0 CE v1.13.x).
JUDGE0_MULTIFILE_LANGUAGE_ID = 89

# Polling config
JUDGE0_TIMEOUT_SECONDS = 30.0
JUDGE0_POLL_INTERVAL_SECONDS = 0.25
JUDGE0_POLL_MAX_SECONDS = 20.0

# If your Judge0 host disallows wait=true, we will fall back automatically.
JUDGE0_TRY_WAIT = True

BINARY_EXTENSIONS_DENYLIST = {
    ".pdf", ".docx", ".doc", ".pptx", ".ppt", ".xlsx", ".xls",
    ".png", ".jpg", ".jpeg", ".gif", ".zip", ".tar", ".gz", ".7z",
}

def build_request_headers() -> Dict[str, str]:
    h: Dict[str, str] = {"Content-Type": "application/json"}
    return h


def base64_encode_text(text: str) -> str:
    return base64.b64encode((text or "").encode("utf-8")).decode("ascii")


def base64_decode_text(maybe_b64: Any) -> str:
    if maybe_b64 is None:
        return ""
    if not isinstance(maybe_b64, str):
        return str(maybe_b64)
    s = maybe_b64.strip()
    if not s:
        return ""
    try:
        return base64.b64decode(s, validate=False).decode("utf-8", errors="replace")
    except Exception:
        # If it's not actually base64, return as-is.
        return maybe_b64

def strip_java_comments(src: str) -> str:
    """
    Best-effort comment stripper so main-class detection does not match words
    inside comments like: "This class calculates ..."
    """
    if not src:
        return ""
    no_block = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    no_line = re.sub(r"(?m)//.*?$", "", no_block)
    return no_line

def extract_java_package_name(src: str) -> str:
    # e.g., "package assignment07;" or "package com.foo.bar;"
    src = strip_java_comments(src or "")
    m = re.search(r"(?m)^\s*package\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*;", src)
    return (m.group(1).strip() if m else "")


def extract_main_class_name(src: str) -> str:
    """
    Returns fully-qualified main class name when a package is present:
      - "assignment07.StudentTester" (preferred)
      - "StudentTester" (no package)
    """
    src = strip_java_comments(src or "")
    if "public static void main(" not in src:
        return ""
    m = re.search(
        r"(?m)^\s*(?:public\s+)?(?:abstract\s+)?(?:final\s+)?class\s+([A-Za-z_]\w*)\b",
        src,
    )
    cls = (m.group(1) if m else "").strip()
    if not cls:
        return ""
    pkg = extract_java_package_name(src)
    return f"{pkg}.{cls}" if pkg else cls

def detect_multiple_mains(java_sources: List[Tuple[str, str]]) -> List[str]:
    mains: List[str] = []
    for (name, raw) in java_sources:
        cls = extract_main_class_name(raw)
        if cls:
            mains.append(cls)
    return [m for m in mains if m]


def parse_additional_files(additional_files: Any) -> List[str]:
    extras: List[str] = []
    if not additional_files:
        return extras
    try:
        if isinstance(additional_files, str):
            s = additional_files.strip()
            if not s:
                return []
            extras = json.loads(s) if s.startswith("[") else [s]
        else:
            extras = list(additional_files)
    except Exception:
        extras = []
    return [e for e in extras if e]


def detect_language_kind(language: str) -> str:
    lang = (language or "").strip().lower()
    if lang == "java" or "java" in lang:
        return "java"
    if "python" in lang or lang in {"py", "py3", "python3"}:
        return "python"
    if "c++" in lang or "cpp" in lang:
        return "cpp"
    if lang == "c":
        return "c"
    return lang or "unknown"


def allowed_exts_for_language(kind: str) -> Optional[set]:
    if kind == "java":
        return {".java"}
    if kind == "python":
        return {".py", ".pyw"}
    if kind == "cpp":
        return {".cpp", ".cxx", ".cc", ".hpp", ".h"}
    if kind == "c":
        return {".c", ".h"}
    # Fail-safe: only common source files (avoid docs/images/archives)
    return {".py", ".pyw", ".java", ".c", ".h", ".hpp", ".cpp", ".cxx", ".cc"}


def read_text_file(path: str) -> str:
    with open(path, "r", errors="ignore") as fh:
        return fh.read()


def collect_student_files(student_path: str, kind: str) -> List[Tuple[str, bytes]]:
    """
    Returns [(zip_relpath, bytes), ...] for student submission files.
    Preserves directory structure when student_path is a directory.
    """
    allowed = allowed_exts_for_language(kind)
    out: List[Tuple[str, bytes]] = []

    if os.path.isdir(student_path):
        base = student_path
        for root, _, fns in os.walk(student_path):
            for fn in sorted(fns):
                full = os.path.join(root, fn)
                if not os.path.isfile(full):
                    continue
                rel = os.path.relpath(full, base).replace("\\", "/")
                _, ext = os.path.splitext(fn)
                if ext.lower() in BINARY_EXTENSIONS_DENYLIST:
                    continue
                if allowed is not None and ext.lower() not in allowed:
                    continue

                content = read_text_file(full)
                out.append((rel, content.encode("utf-8", errors="replace")))
    else:
        fn = os.path.basename(student_path)
        _, ext = os.path.splitext(fn)
        if ext.lower() not in BINARY_EXTENSIONS_DENYLIST:
            if allowed is None or ext.lower() in allowed:
                content = read_text_file(student_path)
                out.append((fn, content.encode("utf-8", errors="replace")))

    return out


def collect_additional_files(additional_files: Any, kind: str) -> List[Tuple[str, bytes]]:
    """
    Additional files are appended at zip root by basename, matching prior behavior.
    Skips obvious binary/document types.
    """
    out: List[Tuple[str, bytes]] = []
    for ap in parse_additional_files(additional_files):
        ap = ap.strip()
        if not ap or not os.path.isfile(ap):
            continue
        bn = os.path.basename(ap)
        _, ext = os.path.splitext(bn)
        if ext.lower() in BINARY_EXTENSIONS_DENYLIST:
            continue
        content = read_text_file(ap)
        out.append((bn, content.encode("utf-8", errors="replace")))
    return out


def pick_python_entry(student_files: List[str], entry_override: str) -> str:
    if entry_override:
        ov = entry_override.strip()
        # If user supplied a simple class name, auto-qualify it if a package is present.
        if "." not in ov:
            for (_name, raw) in java_sources:
                m = re.search(r"\bclass\s+([A-Za-z_]\w*)\b", raw or "")
                cls = (m.group(1) if m else "").strip()
                if cls and cls == ov:
                    pkg = extract_java_package_name(raw)
                    return (f"{pkg}.{ov}" if pkg else ov), None
        return ov, None
    # Prefer main.py if present, otherwise first .py
    lowered = {p.lower(): p for p in student_files}
    if "main.py" in lowered:
        return lowered["main.py"]
    py = [p for p in student_files if p.lower().endswith(".py")]
    return sorted(py)[0] if py else (sorted(student_files)[0] if student_files else "main.py")


def pick_java_main_class(java_sources: List[Tuple[str, str]], entry_override: str) -> Tuple[Optional[str], Optional[str]]:
    """
    Returns (main_class, error_message).
    """
    if entry_override:
        return entry_override.strip(), None

    mains = detect_multiple_mains(java_sources)
    uniq = sorted(set(mains))
    if len(uniq) > 1:
        return None, (
            f"Multiple main entrypoints found: {', '.join(uniq)}. "
            "Configure entry_class in testcase JSON."
        )
    if len(uniq) == 1:
        return uniq[0], None

    # No obvious main found. Fall back to first class name (qualified if packaged), then filename stem.
    for (name, raw) in java_sources:
        raw = strip_java_comments(raw or "")
        m = re.search(
            r"(?m)^\s*(?:public\s+)?(?:abstract\s+)?(?:final\s+)?class\s+([A-Za-z_]\w*)\b",
            raw,
        )
        if m:
            cls = m.group(1).strip()
            pkg = extract_java_package_name(raw)
            return (f"{pkg}.{cls}" if pkg else cls), None
        return os.path.splitext(name)[0], None

    return "Main", None


def build_compile_and_run_scripts(kind: str, student_relpaths: List[str], entry_class: str) -> Tuple[Optional[str], str, Optional[str]]:
    """
    Returns (compile_script_or_None, run_script, error_message_or_None)
    """
    if kind == "java":
        # Re-read sources for main detection (we need raw-ish contents)
        java_sources: List[Tuple[str, str]] = []
        for p in student_relpaths:
            if p.lower().endswith(".java"):
                # Placeholder content not needed here; main detection earlier uses content.
                # We'll detect main class by scanning the on-disk submission files again in caller.
                pass

        # Caller will provide java_sources via a dedicated path, so this branch is set later.
        # We return skeletons here, and the caller substitutes the main class in run script.
        compile_script = (
            "#!/usr/bin/env bash\n"
            "set -e\n"
            "find . -name '*.java' -print0 | xargs -0 javac -encoding UTF-8 -d .\n"
        )
        # Placeholder, caller must replace {MAIN_CLASS}
        run_script = (
            "#!/usr/bin/env bash\n"
            "set -e\n"
            "java {MAIN_CLASS}\n"
        )
        return compile_script, run_script, None

    if kind == "c":
        compile_script = (
            "#!/usr/bin/env bash\n"
            "set -e\n"
            "find . -name '*.c' -print0 | xargs -0 gcc -std=c11 -O2 -Wall -Wextra -o main\n"
        )
        run_script = "#!/usr/bin/env bash\nset -e\n./main\n"
        return compile_script, run_script, None

    if kind == "cpp":
        compile_script = (
            "#!/usr/bin/env bash\n"
            "set -e\n"
            "find . \\( -name '*.cpp' -o -name '*.cc' -o -name '*.cxx' \\) -print0 | "
            "xargs -0 g++ -std=c++17 -O2 -Wall -Wextra -o main\n"
        )
        run_script = "#!/usr/bin/env bash\nset -e\n./main\n"
        return compile_script, run_script, None

    if kind == "python":
        entry_py = pick_python_entry(student_relpaths, entry_class)
        run_script = f"#!/usr/bin/env bash\nset -e\npython3 {entry_py}\n"
        return None, run_script, None

    return None, "#!/usr/bin/env bash\nset -e\necho 'Unsupported language'\nexit 1\n", "Unsupported language"


def zip_write_file(zf: zipfile.ZipFile, arcname: str, content: bytes, mode: int = 0o644) -> None:
    """
    Write a file to zip with unix permissions.
    """
    info = zipfile.ZipInfo(arcname)
    # Set unix file permissions (upper 16 bits)
    info.external_attr = (mode & 0xFFFF) << 16
    zf.writestr(info, content)


def build_multifile_zip_base64(
    student_path: str,
    kind: str,
    additional_files: Any,
    entry_class: str,
) -> Tuple[Optional[str], Optional[str]]:
    """
    Returns (base64_zip, error_message).
    """
    student_file_blobs = collect_student_files(student_path, kind)
    additional_file_blobs = collect_additional_files(additional_files, kind)

    # Build java_sources for main detection if needed
    java_sources: List[Tuple[str, str]] = []
    if kind == "java":
        # Read from the actual student_path (not from zip content) for accurate main detection
        if os.path.isdir(student_path):
            for root, _, fns in os.walk(student_path):
                for fn in sorted(fns):
                    if fn.endswith(".java"):
                        full = os.path.join(root, fn)
                        if os.path.isfile(full):
                            java_sources.append((fn, read_text_file(full)))
        else:
            if student_path.endswith(".java") and os.path.isfile(student_path):
                java_sources.append((os.path.basename(student_path), read_text_file(student_path)))

        # Include additional java sources in main detection too
        for ap in parse_additional_files(additional_files):
            ap = ap.strip()
            if ap.endswith(".java") and os.path.isfile(ap):
                java_sources.append((os.path.basename(ap), read_text_file(ap)))

        main_class, err = pick_java_main_class(java_sources, entry_class)
        if err:
            return None, err
        # Replace placeholder in run script later
        entry_class = main_class or ""

    student_relpaths = [p for (p, _b) in student_file_blobs]
    compile_script, run_script, err = build_compile_and_run_scripts(kind, student_relpaths, entry_class)
    if err:
        return None, err

    if kind == "java":
        run_script = run_script.replace("{MAIN_CLASS}", entry_class or "Main")

    bio = io.BytesIO()
    with zipfile.ZipFile(bio, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        # Required script
        zip_write_file(zf, "run", run_script.encode("utf-8"), mode=0o755)

        # Optional compile script
        if compile_script:
            zip_write_file(zf, "compile", compile_script.encode("utf-8"), mode=0o755)

        # Student files
        seen = set()
        for rel, blob in student_file_blobs:
            if not rel or rel in seen:
                continue
            seen.add(rel)
            zip_write_file(zf, rel, blob, mode=0o644)

        # Additional files (skip if name collides)
        for rel, blob in additional_file_blobs:
            if not rel or rel in seen:
                continue
            seen.add(rel)
            zip_write_file(zf, rel, blob, mode=0o644)

    zip_bytes = bio.getvalue()
    return base64.b64encode(zip_bytes).decode("ascii"), None


def judge0_create_submission(additional_files_b64: str, stdin_text: str) -> Dict[str, Any]:
    """
    Create submission. Tries wait=true first if enabled, then falls back to wait=false.
    """
    payload: Dict[str, Any] = {
        "language_id": JUDGE0_MULTIFILE_LANGUAGE_ID,
        "additional_files": additional_files_b64,
        "stdin": base64_encode_text(stdin_text),
    }

    def post(wait: bool) -> requests.Response:
        url = f"{JUDGE0_URL}/submissions?base64_encoded=true&wait={'true' if wait else 'false'}"
        return requests.post(url, headers=build_request_headers(), data=json.dumps(payload), timeout=JUDGE0_TIMEOUT_SECONDS)

    if JUDGE0_TRY_WAIT:
        r = post(wait=True)
        if r.status_code == 400:
            # On many hosts, wait=true is disallowed
            r = post(wait=False)
    else:
        r = post(wait=False)

    r.raise_for_status()
    return r.json() if r.content else {}


def judge0_get_submission(token: str) -> Dict[str, Any]:
    fields = "stdout,stderr,compile_output,message,status"
    url = f"{JUDGE0_URL}/submissions/{token}?base64_encoded=true&fields={fields}"
    r = requests.get(url, headers=build_request_headers(), timeout=JUDGE0_TIMEOUT_SECONDS)
    r.raise_for_status()
    return r.json() if r.content else {}


def call_judge0_api(
    student_path: str,
    testcase_in: str,
    language: str,
    additional_files: Any,
    entry_class: str = "",
) -> Dict[str, str]:
    kind = detect_language_kind(language)

    zip_b64, build_err = build_multifile_zip_base64(student_path, kind, additional_files, entry_class)
    if build_err:
        return {"stdout": "", "stderr": "", "compile_output": build_err}

    # Create submission
    try:
        create_obj = judge0_create_submission(zip_b64 or "", testcase_in or "")
    except Exception as e:
        return {"stdout": "", "stderr": str(e), "compile_output": ""}

    # If wait=true succeeded, the response may already include stdout/stderr/status
    token = (create_obj.get("token") or "").strip()
    has_results = any(k in create_obj for k in ("stdout", "stderr", "compile_output", "status"))

    def normalize_result(obj: Dict[str, Any]) -> Dict[str, str]:
        stdout = base64_decode_text(obj.get("stdout"))
        stderr = base64_decode_text(obj.get("stderr"))
        compile_output = base64_decode_text(obj.get("compile_output"))
        message = base64_decode_text(obj.get("message"))

        # If Judge0 returns an internal message but no stdout/stderr/compile_output, surface it.
        if (not stdout) and (not stderr) and (not compile_output) and message:
            stderr = message

        return {"stdout": stdout or "", "stderr": stderr or "", "compile_output": compile_output or ""}

    if has_results and token:
        return normalize_result(create_obj)
    if not token:
        # Unexpected, but keep stable output shape
        return {"stdout": "", "stderr": "", "compile_output": "Judge0 did not return a submission token."}

    # Poll until done (status.id not 1 or 2)
    deadline = time.time() + JUDGE0_POLL_MAX_SECONDS
    last_obj: Dict[str, Any] = {}
    while time.time() < deadline:
        try:
            last_obj = judge0_get_submission(token)
        except Exception as e:
            return {"stdout": "", "stderr": str(e), "compile_output": ""}

        status = last_obj.get("status") or {}
        status_id = status.get("id")
        if status_id not in (1, 2):
            return normalize_result(last_obj)

        time.sleep(JUDGE0_POLL_INTERVAL_SECONDS)

    # Timed out, return whatever we have
    return normalize_result(last_obj)


def execute_test(
    filename: str,
    testcase_in: str,
    language: str,
    additional_files: Any,
    entry_class: str = "",
) -> Dict[str, str]:
    response = call_judge0_api(
        filename,
        (testcase_in or "").replace("\r", ""),
        language,
        additional_files,
        entry_class=entry_class,
    )
    if response is None:
        return {"stdout": "", "stderr": "", "compile_output": ""}
    return response
