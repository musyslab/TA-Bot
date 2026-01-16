import json
import os
import re
import sys
from typing import Any, Dict, List, Set

import requests
from flask import Blueprint, current_app, jsonify, make_response, request
from flask_jwt_extended import jwt_required
from dependency_injector.wiring import inject, Provide

from container import Container
from src.repositories.submission_repository import SubmissionRepository


ai_api = Blueprint("ai_api", __name__)

LLM_URL = os.getenv("LLM_URL", "http://bim.cs.mu.edu:8000/v1/chat/completions")
LLM_MODEL = os.getenv("LLM_MODEL", "google/gemma-3-4b-it")

# Keep this in sync with AdminGrading.tsx
ERROR_DEFS = [
    {
        "id": "MISSPELL",
        "label": "Spelling or word substitution error",
        "description": "A word or short phrase is wrong compared to expected output (including valid English words used incorrectly, missing/extra letters, or wrong small words) when the rest of the line is otherwise correct.",
    },
    {
        "id": "FORMAT",
        "label": "Formatting mismatch",
        "description": "Correct content but incorrect formatting (spacing/newlines/case/spelling/precision).",
    },
    {
        "id": "CONTENT",
        "label": "Missing or extra required content",
        "description": "Required value/line is missing, or additional unexpected value/line is produced.",
    },
    {
        "id": "ORDER",
        "label": "Order mismatch",
        "description": "Reads inputs or prints outputs in the wrong order relative to the required sequence.",
    },
    {
        "id": "INIT_STATE",
        "label": "Incorrect initialization",
        "description": "Uses uninitialized values or starts with the wrong initial state.",
    },
    {
        "id": "STATE_MISUSE",
        "label": "Incorrect variable or state use",
        "description": "Wrong variable used, wrong type behavior (truncation), overwritten state, or flag not managed correctly.",
    },
    {
        "id": "COMPUTE",
        "label": "Incorrect computation",
        "description": "Wrong formula, precedence, numeric operation, or derived value.",
    },
    {
        "id": "CONDITION",
        "label": "Incorrect condition logic",
        "description": "Incorrect comparison, boundary, compound logic, or missing edge case handling.",
    },
    {
        "id": "BRANCHING",
        "label": "Incorrect branching structure",
        "description": "Wrong if/elif/else structure (misbound else), missing default case, or missing break in selection-like logic.",
    },
    {
        "id": "LOOP",
        "label": "Incorrect loop logic",
        "description": "Wrong bounds/termination, update/control error, off-by-one, wrong nesting, or accumulation error.",
    },
    {
        "id": "INDEXING",
        "label": "Incorrect indexing or collection setup",
        "description": "Out-of-bounds, wrong base/range, or incorrect array/string/list setup (size or contents).",
    },
    {
        "id": "FUNCTIONS",
        "label": "Incorrect function behavior or use",
        "description": "Wrong return behavior (missing/ignored/wrong type) or incorrect function use (scope/order/unnecessary re-calls).",
    },
    {
        "id": "COMPILE",
        "label": "Program did not compile",
        "description": "Code fails to compile or run due to syntax errors, missing imports/includes, or build/runtime errors that prevent execution.",
    },   
]

ALLOWED_IDS: Set[str] = {e["id"] for e in ERROR_DEFS}


def _truncate(s: str, limit: int) -> str:
    s = s or ""
    if len(s) <= limit:
        return s
    return s[:limit] + "\n...[truncated]..."


def _build_allowed_list_text() -> str:
    # Compact and stable formatting helps the model stay constrained.
    lines: List[str] = []
    for e in ERROR_DEFS:
        lines.append(f'{e["id"]}: {e["label"]} - {e["description"]}')
    return "\n".join(lines)


def build_prompt(selected_code: str, diff_long: str) -> str:
    allowed = _build_allowed_list_text()
    selected_code = _truncate(selected_code, 2000)
    diff_long = _truncate(diff_long, 4000)

    return f"""You are helping a human TA label likely grading mistakes.

Return ONLY a JSON array of 3 strings, each string must be one valid errorId from the Allowed list.
No extra keys, no explanations, no markdown, no surrounding text.

Choose the 3 most likely errorIds based on:
1) Selected source lines
2) Output diffs from failing tests (unified diff where '-' is student output and '+' is expected output)

Prefer MISSPELL when the difference is a small typo (few characters or a tiny word change like 'of' vs 'on').
Prefer FORMAT when the difference is mostly spacing, newlines, capitalization, or punctuation.

Allowed errorIds (id: label - description):
{allowed}

Selected source lines:
<<<CODE
{selected_code}
CODE

Failing output diffs (may be truncated):
<<<DIFF
{diff_long}
DIFF
"""


def extract_json_array(text: str) -> List[str]:
    """
    Try very hard to get a JSON array of strings out of the model output.
    Accepts exact JSON or "JSON inside text" fallback.
    """
    if not text:
        return []

    text = text.strip()

    # 1) Direct JSON parse
    try:
        obj = json.loads(text)
        if isinstance(obj, list):
            return [str(x) for x in obj]
    except Exception:
        pass

    # 2) Find first [...] block
    m = re.search(r"\[[\s\S]*?\]", text)
    if not m:
        return []
    try:
        obj = json.loads(m.group(0))
        if isinstance(obj, list):
            return [str(x) for x in obj]
    except Exception:
        return []

    return []


