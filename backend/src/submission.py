from datetime import datetime, timedelta, timezone
import os
import threading
import requests
import urllib3
from src.repositories.user_repository import UserRepository
from flask import Blueprint
from flask import make_response, request, current_app, send_file
from flask import request
from http import HTTPStatus
from injector import inject
from flask_jwt_extended import jwt_required
from flask_jwt_extended import current_user
from src.repositories.submission_repository import SubmissionRepository
from src.repositories.project_repository import ProjectRepository
from src.constants import ADMIN_ROLE, TEACHER_ROLE
import json
import zipfile
from io import BytesIO
from tap.parser import Parser
from flask import jsonify
from dependency_injector.wiring import inject, Provide
from container import Container
from urllib.parse import unquote
import csv
from io import StringIO
from src.ai_suggestions import ERROR_DEFS
from src.repositories.models import Checkpoints, ClassAssignments, Classes, Projects, StudentUploadState, Submissions, Testcases
from src.repositories.database import db

# Default grading error definitions (must match AdminGrading.tsx BASE_ERROR_DEFS).
# We store them here so exports can resolve default point values when ErrorPointsJson
# only contains overrides (for DB efficiency).
ADMIN_GRADING_ERROR_DEFS = [
    {"id": "MISSPELL", "label": "Spelling or word substitution error", "description": "A word or short phrase is wrong compared to expected output (including valid English words used incorrectly, missing/extra letters, or wrong small words) when the rest of the line is otherwise correct.", "points": 10},
    {"id": "FORMAT", "label": "Formatting mismatch", "description": "Correct content but incorrect formatting (spacing/newlines/case/spelling/precision).", "points": 5},
    {"id": "CONTENT", "label": "Missing or extra required content", "description": "Required value/line is missing, or additional unexpected value/line is produced.", "points": 20},
    {"id": "ORDER", "label": "Order mismatch", "description": "Reads inputs or prints outputs in the wrong order relative to the required sequence.", "points": 15},
    {"id": "INIT_STATE", "label": "Incorrect initialization", "description": "Uses uninitialized values or starts with the wrong initial state.", "points": 20},
    {"id": "STATE_MISUSE", "label": "Incorrect variable or state use", "description": "Wrong variable used, wrong type behavior (truncation), overwritten state, or flag not managed correctly.", "points": 15},
    {"id": "COMPUTE", "label": "Incorrect computation", "description": "Wrong formula, precedence, numeric operation, or derived value.", "points": 20},
    {"id": "CONDITION", "label": "Incorrect condition logic", "description": "Incorrect comparison, boundary, compound logic, or missing edge case handling.", "points": 15},
    {"id": "BRANCHING", "label": "Incorrect branching structure", "description": "Wrong if/elif/else structure (misbound else), missing default case, or missing break in selection-like logic.", "points": 15},
    {"id": "LOOP", "label": "Incorrect loop logic", "description": "Wrong bounds/termination, update/control error, off-by-one, wrong nesting, or accumulation error.", "points": 20},
    {"id": "INDEXING", "label": "Incorrect indexing or collection setup", "description": "Out-of-bounds, wrong base/range, or incorrect array/string/list setup (size or contents).", "points": 20},
    {"id": "FUNCTIONS", "label": "Incorrect function behavior or use", "description": "Wrong return behavior (missing/ignored/wrong type) or incorrect function use (scope/order/unnecessary re-calls).", "points": 15},
    {"id": "COMPILE", "label": "Program did not compile", "description": "Code fails to compile or run due to syntax errors, missing imports/includes, or build/runtime errors that prevent execution.", "points": 40},
]

ADMIN_GRADING_DEFAULT_DEFS_MAP = {
    e["id"]: {
        "label": e.get("label", e["id"]),
        "description": e.get("description", ""),
        "points": int(e.get("points", 0) or 0),
    }
    for e in ADMIN_GRADING_ERROR_DEFS
}

ui_clicks_log = "/tabot-files/project-files/code_view_clicks.log"

submission_api = Blueprint('submission_api', __name__)

def parse_int(v, default: int = -1) -> int:
    try:
        return int(str(v).strip())
    except Exception:
        return default

def parse_bool(v) -> bool:
    if isinstance(v, bool):
        return v
    s = str(v or "").strip().lower()
    return s in ("1", "true", "yes", "y", "on")

def is_admin_user() -> bool:
    return int(getattr(current_user, "Role", -1) or -1) == ADMIN_ROLE


def is_teacher_user() -> bool:
    return int(getattr(current_user, "Role", -1) or -1) == TEACHER_ROLE


def class_exists(class_id: int) -> bool:
    class_id = parse_int(class_id, 0)
    if class_id <= 0:
        return False

    return Classes.query.filter(Classes.Id == class_id).first() is not None


def get_class_assignment(user_id: int, class_id: int):
    user_id = parse_int(user_id, 0)
    class_id = parse_int(class_id, 0)

    if user_id <= 0 or class_id <= 0:
        return None

    try:
        return ClassAssignments.query.filter(
            ClassAssignments.UserId == user_id,
            ClassAssignments.ClassId == class_id,
        ).first()
    except Exception:
        return None


def get_class_assignment_role(user_id: int, class_id: int) -> int | None:
    assignment = get_class_assignment(user_id, class_id)

    if assignment is None:
        return None

    if hasattr(assignment, "Role"):
        try:
            return int(getattr(assignment, "Role", 0) or 0)
        except Exception:
            return 0

    return 0


