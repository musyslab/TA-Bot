import argparse
import json
import os
import sys
import time
from pyston import PystonClient, File
import requests
import asyncio
import ast
import subprocess
import tempfile
import re
import glob
from typing import List, Tuple, Any

PISTON_URL = "https://emkc.org/api/v2/piston/execute"
# PISTON_URL ="https://piston.tabot.sh/api/v2/piston/execute"
# PISTON_URL = "https://scarif-dev.cs.mu.edu/piston/v2/execute"

TEMP_PREFIX = "temp-"
OUTPUT_PATH_NAME = "output"

TYPE_CONFIG_KEY = "TYPE"
DESCRIPTION_CONFIG_KEY = "DESCRIPTION"
HIDDEN_CONFIG_KEY = "HIDDEN"


def createTapFile(output_file: str):
    with open(output_file, "w") as file:
        file.write("TAP version 13\n")


def parseTestConfig(test_path: str):
    config = {}
    with open(test_path, "r") as test_file:
        for line in test_file:
            m = re.match(r"([a-zA-Z]+)=(.*)", line)
            if m:
                config[m.group(1)] = m.group(2).rstrip("\r\n")
            else:
                return -1
    return config


def add_test_to_tap(output_file: str, directory: str, test: str):
    """
    Kept for compatibility with older workflows that used *.info config files.
    Not used by the JSON-driven runner below, but included since output.py had it.
    """
    test_path = os.path.join(directory, test)
    config = parseTestConfig(test_path)
    with open(output_file, "a") as file:
        if config == -1:
            file.write("not ok # SKIP Could not parse test config file.  Please contact the instructor\n")
            return
        if TYPE_CONFIG_KEY not in config:
            file.write("not ok # SKIP Missing TYPE setting in test config.  Please contact the instructor\n")
            return
        if DESCRIPTION_CONFIG_KEY not in config:
            file.write("not ok # SKIP Missing DESCRIPTION setting in test config.  Please contact the instructor\n")
            return


def end_tap_file_from_info(output_file: str, temp_directory: str):
    """
    Kept for compatibility with older workflows that emitted *.info files.
    Not used by the JSON-driven runner below.
    """
    tests = glob.glob1(temp_directory, "*.info")
    with open(output_file, "a") as file:
        file.write(f"1..{str(len(tests))}\n")
    return output_file


# -----------------------------
# Diff / TAP helpers
# -----------------------------

def assess_test(student_output: str, expected_output: str):
    with tempfile.NamedTemporaryFile(mode="w", delete=False) as expected_file:
        expected_file.write(expected_output)
        expected_filename = expected_file.name

    with tempfile.NamedTemporaryFile(mode="w", delete=False) as student_file:
        student_file.write(student_output)
        student_filename = student_file.name

    result = subprocess.run(
        ["diff", "-B", "-w", "-i", "-a", "-Z", "-b", "--ignore-trailing-space", expected_filename, student_filename],
        capture_output=True,
        text=True,
    )

    subprocess.run(["rm", expected_filename])
    subprocess.run(["rm", student_filename])

    output = result.stdout
    diff_status = result.returncode
    return [output, diff_status]


def write_to_tap(tap_file: str, result, test_name: str, test_description: str, hidden: bool = False):
    print("In write to tap", flush=True)
    with open(tap_file, "a") as file:
        if result[1] == 0:
            file.write("ok\n")
        else:
            file.write("not ok\n")
        add_yaml(file, test_name, test_description, result, hidden=hidden)


def add_output(tap_file, result):
    tap_file.write("    output:\n")
    output = result[0]
    lines = output.strip().split("\n")
    for line in lines:
        line = line.replace("'", "''")
        tap_file.write("      - '" + line + "'\n")


def yaml_sq(s):
    """
    Safe single-quoted YAML scalar:
    - doubles single quotes
    - converts real newlines into literal \\n so YAML stays one-line
    """
    if s is None:
        return ""
    s = str(s).replace("'", "''")
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    s = s.replace("\n", "\\n")
    return s


def add_yaml(tap_file, test_name: str, test_description: str, result, hidden: bool = False):
    tap_file.write("  ---\n")
    tap_file.write("    name: '" + yaml_sq(test_name) + "'\n")
    tap_file.write("    type: 1\n")
    tap_file.write("    description: '" + yaml_sq(test_description) + "'\n")
    tap_file.write("    hidden: '" + yaml_sq(str(hidden)) + "'\n")
    add_output(tap_file, result)
    tap_file.write("  ...\n")


def end_tap_file(output_file: str, number_of_tests: int):
    with open(output_file, "a") as file:
        file.write(f"1..{str(number_of_tests)}\n")
    return output_file


# -----------------------------
# Java multi-file bundling helpers (no leading underscores)
# -----------------------------

def strip_java_package(src: str) -> str:
    return "".join(line for line in src.splitlines(True) if not line.lstrip().startswith("package"))


def extract_main_class_name(src: str) -> str:
    if "public static void main(" not in src:
        return ""
    m = re.search(r"\bclass\s+([A-Za-z_]\w*)\b", src)
    return m.group(1) if m else ""


def detect_multiple_mains(java_sources: List[Tuple[str, str]]) -> List[str]:
    mains = []
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

        kept_lines = []
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


