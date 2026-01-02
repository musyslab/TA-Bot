# piston_runner.py
"""
Piston execution helpers, including Java multi-file bundling.
"""

import json
import os
import re
import time
from typing import Any, Dict, List, Tuple

import requests

PISTON_URL = "https://emkc.org/api/v2/piston/execute"
# PISTON_URL ="https://piston.tabot.sh/api/v2/execute"
# PISTON_URL = "https://scarif-dev.cs.mu.edu/piston/v2/execute"


def strip_java_package(src: str) -> str:
    return "".join(line for line in src.splitlines(True) if not line.lstrip().startswith("package"))


def extract_main_class_name(src: str) -> str:
    if "public static void main(" not in src:
        return ""
    m = re.search(r"\bclass\s+([A-Za-z_]\w*)\b", src)
    return m.group(1) if m else ""


def detect_multiple_mains(java_sources: List[Tuple[str, str]]) -> List[str]:
    mains: List[str] = []
    for (name, raw) in java_sources:
        src = strip_java_package(raw)
        if "public static void main(" in src:
            cls = extract_main_class_name(src)
            mains.append(cls if cls else name)
    return [m for m in mains if m]


def demote_public_types(src: str) -> str:
    return re.sub(r"^\s*public\s+(class|interface|enum)\s+", r"\1 ", src, flags=re.M)


def bundle_java_into_main(java_sources: List[Tuple[str, str]], entry_override: str = "") -> str:
    """
    Bundle multiple Java files into a single Main.java:
      - strip package lines
      - hoist imports
      - demote public top-level types
      - add public class Main wrapper that calls the detected main class (or configured entry class)
    """
    imports = set()
    bodies: List[str] = []
    main_class = ""

    for (_name, raw) in java_sources:
        src = strip_java_package(raw)

        kept_lines: List[str] = []
        for line in src.splitlines():
            if line.lstrip().startswith("import "):
                imports.add(line.strip())
            else:
                kept_lines.append(line)

        body = "\n".join(kept_lines).strip()

        if not main_class:
            mc = extract_main_class_name(body)
            if mc:
                main_class = mc

        bodies.append(body)

    if entry_override:
        main_class = entry_override.strip()

    if not main_class:
        m = re.search(r"\bclass\s+([A-Za-z_]\w*)\b", "\n".join(bodies))
        main_class = m.group(1) if m else "Main"

    bodies = [demote_public_types(b) for b in bodies if b]
    import_block = "\n".join(sorted(imports)).strip()

    if main_class == "Main":
        joined = "\n\n".join(bodies)
        joined = re.sub(r"^\s*class\s+Main\b", "public class Main", joined, flags=re.M)
        if import_block:
            return import_block + "\n\n" + joined + "\n"
        return joined + "\n"

    wrapper = (
        "public class Main {\n"
        "  public static void main(String[] args) throws Exception {\n"
        f"    {main_class}.main(args);\n"
        "  }\n"
        "}\n"
    )

    if import_block:
        return import_block + "\n\n" + wrapper + "\n" + "\n\n".join(bodies) + "\n"
    return wrapper + "\n" + "\n\n".join(bodies) + "\n"


def normalize_double_ext(name: str) -> str:
    if not name:
        return name
    low = name.lower()
    if low.endswith(".java.java"):
        return name[:-5]
    if low.endswith(".py.py"):
        return name[:-3]
    if low.endswith(".c.c"):
        return name[:-2]
    if low.endswith(".rkt.rkt"):
        return name[:-4]
    return name


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