def current_user_class_role(class_id: int) -> int | None:
    return get_class_assignment_role(int(current_user.Id), class_id)


def current_user_is_enrolled_in_class_id(class_id: int) -> bool:
    return get_class_assignment(int(current_user.Id), class_id) is not None


def user_is_student_in_class_id(user_id: int, class_id: int) -> bool:
    assignment = get_class_assignment(user_id, class_id)

    if assignment is None:
        return False

    if hasattr(assignment, "Role"):
        try:
            return int(getattr(assignment, "Role", 0) or 0) == 0
        except Exception:
            return True

    return True


def is_staff_user() -> bool:
    if is_admin_user() or is_teacher_user():
        return True

    try:
        return (
            ClassAssignments.query.filter(
                ClassAssignments.UserId == int(current_user.Id),
                ClassAssignments.Role >= TEACHER_ROLE,
            ).first()
            is not None
        )
    except Exception:
        return False


def teacher_id_is_on_class(teacher_id: int, class_item: Classes) -> bool:
    if class_item is None or class_item.Tid is None:
        return False

    teacher_ids = [
        token
        for token in "".join(
            character if character.isdigit() else " "
            for character in str(class_item.Tid)
        ).split()
    ]

    return str(teacher_id) in teacher_ids


def user_can_access_class_id(class_id: int) -> bool:
    class_id = parse_int(class_id, 0)
    if class_id <= 0:
        return False

    assignment_role = current_user_class_role(class_id)
    if assignment_role is not None and assignment_role >= TEACHER_ROLE:
        return True

    if is_admin_user():
        return class_exists(class_id)

    if is_teacher_user():
        class_item = Classes.query.filter(Classes.Id == class_id).first()
        return teacher_id_is_on_class(int(current_user.Id), class_item)

    return False


def current_user_can_view_class_id(class_id: int) -> bool:
    class_id = parse_int(class_id, 0)
    if class_id <= 0:
        return False

    return user_can_access_class_id(class_id) or current_user_is_enrolled_in_class_id(class_id)


def user_can_access_project_id(project_id: int) -> bool:
    project_id = parse_int(project_id, 0)
    if project_id <= 0:
        return False

    project = Projects.query.filter(Projects.Id == project_id).first()
    if project is None:
        return False

    return user_can_access_class_id(int(getattr(project, "ClassId", 0) or 0))


def current_user_can_view_project_id(project_id: int) -> bool:
    project_id = parse_int(project_id, 0)
    if project_id <= 0:
        return False

    project = Projects.query.filter(Projects.Id == project_id).first()
    if project is None:
        return False

    class_id = int(getattr(project, "ClassId", 0) or 0)
    return current_user_can_view_class_id(class_id)


def current_utc_datetime() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def parse_cooldown_lifted_at(value) -> datetime | None:
    if value is None or value == "":
        return None

    if isinstance(value, datetime):
        parsed = value
    else:
        try:
            raw = str(value).strip()
            if not raw:
                return None
            if raw.endswith("Z"):
                raw = f"{raw[:-1]}+00:00"
            parsed = datetime.fromisoformat(raw)
        except Exception:
            return None

    if parsed.tzinfo is not None:
        return parsed.astimezone(timezone.utc).replace(tzinfo=None)

    return parsed


def serialize_cooldown_lifted_at(value: datetime | None) -> str | None:
    if value is None:
        return None

    if value.tzinfo is not None:
        value = value.astimezone(timezone.utc).replace(tzinfo=None)

    return f"{value.isoformat()}Z"


def seconds_until(value: datetime | None) -> int:
    if value is None:
        return 0

    return max(0, int((value - current_utc_datetime()).total_seconds() + 0.999))


def cooldown_lifted_at_from_mapping(mapping) -> datetime | None:
    if "cooldown_seconds" in mapping:
        seconds = parse_int(mapping.get("cooldown_seconds", 0), 0)
        if seconds <= 0:
            return None
        return current_utc_datetime() + timedelta(seconds=seconds)

    if "cooldown_lifted_at" in mapping:
        return parse_cooldown_lifted_at(mapping.get("cooldown_lifted_at"))

    return None


def upload_state_scope_from_mapping(mapping) -> tuple[int, int, bool, int]:
    class_id = parse_int(mapping.get("class_id", 0), 0)
    project_id = parse_int(mapping.get("project_id", 0), 0)
    checkpoint = parse_bool(mapping.get("checkpoint", False))
    checkpoint_id = parse_int(mapping.get("checkpoint_id", 0), 0) if checkpoint else 0

    return class_id, project_id, checkpoint, max(0, checkpoint_id)


def current_user_can_use_upload_state(class_id: int, project_id: int, checkpoint_id: int) -> bool:
    class_id = parse_int(class_id, 0)
    project_id = parse_int(project_id, 0)
    checkpoint_id = parse_int(checkpoint_id, 0)

    if class_id <= 0 or project_id <= 0:
        return False

    project = Projects.query.filter(Projects.Id == project_id).first()
    if project is None:
        return False

    if parse_int(getattr(project, "ClassId", 0), 0) != class_id:
        return False

    if not current_user_can_view_project_id(project_id):
        return False

    if checkpoint_id > 0:
        checkpoint = Checkpoints.query.filter(
            Checkpoints.Id == checkpoint_id,
            Checkpoints.ProjectId == project_id,
        ).first()
        return checkpoint is not None

    return True


