# grade.py
"""
Entry-point grader.

Writes JSON instead of TAP. Per testcase, outputs:
  - name
  - description
  - passed
  - shortDiff (unified diff, only changed lines)
  - longDiff (unified diff, all lines)

Unified diff convention here:
  - '-' lines are the student's output
  - '+' lines are the reference (expected) output
"""

import argparse
import difflib
import json
import os
import re
import sys
from typing import Any, Dict, List, Tuple

from judge0 import execute_test


def normalize_newlines(text: str) -> str:
    if text is None:
        return ""
    return str(text).replace("\r\n", "\n").replace("\r", "\n")


def normalize_for_compare(text: str) -> List[str]:
    """
    Roughly matches:
      diff -B -w -i -Z -b --ignore-trailing-space

    Strategy:
      - normalize newlines
      - drop blank lines
      - remove ALL whitespace
      - lower-case
    """
    text = normalize_newlines(text)
    out: List[str] = []
    for line in text.split("\n"):
        if line.strip() == "":
            continue
        line_no_ws = re.sub(r"\s+", "", line).lower()
        out.append(line_no_ws)
    return out


def check_passed(student_text: str, expected_text: str) -> bool:
    return normalize_for_compare(student_text) == normalize_for_compare(expected_text)


def build_unified_diff(student_text: str, expected_text: str, context_lines: int, from_name: str, to_name: str) -> str:
    """
    Unified diff (GitHub-style). '-' is student, '+' is reference.
    """
    student_text = normalize_newlines(student_text)
    expected_text = normalize_newlines(expected_text)

    # splitlines() avoids creating a spurious trailing "" line when output ends with "\n",
    # which was causing extra hunks / a lone "-" line.
    student_lines = student_text.splitlines()
    expected_lines = expected_text.splitlines()

    diff_lines = difflib.unified_diff(
        student_lines,
        expected_lines,
        fromfile=from_name,
        tofile=to_name,
        n=max(0, int(context_lines)),
        lineterm="",
    )

    diff_str = "\n".join(diff_lines).rstrip("\n")
    return diff_str + ("\n" if diff_str else "")


def build_short_diff(student_text: str, expected_text: str, from_name: str = "actual", to_name: str = "expected") -> str:
    """
    "Short" diff for the UI:
      - only changed lines
      - for replacements, interleave in replacement order:
          -actual line
          +expected line

    This ensures the Diff Finder can see adjacent -/+ pairs to enable intra-line highlighting.
    """
    student_lines = normalize_newlines(student_text).splitlines()
    expected_lines = normalize_newlines(expected_text).splitlines()

    sm = difflib.SequenceMatcher(a=student_lines, b=expected_lines)
    changed: List[str] = []

    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            continue

        a_chunk = student_lines[i1:i2]
        b_chunk = expected_lines[j1:j2]

        if tag == "replace":
            n = max(len(a_chunk), len(b_chunk))
            for k in range(n):
                if k < len(a_chunk):
                    changed.append(f"-{a_chunk[k]}")
                if k < len(b_chunk):
                    changed.append(f"+{b_chunk[k]}")
        elif tag == "delete":
            for line in a_chunk:
                changed.append(f"-{line}")
        elif tag == "insert":
            for line in b_chunk:
                changed.append(f"+{line}")

    if not changed:
        return ""

    out: List[str] = []
    out.append(f"--- {from_name}")
    out.append(f"+++ {to_name}")
    out.append(f"@@ -1,{len(student_lines)} +1,{len(expected_lines)} @@")
    out.extend(changed)
    return "\n".join(out).rstrip("\n") + "\n"


def build_long_diff(student_text: str, expected_text: str, from_name: str = "actual", to_name: str = "expected") -> str:
    """
    Include every line from both student and reference, emitting in the usual replacement order:
      -actual line
      +expected line
    across the whole output.
    """
    student_lines = normalize_newlines(student_text).splitlines()
    expected_lines = normalize_newlines(expected_text).splitlines()

    out: List[str] = []
    out.append(f"--- {from_name}")
    out.append(f"+++ {to_name}")
    out.append(f"@@ -1,{len(student_lines)} +1,{len(expected_lines)} @@")
    n = max(len(student_lines), len(expected_lines))
    for i in range(n):
        if i < len(student_lines):
            out.append(f"-{student_lines[i]}")
        if i < len(expected_lines):
            out.append(f"+{expected_lines[i]}")
    return "\n".join(out).rstrip("\n") + "\n"


def pick_output_directory(path: str, root: str) -> str:
    if os.path.isdir(path):
        return path
    parent = os.path.dirname(path)
    if parent:
        return parent
    return root


def normalize_testcase_items(testcases_obj: Any) -> List[Tuple[str, Any]]:
    """
    Accept either:
      - dict-like: { key: [ ... testcase tuple ... ] }
      - list-like: [ [ ... ], [ ... ] ]

    Returns a stable list of (key, value).
    """
    if isinstance(testcases_obj, dict):
        keys = list(testcases_obj.keys())

        def sort_key(k: Any) -> Tuple[int, str]:
            ks = str(k)
            if ks.isdigit():
                return (0, f"{int(ks):012d}")
            return (1, ks)

        keys_sorted = sorted(keys, key=sort_key)
        return [(str(k), testcases_obj[k]) for k in keys_sorted]

    if isinstance(testcases_obj, list):
        return [(str(i), v) for i, v in enumerate(testcases_obj)]

    return []