# -----------------------------
# Piston execution helpers
# -----------------------------

def call_piston_api(student_file: str, testcase_in: str, language: str, additional_files, entry_class: str = ""):
    files = []

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
                        "compile_output": f"Multiple main entrypoints found: {', '.join(uniq)}. Configure entry_class in testcase JSON.",
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
            for root, _, fns in os.walk(student_file):
                for fn in sorted(fns):
                    full = os.path.join(root, fn)
                    if os.path.isfile(full):
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
                java_sources: List[Tuple[str, str]] = [(os.path.basename(student_file), base_src)]

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
                            "compile_output": f"Multiple main entrypoints found: {', '.join(uniq)}. Configure entry_class in testcase JSON.",
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
            if language == "java" and bn.lower().endswith(".java"):
                continue
            if not any(f.get("name") == bn for f in files):
                with open(ap, "r", errors="ignore") as fh:
                    files.append({"name": bn, "content": fh.read()})

    payload = {
        "language": language,
        "version": "*",
        "files": files,
        "stdin": testcase_in if testcase_in.endswith("\n") else (testcase_in + "\n"),
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

        stdout = (run_section.get("stdout") or "")
        stderr = (run_section.get("stderr") or "")
        cstdout = (compile_section.get("stdout") or "")
        cstderr = (compile_section.get("stderr") or "")
        compile_output = (cstderr or cstdout).strip()

        if stdout or stderr or compile_output:
            return {"stdout": stdout, "stderr": stderr, "compile_output": compile_output}

        time.sleep(0.2 * (attempt + 1))

    return {"stdout": "", "stderr": "", "compile_output": ""}


def execute_test(filename: str, testcase_in: str, language: str, additional_files, entry_class: str = ""):
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

# -----------------------------
# Main execution paths
# -----------------------------

def admin_run(language: str, user_input: str, path: str, additional_files):
    piston_response = execute_test(path, user_input, language, additional_files)
    combined = (
        piston_response.get("stdout")
        or piston_response.get("stderr")
        or piston_response.get("compile_output")
        or ""
    )
    print(combined.replace("\r", "\n"))
    return combined.replace("\r", "\n")


def run(student_name: str, language: str, testcases: str, path: str, myroot: str):
    print("In run", flush=True)

    if os.path.isdir(path):
        output_dir = path
    else:
        parent = os.path.dirname(path)
        output_dir = parent if parent else myroot

    output_file = os.path.join(output_dir, student_name + ".out")

    createTapFile(output_file)
    testcases = json.loads(testcases)

    for _key, value in testcases.items():
        test_name = value[0]
        test_description = value[1] if len(value) > 1 else ""
        testcase_in = value[2]
        testcase_expected = value[3]
        hidden = value[4] if len(value) > 4 else False

        testcase_additional_files = value[5] if len(value) > 5 else []
        entry_class = ""

        if isinstance(testcase_additional_files, dict):
            entry_class = (testcase_additional_files.get("entry_class") or "").strip()
            testcase_additional_files = testcase_additional_files.get("files") or []
        elif len(value) > 6 and isinstance(value[6], str):
            entry_class = value[6].strip()

        filename = path  # file or directory
        piston_resp = execute_test(
            filename,
            testcase_in,
            language,
            testcase_additional_files,
            entry_class=entry_class,
        )

        combined = (
            piston_resp.get("stdout")
            or piston_resp.get("stderr")
            or piston_resp.get("compile_output")
            or ""
        )

        if piston_resp.get("compile_output"):
            result = [piston_resp.get("compile_output"), 1]
        else:
            result = assess_test(combined.replace("\r", "\n"), testcase_expected)

        write_to_tap(output_file, result, test_name, test_description, hidden)

    end_tap_file(output_file, len(testcases))

    return 0


def main():
    if len(sys.argv) >= 8 and sys.argv[1] == "ADMIN":
        language = sys.argv[2]
        paths = sys.argv[-4]
        additional_file_path = sys.argv[-3]
        testcase_json = " ".join(sys.argv[3:-4])
        return admin_run(language, testcase_json, paths, additional_file_path)

    parser = argparse.ArgumentParser(description="Runs student code against a set of test cases.")
    parser.add_argument(
        "student_name",
        metavar="StudentName",
        type=str,
        help="the name of the student file in the input directory",
    )
    parser.add_argument(
        "language",
        metavar="Language",
        type=str,
        help="the language of the student's code",
    )
    parser.add_argument("testcase_json", metavar="testcase_json", type=str, help="testcase json input")
    parser.add_argument("paths", metavar="paths", type=str, help="student path files")
    parser.add_argument("additional_file_path", metavar="additional_file_path", type=str, help="additional file path")
    parser.add_argument("project_id", metavar="project_name", type=str, help="name of the current project")
    parser.add_argument("class_id", metavar="class_id_name", type=str, help="name of the current project")
    parser.add_argument(
        "-r",
        "--root",
        default=os.getcwd(),
        type=str,
        help="the root of the TA-Bot folder containing input, output, and tests directories.",
    )
    args = parser.parse_args()

    if args.student_name == "ADMIN":
        return admin_run(args.language, args.testcase_json, args.paths, args.additional_file_path)

    return run(args.student_name, args.language, args.testcase_json, args.paths, args.root)

if __name__ == "__main__":
    main()