def get_student_upload_state_row(class_id: int, project_id: int, checkpoint_id: int):
    return StudentUploadState.query.filter(
        StudentUploadState.UserId == int(current_user.Id),
        StudentUploadState.ClassId == int(class_id),
        StudentUploadState.ProjectId == int(project_id),
        StudentUploadState.CheckpointId == int(checkpoint_id or 0),
    ).first()


def latest_submission_for_upload_state(
    submission_repo: SubmissionRepository,
    project_id: int,
    checkpoint: bool,
    checkpoint_id: int,
):
    if checkpoint:
        return latest_checkpoint_submission(
            int(project_id),
            int(current_user.Id),
            int(checkpoint_id) if checkpoint_id > 0 else None,
        )

    return submission_repo.get_submission_by_user_and_projectid(
        int(current_user.Id),
        int(project_id),
    )


def submission_matches_upload_state(submission, project_id: int, checkpoint: bool, checkpoint_id: int) -> bool:
    if submission is None:
        return False

    if int(getattr(submission, "User", -1) or -1) != int(current_user.Id):
        return False

    if int(getattr(submission, "Project", -1) or -1) != int(project_id):
        return False

    if checkpoint:
        if not bool(getattr(submission, "IsCheckpoint", False)):
            return False

        if checkpoint_id > 0 and int(getattr(submission, "CheckpointId", 0) or 0) != int(checkpoint_id):
            return False

    elif bool(getattr(submission, "IsCheckpoint", False)):
        return False

    return True


def serialize_student_upload_state(
    row,
    submission_repo: SubmissionRepository,
    project_id: int,
    checkpoint: bool,
    checkpoint_id: int,
) -> dict:
    latest_submission = latest_submission_for_upload_state(
        submission_repo,
        int(project_id),
        bool(checkpoint),
        int(checkpoint_id or 0),
    )
    latest_submission_id = (
        int(getattr(latest_submission, "Id", 0) or 0)
        if latest_submission is not None
        else None
    )

    cooldown_lifted_at = getattr(row, "CooldownLiftedAt", None) if row else None

    if cooldown_lifted_at is not None and cooldown_lifted_at <= current_utc_datetime():
        if row is not None:
            db.session.delete(row)
            db.session.commit()
        cooldown_lifted_at = None

    return {
        "last_submission_id": latest_submission_id,
        "previous_submission_id": latest_submission_id,
        "cooldown_lifted_at": serialize_cooldown_lifted_at(cooldown_lifted_at),
        "cooldown_remaining_seconds": seconds_until(cooldown_lifted_at),
    }


def user_can_access_submission(submission) -> bool:
    if submission is None:
        return False

    return user_can_access_project_id(int(getattr(submission, "Project", 0) or 0))


def current_user_can_view_submission(submission, submission_repo: SubmissionRepository | None = None) -> bool:
    if submission is None:
        return False

    if user_can_access_submission(submission):
        return True

    if int(getattr(submission, "User", -1) or -1) == int(current_user.Id):
        return True

    if submission_repo is not None:
        try:
            return submission_repo.submission_view_verification(
                int(current_user.Id),
                int(getattr(submission, "Id", -1) or -1),
            )
        except Exception:
            return False

    return False

def opt_int(raw) -> int | None:
    s = str(raw or "").strip()
    return int(s) if s.isdigit() else None

def checkpoint_params_from_args() -> tuple[bool, int | None]:
    want_checkpoint = parse_bool(request.args.get("checkpoint", ""))
    ppid = opt_int(request.args.get("checkpoint_id", ""))
    return want_checkpoint, ppid

def latest_checkpoint_submission(project_id: int, user_id: int, checkpoint_id: int | None):
    try:
        q = (
            Submissions.query
            .filter(
                Submissions.Project == int(project_id),
                Submissions.User == int(user_id),
                Submissions.IsCheckpoint == True,
            )
        )
        if checkpoint_id is not None and hasattr(Submissions, "CheckpointId"):
            q = q.filter(Submissions.CheckpointId == int(checkpoint_id))
        return q.order_by(Submissions.Time.desc(), Submissions.Id.desc()).first()
    except Exception:
        return None

def resolve_submission_for_current_user(
    submission_repo: SubmissionRepository,
    project_repo: ProjectRepository,
    submission_id: int,
    class_id: int,
    want_checkpoint: bool,
    ppid: int | None,
):
    """
    Resolves:
      - real submission id -> that submission
      - otherwise treats submission_id as project id and returns latest (main/checkpoint) for current_user
      - if submission_id is EMPTY, resolves current project by class_id and returns latest main submission
    Returns: (submission | None, project_id:int, checkpoint_id_for_hidden_flags:int|None)
    """
    project_id = -1
    sub = None
    checkpoint_id = None

    if submission_id != -1:
        sub = submission_repo.get_submission_by_submission_id(int(submission_id))
        if sub is None:
            project_id = int(submission_id)
            if want_checkpoint:
                sub = latest_checkpoint_submission(project_id, int(current_user.Id), ppid)
            else:
                sub = submission_repo.get_submission_by_user_and_projectid(int(current_user.Id), int(project_id))
        if sub is None:
            return None, int(project_id), None
        project_id = int(getattr(sub, "Project", -1) or -1)
    else:
        proj = project_repo.get_current_project_by_class(int(class_id))
        if proj is None:
            return None, -1, None
        project_id = int(getattr(proj, "Id", -1) or -1)
        sub = submission_repo.get_submission_by_user_and_projectid(int(current_user.Id), int(project_id))
        if sub is None:
            return None, int(project_id), None

    try:
        if bool(getattr(sub, "IsCheckpoint", False)) and getattr(sub, "CheckpointId", None) is not None:
            checkpoint_id = int(getattr(sub, "CheckpointId"))
    except Exception:
        checkpoint_id = None

    return sub, int(project_id), checkpoint_id