def parse_entry_class_and_additional_files(value: Any) -> Tuple[str, Any]:
    """
    Backward-compatible parsing:
      value[4] or value[5] may be:
        - list of additional files
        - dict { "entry_class": "...", "files": [...] }
      value[6] may be a string entry_class
    """
    entry_class = ""
    additional_files: Any = []

    if isinstance(value, (list, tuple)):
        # Newer layout (hidden removed): [name, desc, in, expected, additional_files]
        # Older layout:                [name, desc, in, expected, hidden, additional_files]
        if len(value) > 5:
            additional_files = value[5]
        elif len(value) > 4:
            additional_files = value[4]
        if isinstance(additional_files, dict):
            entry_class = (additional_files.get("entry_class") or "").strip()
            additional_files = additional_files.get("files") or []
        elif len(value) > 6 and isinstance(value[6], str):
            entry_class = value[6].strip()

    return entry_class, additional_files


def admin_run(language: str, user_input: str, path: str, additional_files: Any) -> str:
    # Accept JSON-encoded additional files from the repo/db.
    if isinstance(additional_files, str):
        raw = additional_files.strip()
        if raw.startswith("[") or raw.startswith("{"):
            try:
                additional_files = json.loads(raw)
            except Exception:
                pass

    runner_response = execute_test(path, user_input, language, additional_files)
    combined = (
        runner_response.get("stdout")
        or runner_response.get("stderr")
        or runner_response.get("compile_output")
        or ""
    )
    combined = normalize_newlines(combined)
    print(combined)
    return combined


def run(student_name: str, language: str, testcases_json: str, path: str, root: str) -> int:
    output_dir = pick_output_directory(path, root)
    os.makedirs(output_dir, exist_ok=True)
    output_file = os.path.join(output_dir, "testcases.json")

    testcases_obj = json.loads(testcases_json)
    testcase_items = normalize_testcase_items(testcases_obj)

    results: List[Dict[str, Any]] = []

    for key, value in testcase_items:
        # Expected tuple layout (backward-compatible):
        # [ test_name, test_description, testcase_in, testcase_expected, hidden?, additional_files?, entry_class? ]
        test_name = ""
        test_description = ""
        testcase_in = ""
        testcase_expected = ""

        if isinstance(value, (list, tuple)):
            test_name = value[0] if len(value) > 0 else ""
            test_description = value[1] if len(value) > 1 else ""
            testcase_in = value[2] if len(value) > 2 else ""
            testcase_expected = value[3] if len(value) > 3 else ""
        else:
            # If it's not a list/tuple, treat it as invalid but keep output stable.
            test_name = str(key)
            test_description = ""
            testcase_in = ""
            testcase_expected = ""

        entry_class, testcase_additional_files = parse_entry_class_and_additional_files(value)

        runner_resp = execute_test(
            path,
            testcase_in,
            language,
            testcase_additional_files,
            entry_class=entry_class,
        )

        student_text = normalize_newlines(
            runner_resp.get("stdout")
            or runner_resp.get("stderr")
            or runner_resp.get("compile_output")
            or ""
        )
        expected_text = normalize_newlines(testcase_expected or "")

        passed = check_passed(student_text, expected_text)

        short_same_as_long = False
        if passed:
            short_diff = ""
            long_diff = ""
        else:
            from_name = f"actual:{test_name}"
            to_name = f"expected:{test_name}"
            short_diff = build_short_diff(student_text, expected_text, from_name=from_name, to_name=to_name)
            long_diff = build_long_diff(student_text, expected_text, from_name=from_name, to_name=to_name)
            short_same_as_long = bool(long_diff) and (short_diff == long_diff)
            if short_same_as_long:
                short_diff = ""

        results.append(
            {
                "name": test_name,
                "description": test_description,
                "passed": bool(passed),
                "shortDiff": short_diff,
                "longDiff": long_diff,
                "shortDiffSameAsLong": short_same_as_long,
            }
        )

    payload = {"results": results}

    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)

    return 0


def main() -> int:
    # ADMIN mode:
    #   grade.py ADMIN <language> <input_text> <solution_path> [additional_files_json]
    if len(sys.argv) >= 5 and sys.argv[1] == "ADMIN":
        language = sys.argv[2]
        user_input = sys.argv[3]
        paths = sys.argv[4]
        additional = sys.argv[5] if len(sys.argv) > 5 else ""
        admin_run(language, user_input, paths, additional)
        return 0

    parser = argparse.ArgumentParser(description="Runs student code against test cases and writes JSON results.")
    parser.add_argument("student_name", metavar="StudentName", type=str, help="the name of the student file")
    parser.add_argument("language", metavar="Language", type=str, help="the language of the student's code")
    parser.add_argument("testcase_json", metavar="testcase_json", type=str, help="testcase json input")
    parser.add_argument("paths", metavar="paths", type=str, help="student path (file or directory)")
    parser.add_argument("additional_file_path", metavar="additional_file_path", type=str, help="additional file path")
    parser.add_argument("project_id", metavar="project_name", type=str, help="name of the current project")
    parser.add_argument("class_id", metavar="class_id_name", type=str, help="name of the current class")
    parser.add_argument(
        "-r",
        "--root",
        default=os.getcwd(),
        type=str,
        help="root folder (used when paths has no parent directory)",
    )
    args = parser.parse_args()

    if args.student_name == "ADMIN":
        admin_run(args.language, args.testcase_json, args.paths, args.additional_file_path)
        return 0

    return run(args.student_name, args.language, args.testcase_json, args.paths, args.root)


if __name__ == "__main__":
    raise SystemExit(main())