def call_piston_api(
    student_file: str,
    testcase_in: str,
    language: str,
    additional_files: Any,
    entry_class: str = "",
) -> Dict[str, str]:
    files: List[Dict[str, str]] = []

    # Build "files" list from student submission
    if os.path.isdir(student_file):
        if language == "java":
            java_sources: List[Tuple[str, str]] = []

            for fn in sorted(os.listdir(student_file)):
                if fn.endswith(".java"):
                    full = os.path.join(student_file, fn)
                    if os.path.isfile(full):
                        with open(full, "r", errors="ignore") as fh:
                            java_sources.append((fn, fh.read()))

            if not entry_class:
                mains = detect_multiple_mains(java_sources)
                uniq = sorted(set(mains))
                if len(uniq) > 1:
                    return {
                        "stdout": "",
                        "stderr": "",
                        "compile_output": (
                            f"Multiple main entrypoints found: {', '.join(uniq)}. "
                            "Configure entry_class in testcase JSON."
                        ),
                    }

            # Include additional .java files into the bundle too
            for ap in parse_additional_files(additional_files):
                ap = ap.strip()
                if os.path.isfile(ap) and ap.endswith(".java"):
                    with open(ap, "r", errors="ignore") as fh:
                        java_sources.append((os.path.basename(ap), fh.read()))

            bundled = bundle_java_into_main(java_sources, entry_override=entry_class)
            files.append({"name": "Main.java", "content": bundled})

        else:
            lang = (language or "").lower()
            if "python" in lang:
                allowed_exts = {".py", ".pyw"}
            elif "c++" in lang or "cpp" in lang:
                allowed_exts = {".cpp", ".cxx", ".cc", ".hpp", ".h"}
            elif lang == "c":
                allowed_exts = {".c", ".h"}
            elif "racket" in lang or "scheme" in lang:
                allowed_exts = {".rkt", ".scm"}
            else:
                # fail-safe: only include common source files (never docs like .docx/.pdf)
                allowed_exts = {".py", ".pyw", ".c", ".h", ".hpp", ".cpp", ".rkt", ".scm"}

            for root, _, fns in os.walk(student_file):
                for fn in sorted(fns):
                    full = os.path.join(root, fn)
                    if os.path.isfile(full):
                        _, ext = os.path.splitext(fn)
                        if ext.lower() not in allowed_exts:
                            continue
                        with open(full, "r", errors="ignore") as fh:
                            files.append(
                                {
                                    "name": normalize_double_ext(os.path.basename(fn)),
                                    "content": fh.read(),
                                }
                            )
    else:
        with open(student_file, "r", errors="ignore") as fh:
            if language == "java":
                base_src = fh.read()
                java_sources = [(os.path.basename(student_file), base_src)]

                for ap in parse_additional_files(additional_files):
                    ap = ap.strip()
                    if os.path.isfile(ap) and ap.endswith(".java"):
                        with open(ap, "r", errors="ignore") as efh:
                            java_sources.append((os.path.basename(ap), efh.read()))

                if not entry_class:
                    mains = detect_multiple_mains(java_sources)
                    uniq = sorted(set(mains))
                    if len(uniq) > 1:
                        return {
                            "stdout": "",
                            "stderr": "",
                            "compile_output": (
                                f"Multiple main entrypoints found: {', '.join(uniq)}. "
                                "Configure entry_class in testcase JSON."
                            ),
                        }

                bundled = bundle_java_into_main(java_sources, entry_override=entry_class)
                files.append({"name": "Main.java", "content": bundled})
            else:
                files.append({"name": os.path.basename(student_file), "content": fh.read()})

    # Append additional files for ALL languages.
    # For Java, we already bundled any .java extras into Main.java above, so skip .java here.
    for ap in parse_additional_files(additional_files):
        ap = ap.strip()
        if os.path.isfile(ap):
            bn = os.path.basename(ap)
            _, ext = os.path.splitext(bn)
            if ext.lower() in {
                ".pdf", ".docx", ".doc", ".pptx", ".ppt", ".xlsx", ".xls",
                ".png", ".jpg", ".jpeg", ".gif", ".zip", ".tar", ".gz", ".7z",
            }:
                continue
            if language == "java" and bn.lower().endswith(".java"):
                continue
            if not any(f.get("name") == bn for f in files):
                with open(ap, "r", errors="ignore") as fh:
                    files.append({"name": bn, "content": fh.read()})

    stdin_text = testcase_in if testcase_in.endswith("\n") else (testcase_in + "\n")
    payload = {
        "language": language,
        "version": "*",
        "files": files,
        "stdin": stdin_text,
    }

    for attempt in range(3):
        try:
            resp = requests.post(
                PISTON_URL,
                data=json.dumps(payload),
                headers={"Content-Type": "application/json"},
                timeout=30,
            )
        except Exception:
            time.sleep(0.2 * (attempt + 1))
            continue

        if not resp.ok:
            time.sleep(0.2 * (attempt + 1))
            continue

        try:
            obj = resp.json()
        except ValueError:
            time.sleep(0.2 * (attempt + 1))
            continue

        run_section = obj.get("run", {}) if isinstance(obj, dict) else {}
        compile_section = obj.get("compile", {}) if isinstance(obj, dict) else {}

        stdout = run_section.get("stdout") or ""
        stderr = run_section.get("stderr") or ""
        cstdout = compile_section.get("stdout") or ""
        cstderr = compile_section.get("stderr") or ""
        compile_output = (cstderr or cstdout).strip()

        if stdout or stderr or compile_output:
            return {"stdout": stdout, "stderr": stderr, "compile_output": compile_output}

        time.sleep(0.2 * (attempt + 1))

    return {"stdout": "", "stderr": "", "compile_output": ""}


def execute_test(
    filename: str,
    testcase_in: str,
    language: str,
    additional_files: Any,
    entry_class: str = "",
) -> Dict[str, str]:
    response = call_piston_api(
        filename,
        testcase_in.replace("\r", ""),
        language,
        additional_files,
        entry_class=entry_class,
    )
    if response is None:
        return {"stdout": "", "stderr": "", "compile_output": ""}
    return response