def apply_hidden_flags_to_results(output_json: str, project_id: int, checkpoint_id: int | None) -> str:
    try:
        obj = json.loads(output_json) if isinstance(output_json, str) else (output_json or {})
        results = obj.get("results", None) if isinstance(obj, dict) else None
        if not isinstance(results, list) or int(project_id) <= 0:
            return output_json

        q = Testcases.query.filter(Testcases.ProjectId == int(project_id))
        if checkpoint_id is not None:
            q = q.filter(Testcases.CheckpointId == int(checkpoint_id))
        else:
            q = q.filter(Testcases.CheckpointId.is_(None))
        tcs = q.all()
        hidden_by_name = {
            (str(getattr(tc, "Name", "") or "").strip().lower()): bool(getattr(tc, "Hidden", False))
            for tc in (tcs or [])
        }

        for r in results:
            if not isinstance(r, dict):
                continue
            name = None
            if isinstance(r.get("name"), str):
                name = r.get("name")
            elif isinstance(r.get("test"), dict) and isinstance(r["test"].get("name"), str):
                name = r["test"]["name"]

            key = (str(name or "").strip().lower())
            is_hidden = hidden_by_name.get(key, False)
            r["hidden"] = is_hidden
            if isinstance(r.get("test"), dict):
                r["test"]["hidden"] = is_hidden

        return json.dumps(obj, sort_keys=True, indent=4)
    except Exception:
        return output_json

def convert_tap_to_json(file_path, role, current_level, hasLVLSYSEnabled):
    # New grader may write JSON directly. Accept either:
    #  1) a JSON file path
    #  2) a non-.json file whose CONTENTS are JSON
    #  3) (rare) a raw JSON string mistakenly passed as "file_path"
    try:
        s = str(file_path or "").strip()
        if not s:
            return json.dumps({"results": []}, sort_keys=True, indent=4)

        # Raw JSON string fallback
        if (s.startswith("{") or s.startswith("[") and "\n" in s):
            try:
                obj = json.loads(s) or {}
                return json.dumps(obj, sort_keys=True, indent=4)
            except Exception:
                pass

        # If it's a real file, try parsing its contents as JSON first (regardless of extension).
        if os.path.exists(s) and os.path.isfile(s):
            try:
                with open(s, "r", encoding="utf-8", errors="replace") as f:
                    raw = f.read() or ""
                raw_strip = raw.strip()
                if raw_strip.startswith("{") or raw_strip.startswith("["):
                    obj = json.loads(raw_strip) or {}
                    return json.dumps(obj, sort_keys=True, indent=4)
            except Exception:
                pass
    except Exception:
        pass

    parser = Parser()
    test = []
    final = {}

    def sanitize_yaml_block(yaml_block: dict) -> dict:
        new_yaml = (yaml_block or {}).copy()
        return new_yaml

    def parse_suite(yaml_block: dict) -> int:
        try:
            return int((yaml_block or {}).get("suite", 0))
        except (TypeError, ValueError):
            return 0

    for line in parser.parse_file(file_path):
        if line.category != "test":
            continue
        if line.yaml_block is None:
            continue

        yaml_clean = sanitize_yaml_block(line.yaml_block)

        # Levels disabled: return tests as-is
        if not hasLVLSYSEnabled:
            test.append({
                'skipped': line.skip,
                'passed': line.ok,
                'test': yaml_clean
            })
            continue

        suite_req = parse_suite(yaml_clean)

        if current_level >= suite_req:
            test.append({
                'skipped': line.skip,
                'passed': line.ok,
                'test': yaml_clean
            })
        else:
            locked_yaml = {
                "name": yaml_clean.get("name", ""),
                "description": yaml_clean.get("description", ""),
                "suite": suite_req,
                "locked": True
            }
            test.append({
                'skipped': "",
                'passed': "",
                'test': locked_yaml
            })

    final["results"] = test
    return json.dumps(final, sort_keys=True, indent=4)

@submission_api.route('/testcaseerrors', methods=['GET'])
@jwt_required()
@inject
def get_testcase_errors(submission_repo: SubmissionRepository = Provide[Container.submission_repo], project_repo:  ProjectRepository = Provide[Container.project_repo]):
    class_id = parse_int(request.args.get("class_id", "-1"), -1)
    submission_id = parse_int(request.args.get("id", "-1"), -1)
    want_checkpoint, ppid_qs = checkpoint_params_from_args()

    submission, projectid, checkpoint_id = resolve_submission_for_current_user(
        submission_repo,
        project_repo,
        submission_id,
        class_id,
        want_checkpoint,
        ppid_qs,
    )
    if submission is None:
        return make_response(json.dumps({"results": []}), HTTPStatus.OK)

    if not current_user_can_view_submission(submission, submission_repo):
        return make_response("Not Authorized", HTTPStatus.UNAUTHORIZED)

    output = convert_tap_to_json(submission.OutputFilepath, current_user.Role, 0, False)
    output = apply_hidden_flags_to_results(output, int(projectid), checkpoint_id)

    return make_response(output, HTTPStatus.OK)