def sanitize_suggestions(raw_ids: List[str]) -> List[str]:
    clean: List[str] = []
    seen = set()
    for rid in raw_ids:
        rid = (rid or "").strip()
        if rid in ALLOWED_IDS and rid not in seen:
            clean.append(rid)
            seen.add(rid)
        if len(clean) >= 3:
            break
    return clean[:3]


def heuristic_fallback_from_diff(diff_long: str) -> List[str]:
    """
    Minimal fallback when the model output is invalid.
    Uses rough signals from unified diffs.
    """
    dl = diff_long or ""
    minus = len(re.findall(r"(?m)^-", dl))
    plus = len(re.findall(r"(?m)^\+", dl))

    picks: List[str] = []

    # CONTENT is the right bucket for missing/extra lines in output diffs.
    if plus > minus + 3:
        picks.append("CONTENT")
    if minus > plus + 3:
        picks.append("CONTENT")

    # If we have both sides but they differ, FORMAT is a reasonable default.
    if "CONTENT" not in picks and (plus > 0 or minus > 0):
        picks.append("FORMAT")

    # Generic/common backups (must be valid IDs from ERROR_DEFS)
    for cand in ["ORDER", "COMPUTE", "CONDITION", "LOOP", "INDEXING", "BRANCHING", "STATE_MISUSE", "INIT_STATE", "FUNCTIONS"]:
        if cand not in picks:
            picks.append(cand)
        if len(picks) >= 3:
            break

    return picks[:3]


def call_llm(prompt: str, temperature: float, max_tokens: int = 120) -> str:
    payload = {
        "model": LLM_MODEL,
        "messages": [
            {"role": "system", "content": "You must follow the user's response format exactly."},
            {"role": "user", "content": prompt},
        ],
        "temperature": float(temperature),
        "max_tokens": int(max_tokens),
    }

    r = requests.post(
        LLM_URL,
        headers={"Content-Type": "application/json"},
        data=json.dumps(payload),
        timeout=15,
    )
    r.raise_for_status()
    data = r.json()

    # OpenAI-style response shape
    try:
        return (
            data.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
        ) or ""
    except Exception:
        return ""


def build_diff_long_for_testcase(submission_id: int, testcase_name: str, submission_repo: SubmissionRepository) -> str:
    """
    Pull the failing longDiff block ONLY for the requested testcase name.
    Returns "" if not found or unavailable.
    """
    submission = submission_repo.get_submission_by_submission_id(int(submission_id))
    path = getattr(submission, "OutputFilepath", "") if submission else ""
    if not path or not os.path.exists(path):
        return ""

    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            payload = json.load(f) or {}
    except Exception:
        return ""

    results = payload.get("results", []) or []
    want = (testcase_name or "").strip()
    if not want:
        return ""

    for r in results:
        try:
            name = str(r.get("name", "") or "")
            if name != want:
                continue
            if bool(r.get("passed", False)):
                return ""
            long_diff = str(r.get("longDiff", "") or "")
            return long_diff
        except Exception:
            continue

    return ""

@ai_api.route("/grading-suggestions", methods=["POST"])
@jwt_required()
@inject
def grading_suggestions(
    submission_repo: SubmissionRepository = Provide[Container.submission_repo],
):
    data = request.get_json(silent=True) or {}
    submission_id = int(data.get("submissionId", -1) or -1)
    selected_code = str(data.get("selectedCode", "") or "").strip()
    testcase_name = str(data.get("testcaseName", "") or "").strip()
    testcase_long_diff = str(data.get("testcaseLongDiff", "") or "").strip()

    if submission_id < 0 or not selected_code:
        return jsonify({"suggestions": []})

    # Prefer the diff from the UI-selected testcase. If UI did not send it, fetch by testcaseName.
    diff_long = testcase_long_diff
    if not diff_long and testcase_name:
        diff_long = build_diff_long_for_testcase(submission_id, testcase_name, submission_repo)

    # 1) First attempt (low temperature)
    prompt = build_prompt(selected_code, diff_long)
    
    # Debug: print the exact prompt being sent to the LLM
    #try:
    #    print("\n===== AI GRADING PROMPT (about to send) =====\n", file=sys.stderr)
    #    print(prompt, file=sys.stderr)
    #    print("\n===== END AI GRADING PROMPT =====\n", file=sys.stderr)
    #except Exception:
    #    pass

    try:
        out = call_llm(prompt, temperature=0.2, max_tokens=120)
        raw_ids = extract_json_array(out)
        ids = sanitize_suggestions(raw_ids)
    except Exception as e:
        current_app.logger.warning(f"[ai_suggestions] LLM call failed: {e}")
        ids = []

    # 2) If invalid/too short, retry once with stricter settings
    if len(ids) < 2:
        strict_prompt = prompt + "\nREMINDER: Output ONLY a JSON array like [\"OUTPUT_MISSING\",\"INPUT_PARSE\"]."
        try:
            out2 = call_llm(strict_prompt, temperature=0.0, max_tokens=80)
            raw2 = extract_json_array(out2)
            ids2 = sanitize_suggestions(raw2)
            if len(ids2) >= 2:
                ids = ids2
        except Exception:
            pass

    # 3) Final fallback (guarantee 3)
    if len(ids) < 3:
        ids = heuristic_fallback_from_diff(diff_long)

    return make_response(json.dumps({"suggestions": ids}), 200, {"Content-Type": "application/json"})
