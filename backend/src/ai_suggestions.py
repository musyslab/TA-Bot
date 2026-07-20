import json
import os
from datetime import datetime
from typing import Iterable, List, Set

import requests
from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import current_user, jwt_required
from dependency_injector.wiring import inject, Provide
from container import Container
from src.repositories.submission_repository import SubmissionRepository

ai_api = Blueprint("ai_api", __name__)

AI_CLICKS_LOG = "/tabot-files/project-files/ai_clicks.log"
SUGGESTION_LIMIT = 3

GRADING_ERROR_DEFS = [
    {
        "id": "IO_FORMAT",
        "label": "Wrong input, output, spelling, or formatting",
        "description": (
            "Use for incorrect spelling, input order, output text, spacing, "
            "capitalization, punctuation, decimal display, or output order."
        ),
        "points": 10,
    },
    {
        "id": "CALCULATION",
        "label": "Wrong calculation, formula, operator, or numeric result",
        "description": (
            "Use for wrong formulas, arithmetic, operators, precedence, rounding, or computed values."
        ),
        "points": 20,
    },
    {
        "id": "DECISION_LOGIC",
        "label": "Wrong condition, comparison, branch, or boundary",
        "description": (
            "Use for wrong if/else logic, comparisons, boolean expressions, ranges, categories, "
            "boundaries, or special cases."
        ),
        "points": 20,
    },
    {
        "id": "LOOP_LOGIC",
        "label": "Wrong loop structure, iteration count, or loop condition",
        "description": (
            "Use for incorrect loops, loop conditions, start/stop values, repeated actions, "
            "early exits, infinite loops, or off-by-one errors."
        ),
        "points": 20,
    },
    {
        "id": "VARIABLE_STATE",
        "label": "Wrong variable, initialization, update, or accumulated state",
        "description": (
            "Use for incorrect variables, missing initialization, wrong updates, overwritten values, "
            "or incorrect counters, totals, flags, minimums, or maximums."
        ),
        "points": 20,
    },
    {
        "id": "COLLECTIONS_INDEXING",
        "label": "Wrong list, array, string, dictionary, or index handling",
        "description": (
            "Use for incorrect collection use, indexing, slicing, lookup, length handling, "
            "iteration over items, or string/array access."
        ),
        "points": 20,
    },
    {
        "id": "FUNCTIONS_MODULARITY",
        "label": "Wrong function definition, call, parameter, return, or decomposition",
        "description": (
            "Use for missing or incorrect functions, parameters, arguments, return values, scope, "
            "or required program decomposition."
        ),
        "points": 20,
    },
    {
        "id": "REQUIREMENT_COMPLETENESS",
        "label": "Missing, incomplete, or misunderstood assignment requirement",
        "description": (
            "Use when required behavior, cases, sections, calculations, messages, or features "
            "are missing, incomplete, or substantially misunderstood."
        ),
        "points": 40,
    },
    {
        "id": "RUNTIME",
        "label": "Syntax error, crash, timeout, or program cannot run",
        "description": (
            "Use when the program cannot complete because of syntax errors, build/import failures, "
            "runtime exceptions, timeouts, or infinite loops."
        ),
        "points": 60,
    },
]

GRADING_DEFAULT_DEFS_MAP = {
    e["id"]: {
        "label": e.get("label", e["id"]),
        "description": e.get("description", ""),
        "points": int(e.get("points", 0) or 0),
    }
    for e in GRADING_ERROR_DEFS
}

ALLOWED_IDS: Set[str] = {e["id"] for e in GRADING_ERROR_DEFS}


def truncate_text(s: str, limit: int) -> str:
    s = (s or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if len(s) <= limit:
        return s
    return s[:limit] + "\n...[truncated]..."


def one_line(s: str) -> str:
    return (s or "").replace("\r", "\\r").replace("\n", "\\n")


def safe_int(value, default: int = -1) -> int:
    try:
        return int(value)
    except Exception:
        return default


def get_llm_url() -> str:
    return os.getenv("LLM_URL", "").strip()


def get_llm_model() -> str:
    return os.getenv("LLM_MODEL", "").strip()


def log_ai_click(submission_id: int, prompt: str, output: str) -> None:
    try:
        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        username = getattr(current_user, "Username", None) or "unknown"
        role = getattr(current_user, "Role", None) or 0

        os.makedirs(os.path.dirname(AI_CLICKS_LOG), exist_ok=True)

        prompt_safe = one_line(truncate_text(prompt, 6000))
        output_safe = one_line(truncate_text(output, 6000))

        line = (
            f"{ts} | user:{username} | role:{role} | submission:{int(submission_id)}"
            f" | prompt:{prompt_safe} | output:{output_safe}\n"
        )

        with open(AI_CLICKS_LOG, "a", encoding="utf-8") as f:
            f.write(line)
    except Exception:
        pass


def public_error_defs() -> List[dict]:
    return [
        {
            "id": str(e.get("id", "")),
            "label": str(e.get("label", e.get("id", ""))),
            "description": str(e.get("description", "")),
            "points": int(e.get("points", 0) or 0),
        }
        for e in GRADING_ERROR_DEFS
    ]


@ai_api.route("/grading-error-defs", methods=["GET"])
@jwt_required()
def grading_error_defs():
    return jsonify({"success": True, "errorDefs": public_error_defs()})


def build_allowed_list_text() -> str:
    return "; ".join(f'{e["id"]}={e["label"]}' for e in GRADING_ERROR_DEFS)


def build_prompt(selected_code: str, diff_long: str) -> str:
    selected_code = truncate_text(selected_code, 6000)
    diff_long = truncate_text(diff_long, 6000)

    return f"""Task: choose the clearest grading categories for the selected code.
Return only a JSON array of 3 category IDs, example: ["IO_FORMAT", "CALCULATION", "DECISION_LOGIC"]
Use only IDs from this list and do not invent IDs: {build_allowed_list_text()}

CODE:
{selected_code}

DIFF (- student, + expected):
{diff_long}
"""


def sanitize_suggestions(raw_ids: Iterable[str]) -> List[str]:
    clean: List[str] = []
    seen = set()

    for raw_id in raw_ids:
        category_id = str(raw_id or "").strip().upper()
        if category_id in ALLOWED_IDS and category_id not in seen:
            clean.append(category_id)
            seen.add(category_id)
        if len(clean) >= SUGGESTION_LIMIT:
            break

    return clean


def extract_json_array_text(text: str) -> str:
    text = (text or "").strip()

    if text.startswith("```"):
        lines = text.splitlines()
        if lines and lines[0].strip().startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines).strip()

    start = text.find("[")
    end = text.rfind("]")

    if start >= 0 and end >= start:
        return text[start : end + 1]

    return text