@submission_api.route('/codefinder', methods=['GET'])
@jwt_required()
@inject
def codefinder(submission_repo: SubmissionRepository = Provide[Container.submission_repo], project_repo: ProjectRepository = Provide[Container.project_repo]):
    submissionid = parse_int(request.args.get("id", "-1"), -1)
    class_id = parse_int(request.args.get("class_id", "-1"), -1)
    fmt = (request.args.get("format", "") or "").strip().lower()
    want_json = fmt in ("json", "view", "preview")

    want_checkpoint, ppid = checkpoint_params_from_args()

    code_output = ""
    if submissionid != -1:
        sub = submission_repo.get_submission_by_submission_id(submissionid)
        if sub is not None and current_user_can_view_submission(sub, submission_repo):
            code_output = submission_repo.get_code_path_by_submission_id(submissionid)
        else:
            resolved, _, _ = resolve_submission_for_current_user(
                submission_repo,
                project_repo,
                int(submissionid),
                int(class_id),
                bool(want_checkpoint),
                ppid,
            )
            code_output = getattr(resolved, "CodeFilepath", "") if resolved else ""
    else:
        if not current_user_can_view_class_id(class_id):
            return make_response("Not Authorized", HTTPStatus.UNAUTHORIZED)

        current_project = project_repo.get_current_project_by_class(class_id)
        if current_project is None:
            return make_response("Not Found", HTTPStatus.NOT_FOUND)

        projectid = current_project.Id
        latest_submission = submission_repo.get_submission_by_user_and_projectid(current_user.Id, projectid)
        code_output = getattr(latest_submission, "CodeFilepath", "") if latest_submission else ""
    # JSON preview mode (used by CodePage) so the UI can render readable source
    if want_json:
        files_payload = []
        if not code_output:
            resp = make_response(json.dumps({"files": []}), HTTPStatus.OK)
            resp.headers["Content-Type"] = "application/json; charset=utf-8"
            resp.headers["Cache-Control"] = "no-store"
            return resp
        if not os.path.isdir(code_output):
            with open(code_output, 'r', encoding='utf-8', errors='replace') as f:
                files_payload.append({"name": os.path.basename(code_output), "content": f.read()})
        else:
            allowed_exts = {".py", ".java", ".c", ".h", ".rkt"}
            names = sorted(os.listdir(code_output), key=lambda n: (n != "Main.java", n.lower()))
            for name in names:
                full = os.path.join(code_output, name)
                if not os.path.isfile(full):
                    continue
                _, ext = os.path.splitext(name)
                if ext.lower() not in allowed_exts:
                    continue
                with open(full, 'r', encoding='utf-8', errors='replace') as f:
                    files_payload.append({"name": name, "content": f.read()})
        resp = make_response(json.dumps({"files": files_payload}), HTTPStatus.OK)
        resp.headers["Content-Type"] = "application/json; charset=utf-8"
        resp.headers["Cache-Control"] = "no-store"
        return resp

    # Download mode (used by StudentList download) stays as attachments/zip
    if not code_output or not os.path.exists(code_output):
        return make_response("Not Found", HTTPStatus.NOT_FOUND)

    if not os.path.isdir(code_output):
        resp = send_file(
            code_output,
            as_attachment=True,
            download_name=os.path.basename(code_output),
        )
        resp.headers["Cache-Control"] = "no-store"
        resp.headers["Access-Control-Expose-Headers"] = "Content-Disposition"
        return resp

    # If it's a directory, zip all relevant source files and return the zip
    allowed_exts = {".py", ".java", ".c", ".h", ".rkt"}
    buf = BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as z:
        # add files with stable ordering
        names = sorted(os.listdir(code_output), key=lambda n: (n != "Main.java", n.lower()))
        for name in names:
            full = os.path.join(code_output, name)
            if not os.path.isfile(full):
                continue
            _, ext = os.path.splitext(name)
            if ext.lower() not in allowed_exts:
                continue
            z.write(full, arcname=name)
    buf.seek(0)

    zip_name = f"submission_{submissionid}.zip"
    resp = send_file(
        buf,
        mimetype="application/zip",
        as_attachment=True,
        download_name=zip_name,
    )
    resp.headers["Cache-Control"] = "no-store"
    resp.headers["Access-Control-Expose-Headers"] = "Content-Disposition"
    return resp

@submission_api.route('/student-upload-state', methods=['GET', 'POST', 'DELETE'])
@jwt_required()
@inject
def student_upload_state(submission_repo: SubmissionRepository = Provide[Container.submission_repo]):
    source = request.args if request.method == 'GET' else (request.get_json(silent=True) or {})
    class_id, project_id, checkpoint, checkpoint_id = upload_state_scope_from_mapping(source)

    if class_id <= 0 or project_id <= 0:
        return make_response({"message": "class_id and project_id are required."}, HTTPStatus.BAD_REQUEST)

    if not current_user_can_use_upload_state(class_id, project_id, checkpoint_id):
        return make_response("Not Authorized", HTTPStatus.UNAUTHORIZED)

    row = get_student_upload_state_row(class_id, project_id, checkpoint_id)

    if request.method == 'GET':
        return jsonify(
            serialize_student_upload_state(
                row,
                submission_repo,
                project_id,
                checkpoint,
                checkpoint_id,
            )
        )

    if request.method == 'DELETE':
        if row is not None:
            db.session.delete(row)
            db.session.commit()

        return jsonify({
            "last_submission_id": None,
            "previous_submission_id": None,
            "cooldown_lifted_at": None,
            "cooldown_remaining_seconds": 0,
        })

    cooldown_lifted_at = cooldown_lifted_at_from_mapping(source)

    if cooldown_lifted_at is None or cooldown_lifted_at <= current_utc_datetime():
        if row is not None:
            db.session.delete(row)
            db.session.commit()

        return jsonify(
            serialize_student_upload_state(
                None,
                submission_repo,
                project_id,
                checkpoint,
                checkpoint_id,
            )
        )

    if row is None:
        row = StudentUploadState(
            UserId=int(current_user.Id),
            ClassId=int(class_id),
            ProjectId=int(project_id),
            CheckpointId=int(checkpoint_id or 0),
        )
        db.session.add(row)

    row.CooldownLiftedAt = cooldown_lifted_at
    db.session.commit()

    return jsonify(
        serialize_student_upload_state(
            row,
            submission_repo,
            project_id,
            checkpoint,
            checkpoint_id,
        )
    )


@submission_api.route('/recentsubproject', methods=['POST'])
@jwt_required()
@inject
def recentsubproject(submission_repo: SubmissionRepository = Provide[Container.submission_repo], user_repo: UserRepository = Provide[Container.user_repo], project_repo: ProjectRepository = Provide[Container.project_repo]):
    input_json = request.get_json() or {}
    projectid = input_json['project_id']

    if not user_can_access_project_id(int(projectid)):
        return make_response("Not Authorized", HTTPStatus.UNAUTHORIZED)

    checkpoint_raw = input_json.get('checkpoint', False)
    checkpoint = str(checkpoint_raw).strip().lower() in ('1', 'true', 'yes', 'y', 'on')

    ppid_raw = input_json.get('checkpoint_id', None)
    try:
        checkpoint_id = int(ppid_raw) if ppid_raw is not None else None
    except (TypeError, ValueError):
        checkpoint_id = None

    project = project_repo.get_selected_project(projectid)
    if project is None:
        return make_response("Not Found", HTTPStatus.NOT_FOUND)

    class_id = int(getattr(project, "ClassId", 0) or 0)
    users = [
        user
        for user in user_repo.get_all_users_by_cid(class_id)
        if user_is_student_in_class_id(int(getattr(user, "Id", 0) or 0), class_id)
    ]

    studentattempts = {}
    userids = [user.Id for user in users]

    if checkpoint and hasattr(Submissions, "IsCheckpoint"):
        bucket = {}
        submission_counter_dict = {uid: 0 for uid in userids}

        q = Submissions.query.filter(
            Submissions.Project == projectid,
            Submissions.User.in_(userids),
            Submissions.IsCheckpoint == True,
        )

        if checkpoint_id is not None and hasattr(Submissions, "CheckpointId"):
            q = q.filter(Submissions.CheckpointId == checkpoint_id)

        subs = q.order_by(Submissions.User.asc(), Submissions.Time.desc()).all()

        for s in subs:
            uid = int(getattr(s, "User", 0) or 0)
            if uid in submission_counter_dict:
                submission_counter_dict[uid] += 1
                if uid not in bucket:
                    bucket[uid] = s
    else:
        bucket = submission_repo.get_most_recent_submission_by_project(projectid, userids)
        submission_counter_dict = submission_repo.submission_counter(projectid, userids)

    user_lectures_dict = user_repo.get_user_lectures(userids, class_id)
    user_labs_dict = user_repo.get_user_labs(userids, class_id)

    for user in users:
        if user.Id in bucket:
            if checkpoint:
                manual_grade = submission_repo.get_manual_grade_for_submission(bucket[user.Id].Id)
                student_grade = manual_grade.get('grade') if manual_grade and manual_grade.get('grade') is not None else 0
            else:
                student_grade = project_repo.get_student_grade(projectid, user.Id)

            student_id = user_repo.get_StudentNumber(user.Id)
            studentattempts[user.Id] = [
                user.Lastname,
                user.Firstname,
                user_lectures_dict.get(user.Id, ""),
                user_labs_dict.get(user.Id, ""),
                submission_counter_dict.get(user.Id, 0),
                bucket[user.Id].Time.isoformat(),
                bucket[user.Id].IsPassing,
                bucket[user.Id].Id,
                str(class_id),
                student_grade,
                student_id,
                user.IsLocked,
            ]
        else:
            student_id = user_repo.get_StudentNumber(user.Id)
            studentattempts[user.Id] = [
                user.Lastname,
                user.Firstname,
                user_lectures_dict.get(user.Id, ""),
                user_labs_dict.get(user.Id, ""),
                "N/A",
                "N/A",
                "N/A",
                "N/A",
                -1,
                str(class_id),
                "0",
                student_id,
                user.IsLocked,
            ]

    return make_response(json.dumps(studentattempts), HTTPStatus.OK)