def parse_llm_suggestions(text: str) -> List[str]:
    if not text:
        return []

    json_text = extract_json_array_text(text)

    try:
        obj = json.loads(json_text)
    except Exception:
        return []

    if not isinstance(obj, list):
        return []

    return sanitize_suggestions(obj)


def call_llm(prompt: str, temperature: float = 0.1, max_tokens: int = 150) -> str:
    llm_url = get_llm_url()
    llm_model = get_llm_model()

    if not llm_url or not llm_model:
        return (
            "DEBUG_CONFIG_ERROR: "
            f"LLM_URL={'SET' if llm_url else 'EMPTY'}, "
            f"LLM_MODEL={'SET' if llm_model else 'EMPTY'}"
        )

    payload = {
        "model": llm_model,
        "messages": [
            {
                "role": "system",
                "content": "Return only the requested JSON array. No explanations.",
            },
            {
                "role": "user",
                "content": prompt,
            },
        ],
        "temperature": float(temperature),
        "max_tokens": int(max_tokens),
    }

    try:
        response = requests.post(llm_url, json=payload, timeout=20)
    except Exception as e:
        return f"DEBUG_REQUEST_ERROR: {e}"

    raw_response_text = response.text or ""

    try:
        response.raise_for_status()
    except Exception as e:
        return (
            "DEBUG_HTTP_ERROR: "
            f"{e}; status={response.status_code}; "
            f"response={truncate_text(raw_response_text, 4000)}"
        )

    try:
        data = response.json()
    except Exception as e:
        return (
            "DEBUG_JSON_PARSE_ERROR: "
            f"{e}; status={response.status_code}; "
            f"response={truncate_text(raw_response_text, 4000)}"
        )

    choices = data.get("choices", [])
    if not choices:
        return (
            "DEBUG_NO_CHOICES: "
            f"status={response.status_code}; "
            f"response={truncate_text(json.dumps(data, ensure_ascii=False), 4000)}"
        )

    choice = choices[0] or {}
    message = choice.get("message", {}) or {}
    content = message.get("content")

    if content:
        return str(content).strip()

    return (
        "DEBUG_NO_CONTENT: "
        f"finish_reason={choice.get('finish_reason')}; "
        f"reasoning={truncate_text(str(message.get('reasoning') or ''), 1000)}; "
        f"response={truncate_text(json.dumps(data, ensure_ascii=False), 4000)}"
    )


def build_diff_long_for_testcase(
    submission_id: int,
    testcase_name: str,
    submission_repo: SubmissionRepository,
) -> str:
    submission = submission_repo.get_submission_by_submission_id(int(submission_id))
    path = getattr(submission, "OutputFilepath", "") if submission else ""

    if not path or not os.path.exists(path):
        return ""

    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            payload = json.load(f) or {}
    except Exception:
        return ""

    testcase_name = (testcase_name or "").strip()
    if not testcase_name:
        return ""

    for result in payload.get("results", []) or []:
        name = str(result.get("name", "") or "")
        if name == testcase_name and not bool(result.get("passed", False)):
            return str(result.get("longDiff", "") or "")

    return ""


@ai_api.route("/grading-suggestions", methods=["POST"])
@jwt_required()
@inject
def grading_suggestions(
    submission_repo: SubmissionRepository = Provide[Container.submission_repo],
):
    data = request.get_json(silent=True) or {}

    submission_id = safe_int(data.get("submissionId", -1), -1)
    selected_code = str(data.get("selectedCode", "") or "").strip()
    testcase_name = str(data.get("testcaseName", "") or "").strip()
    testcase_long_diff = str(data.get("testcaseLongDiff", "") or "").strip()

    if submission_id < 0 or not selected_code:
        return jsonify({"suggestions": []})

    diff_long = testcase_long_diff
    if not diff_long and testcase_name:
        diff_long = build_diff_long_for_testcase(
            submission_id,
            testcase_name,
            submission_repo,
        )

    prompt = build_prompt(selected_code, diff_long)
    llm_output = ""
    suggestions: List[str] = []

    try:
        llm_output = call_llm(prompt)
        suggestions = parse_llm_suggestions(llm_output)
    except Exception as e:
        current_app.logger.warning(f"[ai_suggestions] LLM call failed: {e}")
        llm_output = f"ERROR: {e}"

    log_ai_click(submission_id, prompt, llm_output)

    return jsonify({"suggestions": suggestions})