@submission_api.route('/GetSubmissionDetails', methods=['GET'])
@jwt_required()
@inject
def get_submission_details(project_repo: ProjectRepository = Provide[Container.project_repo]):
    class_id = int(request.args.get("class_id"))
    if not current_user_can_view_class_id(class_id):
        return make_response("Not Authorized", HTTPStatus.UNAUTHORIZED)

    proj = project_repo.get_current_project_by_class(class_id)
    if proj is None:
        return make_response(["None", "0", "None", "", "", "-1"], HTTPStatus.OK)

    end_val = getattr(proj, "End", None)
    if isinstance(end_val, datetime):
        end_str = end_val.isoformat(timespec="seconds")
    else:
        end_str = str(end_val or "")

    # Preserve the existing array shape used by StudentUpload, but removed timing fields are inert.
    return make_response([
        "None",
        "0",
        "None",
        str(getattr(proj, "Name", "") or ""),
        end_str,
        str(int(getattr(proj, "Id", 0) or 0)),
    ], HTTPStatus.OK)


@submission_api.route('/submitgrades', methods=['POST'])
@jwt_required()
@inject
def submit_grades(project_repo: ProjectRepository = Provide[Container.project_repo]):
    #spacing issue
    data = request.get_json() or {}
    project_id = data['projectID']
    if not user_can_access_project_id(int(project_id)):
        return make_response("Not Authorized", HTTPStatus.UNAUTHORIZED)
    userId = data['userId']
    grade = data['grade']
    project_repo.set_student_grade(int(project_id), int(userId), int(grade))
    return make_response("Grades Submitted", HTTPStatus.OK)

@submission_api.route('/getprojectscores', methods=['GET'])
@jwt_required()
@inject
def getprojectscores(project_repo: ProjectRepository = Provide[Container.project_repo], submission_repo: SubmissionRepository = Provide[Container.submission_repo], user_repo: UserRepository = Provide[Container.user_repo]):
    project_id = str(request.args.get("projectID"))
    if not user_can_access_project_id(int(project_id)):
        return make_response("Not Authorized", HTTPStatus.UNAUTHORIZED)

    data = []
    student_scores = submission_repo.get_project_scores(project_id)
    projectname = project_repo.get_selected_project(project_id).Name
    for score in student_scores:
        user_info = user_repo.get_user(score[0])
        data.append([user_info.StudentNumber, score[1], user_info.Id])
    return make_response(json.dumps({"studentData": data, "projectName": projectname}), HTTPStatus.OK)

@submission_api.route('/submit_suggestion', methods=['POST'])
@jwt_required()
@inject
def submit_Suggestion(submission_repo: SubmissionRepository = Provide[Container.submission_repo]):
    data = request.get_json()
    suggestion = data['suggestion']
    submission_repo.submitSuggestion(current_user.Id ,suggestion)
    return make_response("Suggestion Submitted", HTTPStatus.OK)


@submission_api.route('/log_ui', methods=['POST'])
@jwt_required()
def log_ui_click():
    data = request.get_json(silent=True) or {}
    class_id = data.get('class_id', -1)
    submission_id = data.get('id', -1)
    action = str(data.get('action', '')).strip()
    started_state = data.get('started_state', None)
    previous_state_label = data.get('previous_state_label', None)
    next_state_label = data.get('next_state_label', None)
    checkpoint = parse_bool(data.get('checkpoint', False))
    checkpoint_id = data.get('checkpoint_id', None)

    username = getattr(current_user, 'Username', None) or 'unknown'
    role = getattr(current_user, 'Role', None) or 0

    ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    log_path = ui_clicks_log
    os.makedirs(os.path.dirname(log_path), exist_ok=True)

    line = (
        f"{ts} | user:{username} | role:{role} | class:{class_id} | submission:{submission_id}"
        f" | action:{action} | checkpoint:{checkpoint}"
    )
    if checkpoint_id not in (None, ''):
        line += f" | checkpoint_id:{checkpoint_id}"
    if action == 'Diff Finder' and started_state is not None:
        line += f" | started:{bool(started_state)}"
    if previous_state_label not in (None, ''):
        line += f" | from:{previous_state_label}"
    if next_state_label not in (None, ''):
        line += f" | to:{next_state_label}"

    line += "\n"

    with open(log_path, 'a', encoding='utf-8') as f:
        f.write(line)
    return make_response({'status': 'logged'}, HTTPStatus.CREATED)

@submission_api.route('/save-grading', methods=['POST'])
@jwt_required()
@inject
def save_grading(submission_repo: SubmissionRepository = Provide[Container.submission_repo]):
    
    # get the data from frontend
    input_json = request.get_json()
    submission_id = input_json.get('submissionId')
    submission = submission_repo.get_submission_by_submission_id(int(submission_id))
    if not user_can_access_submission(submission):
        return make_response("Not Authorized", HTTPStatus.UNAUTHORIZED)

    grade = input_json.get('grade')
    scoring_mode = input_json.get('scoringMode')
    error_points = input_json.get('errorPoints')
    error_defs = input_json.get('errorDefs')
    errors = input_json.get('errors')  # Expecting list: [{startLine,endLine,errorId,count}, ...]
    checkpoint = str(input_json.get('checkpoint', False)).strip().lower() in ('1', 'true', 'yes', 'y', 'on')
    checkpoint_id_raw = input_json.get('checkpoint_id', None)
    try:
        checkpoint_id = int(checkpoint_id_raw) if checkpoint_id_raw not in (None, '') else None
    except (TypeError, ValueError):
        checkpoint_id = None

    success = submission_repo.save_manual_grading(
        submission_id,
        grade,
        scoring_mode,
        error_points,
        errors,
        error_defs,
        checkpoint=checkpoint,
        checkpoint_id=checkpoint_id,
    )

    # 3. Respond to the frontend
    if success:
        return make_response(json.dumps({'success': True, 'msg': 'Grading saved'}), HTTPStatus.OK)
    else:
        return make_response("Failed to save grading", HTTPStatus.INTERNAL_SERVER_ERROR)

@submission_api.route('/get-grading/<int:submission_id>', methods=['GET'])
@jwt_required()
@inject
def get_grading(submission_id, submission_repo: SubmissionRepository = Provide[Container.submission_repo]):
    submission = submission_repo.get_submission_by_submission_id(int(submission_id))
    if not user_can_access_submission(submission):
        return make_response("Not Authorized", HTTPStatus.UNAUTHORIZED)

    # get errors from db
    error_list = submission_repo.get_manual_errors(submission_id)
    
    cfg = submission_repo.get_manual_grade_config(submission_id)
    return jsonify({
        'success': True,
        'errors': error_list,
        'grade': cfg.get('grade'),
        'scoringMode': cfg.get('scoringMode'),
        'errorPoints': cfg.get('errorPoints'),
        'errorDefs': cfg.get('errorDefs'),
    })

@submission_api.route('/exportprojectgrades', methods=['GET'])
@jwt_required()
@inject
def export_project_grades(submission_repo: SubmissionRepository = Provide[Container.submission_repo], project_repo: ProjectRepository = Provide[Container.project_repo]):
    project_id = int(request.args.get("project_id"))
    if not user_can_access_project_id(project_id):
        return make_response("Not Authorized", HTTPStatus.UNAUTHORIZED)

    checkpoint = str(request.args.get("checkpoint", False)).strip().lower() in ('1', 'true', 'yes', 'y', 'on')
    checkpoint_id_raw = request.args.get("checkpoint_id", None)
    try:
        checkpoint_id = int(checkpoint_id_raw) if checkpoint_id_raw not in (None, '') else None
    except (TypeError, ValueError):
        checkpoint_id = None

    grade_list = submission_repo.get_project_grade_info(project_id, checkpoint=checkpoint, checkpoint_id=checkpoint_id)
    project_name = project_repo.get_selected_project(project_id).Name

    sio = StringIO()
    writer = csv.writer(sio, lineterminator="\n")

    headers = ['OrgDefinedId', f'{project_name} Points Grade', f'{project_name} Text Grade', 'End-of-Line Indicator']
    writer.writerow(headers)

    # Create excel rows
    base_defs_map = dict(ADMIN_GRADING_DEFAULT_DEFS_MAP)

    for row in grade_list:
        pts_dict = row['points'] or {}
        scoring_mode = row['scoring_mode']
        error_data = row['description']
        row_defs = row.get('error_defs') or {}
        defs_map = dict(base_defs_map)
        for k, v in (row_defs.items() if isinstance(row_defs, dict) else []):
            if isinstance(v, dict):
                defs_map[str(k)] = {
                    'label': str(v.get('label', k)),
                    'description': str(v.get('description', '')),
                    'points': int(v.get('points', 0) or 0),
                }
        desc_lines = []
        description = ''

        for error in error_data:
            start = error['startLine']
            end = error['endLine']
            errorId = error['errorId']
            count = error['count']
            note = error.get('note', '')
            error_def = defs_map.get(errorId, {'label': errorId, 'description': '', 'points': 0})
            line_str = ''

            base_pts = int(error_def.get('points', 0) or 0)
            # ErrorPointsJson now stores overrides only. If there is no override, use base_pts.
            override_raw = pts_dict.get(errorId) if isinstance(pts_dict, dict) else None
            if override_raw is None:
                eff_pts = base_pts
            else:
                try:
                    eff_pts = max(0, int(override_raw))
                except Exception:
                    eff_pts = base_pts

            if scoring_mode == "perInstance":
                pts = eff_pts * count
                if count > 1:
                    line_str += f'{count}x '
            else:
                pts = eff_pts

            line_str += f"[{error_def.get('label', errorId)}] "

            if start == end:
                line_str += f'Line {start}'
            else:
                line_str += f'Lines {start}-{end}'

            line_str += f' (-{pts} pts):'
            desc_lines.append(line_str)

            if isinstance(note, str) and note.strip():
                desc_lines.append(f"Note: {note.strip()}")
            desc_lines.append('')

        if not error_data:
            desc_lines.append('Great Job!')

        description = "\n".join(desc_lines)
        writer.writerow([row.get('number'), row.get('grade'), description, '#'])

    buffer = BytesIO(sio.getvalue().encode("utf-8"))
    buffer.seek(0)

    resp = send_file(
        buffer,
        mimetype='text/csv; charset=utf-8',
        download_name=f'{project_name}-grades.csv',
        as_attachment=True
    )

    resp.headers["Project-Name"] = project_name
    resp.headers["Access-Control-Expose-Headers"] = "Content-Disposition, Project-Name"
    resp.headers["Cache-Control"] = "no-store"
    return resp