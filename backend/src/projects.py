
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
from collections import defaultdict
from datetime import datetime
from http import HTTPStatus
from io import BytesIO
from urllib.parse import quote

from dependency_injector.wiring import Provide, inject
from flask import Blueprint, Response, jsonify, make_response, request
from flask_jwt_extended import current_user, jwt_required
from sqlalchemy import func
from werkzeug.utils import secure_filename

from container import Container
from src.constants import ADMIN_ROLE, TEACHER_ROLE
from src.repositories.class_repository import ClassRepository
from src.repositories.database import db
from src.repositories.models import (
    ClassAssignments,
    Classes,
    Modules,
    Checkpoints,
    Projects,
    Submissions,
)
from src.repositories.project_repository import ProjectRepository
from src.repositories.submission_repository import SubmissionRepository
from src.repositories.user_repository import UserRepository

projects_api = Blueprint('projects_api', __name__)

ALLOWED_SOURCE_EXTS = {'.py', '.c', '.java', '.rkt'}
TS_DIR_RE = re.compile(r"^\d{8}_\d{6}$")


def normalize_grader_language(language: str, solution_root: str = "") -> str:
    """
    Convert the project language stored/displayed by the app into the token
    expected by /tabot-files/grading-scripts/grade.py. The UI stores Python as
    "python", but the grader's language switch uses "py".
    """
    raw = str(language or "").strip().lower()
    aliases = {
        "python": "py",
        "python3": "py",
        "py": "py",
        "java": "java",
        "c": "c",
        "racket": "racket",
        "rkt": "racket",
        "scheme": "racket",
        "scm": "racket",
    }
    if raw in aliases:
        return aliases[raw]

    try:
        candidates = []
        if solution_root and os.path.isdir(solution_root):
            candidates = [os.path.splitext(name)[1].lower() for name in os.listdir(solution_root)]
        elif solution_root:
            candidates = [os.path.splitext(solution_root)[1].lower()]

        if ".py" in candidates:
            return "py"
        if ".java" in candidates:
            return "java"
        if ".c" in candidates:
            return "c"
        if ".rkt" in candidates or ".scm" in candidates:
            return "racket"
    except Exception:
        pass

    return raw or "py"

def parse_int(v, default: int = 0) -> int:
    try:
        return int(str(v).strip())
    except Exception:
        return default

DEFAULT_CHECKPOINT_NAME_RE = re.compile(r"^(checkpoint)\s+\d+$", re.IGNORECASE)

def default_checkpoint_name(number: int) -> str:
    return f"Checkpoint {int(number)}"

def should_renumber_default_checkpoint_name(name: str) -> bool:
    return bool(DEFAULT_CHECKPOINT_NAME_RE.match(str(name or "").strip()))

def normalize_default_checkpoint_names(project_repo: ProjectRepository, rows):
    normalized_rows = []

    for index, row in enumerate(rows or []):
        next_name = default_checkpoint_name(index + 1)
        current_name = str(getattr(row, "Name", "") or "").strip()

        if should_renumber_default_checkpoint_name(current_name) and current_name != next_name:
            try:
                project_repo.update_checkpoint_name(int(row.Id), next_name)
                setattr(row, "Name", next_name)
            except Exception as exc:
                print(
                    f"[checkpoint] could not normalize checkpoint name for {getattr(row, 'Id', '')}: {exc}",
                    flush=True,
                )

        normalized_rows.append(row)

    return normalized_rows

def ensure_default_checkpoint_for_project(
    project_repo: ProjectRepository,
    project_id: int,
    *,
    context: str = "project",
) -> int | None:
    project_id = parse_int(project_id, 0)
    if project_id <= 0:
        return None

    try:
        existing_checkpoints = project_repo.list_checkpoints(project_id)
        if existing_checkpoints:
            return int(existing_checkpoints[0].Id)

        checkpoint_id = project_repo.create_checkpoint(
            project_id,
            name=default_checkpoint_name(1),
        )
        return int(checkpoint_id) if checkpoint_id else None
    except Exception as exc:
        print(
            f"[{context}] default checkpoint creation failed for project {project_id}: {exc}",
            flush=True,
        )
        return None


def ensure_default_checkpoint_for_module(
    project_repo: ProjectRepository,
    module_id: int,
    *,
    context: str = "module",
) -> int | None:
    module_id = parse_int(module_id, 0)
    if module_id <= 0:
        return None

    try:
        project = project_repo.get_main_project_for_module(module_id)
    except Exception as exc:
        print(
            f"[{context}] could not load main project for module {module_id}: {exc}",
            flush=True,
        )
        return None

    if not project:
        print(
            f"[{context}] no main project exists for module {module_id}; default checkpoint was not created",
            flush=True,
        )
        return None

    return ensure_default_checkpoint_for_project(
        project_repo,
        int(project.Id),
        context=context,
    )


def parse_bool(v) -> bool:
    if isinstance(v, bool):
        return v
    s = str(v or "").strip().lower()
    return s in ("1", "true", "yes", "y", "on")

def is_admin_user() -> bool:
    return int(getattr(current_user, "Role", -1) or -1) == ADMIN_ROLE


def is_teacher_user() -> bool:
    return int(getattr(current_user, "Role", -1) or -1) == TEACHER_ROLE


def is_staff_user() -> bool:
    return is_admin_user() or is_teacher_user()


def access_denied_response(status=HTTPStatus.UNAUTHORIZED):
    return make_response({'message': 'Access Denied'}, status)

def source_file_names(path_value: str) -> list[str]:
    if not path_value:
        return []

    try:
        if os.path.isdir(path_value):
            names = []
            for filename in sorted(os.listdir(path_value)):
                full_path = os.path.join(path_value, filename)
                if os.path.isfile(full_path):
                    _, ext = os.path.splitext(filename)
                    if ext.lower() in ALLOWED_SOURCE_EXTS:
                        names.append(filename)
            return names

        _, ext = os.path.splitext(path_value)
        return [os.path.basename(path_value)] if ext.lower() in ALLOWED_SOURCE_EXTS else []
    except Exception:
        return []


def project_setup_status(
    project_repo: ProjectRepository,
    project_id: int,
    checkpoint_id: int | None = None,
    testcase_count: int | None = None,
):
    if testcase_count is None:
        try:
            testcase_count = project_repo.count_testcases(
                int(project_id),
                checkpoint_id=(int(checkpoint_id) if checkpoint_id else None),
            )
        except Exception:
            testcase_count = 0

    try:
        solution_path = project_repo.get_project_path(
            int(project_id),
            checkpoint_id=(int(checkpoint_id) if checkpoint_id else None),
        )
        has_solution_program = len(source_file_names(solution_path)) > 0
    except Exception:
        has_solution_program = False

    return {
        "HasSolutionProgram": bool(has_solution_program),
        "HasTestcases": int(testcase_count or 0) > 0,
        "TestcaseCount": int(testcase_count or 0),
    }




def student_checkpoint_rows(project_repo: ProjectRepository, project_id: int) -> list[dict]:
    """
    Student-safe checkpoint list rows.
    Returns only enabled checkpoints and includes setup/progress fields used by student pages.
    """
    project_id = parse_int(project_id, 0)
    if project_id <= 0:
        return []

    try:
        rows = normalize_default_checkpoint_names(
            project_repo,
            project_repo.list_checkpoints(project_id),
        )
    except Exception as exc:
        print(f"[student_checkpoint_rows] failed to list checkpoints for project {project_id}: {exc}", flush=True)
        return []

    passed_checkpoint_ids: set[int] = set()
    try:
        if hasattr(Submissions, "IsCheckpoint") and hasattr(Submissions, "CheckpointId"):
            passed_rows = (
                db.session.query(Submissions.CheckpointId)
                .filter(
                    Submissions.Project == int(project_id),
                    Submissions.User == int(current_user.Id),
                    Submissions.IsCheckpoint == True,
                    Submissions.IsPassing == True,
                    Submissions.CheckpointId.isnot(None),
                )
                .distinct()
                .all()
            )
            passed_checkpoint_ids = {
                int(row[0])
                for row in passed_rows
                if row and row[0] is not None and parse_int(row[0], 0) > 0
            }
    except Exception as exc:
        print(
            f"[student_checkpoint_rows] failed to load solved checkpoints for project {project_id}: {exc}",
            flush=True,
        )
        passed_checkpoint_ids = set()

    out = []
    for index, row in enumerate(rows or []):
        checkpoint_id = parse_int(getattr(row, "Id", 0), 0)
        if checkpoint_id <= 0:
            continue

        enabled = bool(getattr(row, "Enabled", True))
        if not enabled:
            continue

        status = project_setup_status(
            project_repo,
            project_id,
            checkpoint_id=checkpoint_id,
        )
        name = str(getattr(row, "Name", "") or default_checkpoint_name(index + 1))
        solved = checkpoint_id in passed_checkpoint_ids

        out.append({
            "id": checkpoint_id,
            "checkpointId": checkpoint_id,
            "Id": checkpoint_id,
            "CheckpointId": checkpoint_id,
            "number": index + 1,
            "Number": index + 1,
            "name": name,
            "Name": name,
            "enabled": enabled,
            "Enabled": enabled,
            "solved": solved,
            "Solved": solved,
            "passed": solved,
            "Passed": solved,
            "rewarded": solved,
            "Rewarded": solved,
            "hasSolutionProgram": bool(status.get("HasSolutionProgram", False)),
            "HasSolutionProgram": bool(status.get("HasSolutionProgram", False)),
            "hasTestcases": bool(status.get("HasTestcases", False)),
            "HasTestcases": bool(status.get("HasTestcases", False)),
            "testcaseCount": int(status.get("TestcaseCount", 0) or 0),
            "TestcaseCount": int(status.get("TestcaseCount", 0) or 0),
        })

    return out


def checkpoint_submission_count_map(project_id: int) -> dict[int, int]:
    try:
        if hasattr(Submissions, "CheckpointId"):
            rows = (
                db.session.query(
                    Submissions.CheckpointId,
                    func.count(func.distinct(Submissions.User)),
                )
                .filter(Submissions.Project == int(project_id), Submissions.IsCheckpoint == True)
                .group_by(Submissions.CheckpointId)
                .all()
            )
            return {int(ppid): int(count or 0) for ppid, count in rows if ppid is not None}
    except Exception:
        pass
    return {}


def checkpoint_unique_user_counts(project_ids: list[int]) -> dict[int, int]:
    ids = [int(pid) for pid in (project_ids or []) if int(pid or 0) > 0]
    if not ids:
        return {}

    try:
        rows = (
            db.session.query(
                Submissions.Project,
                func.count(func.distinct(Submissions.User)),
            )
            .filter(Submissions.Project.in_(ids), Submissions.IsCheckpoint == True)
            .group_by(Submissions.Project)
            .all()
        )
        return {int(project_id): int(count or 0) for project_id, count in rows if project_id is not None}
    except Exception:
        return {}


def main_completed_project_ids(project_ids: list[int]) -> set[int]:
    ids = [int(pid) for pid in (project_ids or []) if int(pid or 0) > 0]
    if not ids:
        return set()

    try:
        rows = (
            db.session.query(Submissions.Project)
            .filter(
                Submissions.Project.in_(ids),
                Submissions.User == int(current_user.Id),
                Submissions.IsCheckpoint == False,
                Submissions.IsPassing == True,
            )
            .distinct()
            .all()
        )
        return {int(row[0]) for row in rows if row and row[0] is not None}
    except Exception:
        return set()

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

    if is_admin_user():
        return Classes.query.filter(Classes.Id == class_id).first() is not None

    if is_teacher_user():
        class_item = Classes.query.filter(Classes.Id == class_id).first()
        return teacher_id_is_on_class(int(current_user.Id), class_item)

    return False


def user_can_access_project_id(project_id: int) -> bool:
    project_id = parse_int(project_id, 0)
    if project_id <= 0:
        return False

    project = Projects.query.filter(Projects.Id == project_id).first()
    if project is None:
        return False

    return user_can_access_class_id(int(getattr(project, "ClassId", 0) or 0))

def current_user_is_enrolled_in_project_class(project_id: int) -> bool:
    project_id = parse_int(project_id, 0)
    if project_id <= 0:
        return False

    project = Projects.query.filter(Projects.Id == project_id).first()
    if project is None:
        return False

    class_id = parse_int(getattr(project, "ClassId", 0) or 0, 0)
    if class_id <= 0:
        return False

    try:
        return (
            ClassAssignments.query.filter(
                ClassAssignments.ClassId == class_id,
                ClassAssignments.UserId == int(current_user.Id),
            ).first()
            is not None
        )
    except Exception:
        return False


def current_user_can_download_project_files(project_id: int) -> bool:
    return user_can_access_project_id(project_id) or current_user_is_enrolled_in_project_class(project_id)



def user_can_access_module_id(module_id: int) -> bool:
    module_id = parse_int(module_id, 0)
    if module_id <= 0:
        return False

    module = Modules.query.filter(Modules.Id == module_id).first()
    if module is None:
        return False

    return user_can_access_class_id(int(getattr(module, "ClassId", 0) or 0))


def user_can_access_checkpoint_id(checkpoint_id: int) -> bool:
    checkpoint_id = parse_int(checkpoint_id, 0)
    if checkpoint_id <= 0:
        return False

    checkpoint = Checkpoints.query.filter(Checkpoints.Id == checkpoint_id).first()
    if checkpoint is None:
        return False

    return user_can_access_project_id(int(getattr(checkpoint, "ProjectId", 0) or 0))


def user_can_access_student_id(student_id: int) -> bool:
    student_id = parse_int(student_id, 0)
    if student_id <= 0:
        return False

    if is_admin_user():
        return True

    if not is_teacher_user():
        return False

    assignments = ClassAssignments.query.filter(ClassAssignments.UserId == student_id).all()
    return any(user_can_access_class_id(int(assignment.ClassId)) for assignment in assignments)


def filter_projects_for_current_user(projects):
    if is_admin_user():
        return projects

    return [
        project
        for project in projects
        if user_can_access_class_id(int(getattr(project, "ClassId", 0) or 0))
    ]

def opt_int(raw) -> int | None:
    s = str(raw or "").strip()
    return int(s) if s.isdigit() else None

def json_list_field(raw: str) -> list[str]:
    """
    Accepts:
      - '["a","b"]'
      - 'a'
      - '' / None
    Returns list[str] of basenames.
    """
    try:
        s = (raw or "").strip()
        if not s:
            return []
        vals = json.loads(s) if s.startswith("[") else [s]
        return [os.path.basename(v) for v in (vals or []) if v]
    except Exception:
        return []


def project_module(project):
    if not project:
        return None
    module = getattr(project, "Module", None)
    if module:
        return module
    module_id = getattr(project, "ModuleId", None)
    if module_id:
        return Modules.query.filter(Modules.Id == int(module_id)).first()
    return None

def project_start(project):
    module = project_module(project)
    return getattr(module, "Start", None) if module else None

def project_end(project):
    module = project_module(project)
    return getattr(module, "End", None) if module else None

def count_checkpoint_unique_users(project_id: int) -> int:
    try:
        if hasattr(Submissions, "IsCheckpoint"):
            return int(
                db.session.query(func.count(func.distinct(Submissions.User)))
                .filter(Submissions.Project == int(project_id), Submissions.IsCheckpoint == True)
                .scalar()
                or 0
            )
    except Exception:
        pass
    return 0

def project_root() -> str:
    return "/tabot-files/project-files"

def teacher_root() -> str:
    return os.path.join(project_root(), "teacher-files")

def student_root() -> str:
    return os.path.join(project_root(), "student-files")

def project_dir(base_proj: str, ts: str) -> str:
    # teacher-files/<YYYYMMDD_HHMMSS>__<projectname>
    return os.path.join(teacher_root(), f"{ts}__{base_proj}")

def checkpoint_teacher_root() -> str:
    return os.path.join(project_root(), "teacher-checkpoint-files")

def checkpoint_project_dir(project_id: int) -> str:
    return os.path.join(checkpoint_teacher_root(), str(int(project_id)))

def checkpoint_version_dir(project_id: int, ts: str) -> str:
    return os.path.join(checkpoint_project_dir(project_id), ts)

def is_ts_dir(name: str) -> bool:
    return bool(TS_DIR_RE.match(name or ""))

def version_dir(proj_dir_path: str, ts: str) -> str:
    # teacher-files/<projecttimestamp__projectname>/<submissiontimestamp>/
    return os.path.join(proj_dir_path, ts)

def pick_latest_version_dir(proj_dir_path: str) -> str | None:
    try:
        kids = [d for d in os.listdir(proj_dir_path) if is_ts_dir(d) and os.path.isdir(os.path.join(proj_dir_path, d))]
        if kids:
            return os.path.join(proj_dir_path, max(kids))
    except Exception:
        pass
    return None

def seed_version_dir(dest_dir: str, *, seed_from_dir: str | None, seed_solution_path: str | None, seed_desc_path: str | None, seed_add_paths: list[str]):
    os.makedirs(dest_dir, exist_ok=True)
    # Prefer copying an existing version directory (new layout)
    if seed_from_dir and os.path.isdir(seed_from_dir):
        shutil.copytree(seed_from_dir, dest_dir, dirs_exist_ok=True)
        return
    # Legacy seeding: copy solution file/dir sources
    if seed_solution_path and os.path.exists(seed_solution_path):
        if os.path.isdir(seed_solution_path):
            for fn in os.listdir(seed_solution_path):
                src = os.path.join(seed_solution_path, fn)
                if os.path.isfile(src) and os.path.splitext(fn)[1].lower() in (ALLOWED_SOURCE_EXTS | {".h", ".hpp", ".cpp"}):
                    shutil.copy2(src, os.path.join(dest_dir, fn))
        else:
            shutil.copy2(seed_solution_path, os.path.join(dest_dir, os.path.basename(seed_solution_path)))
    # Copy assignment description
    if seed_desc_path and os.path.isfile(seed_desc_path):
        shutil.copy2(seed_desc_path, os.path.join(dest_dir, os.path.basename(seed_desc_path)))
    # Copy additional files
    for p in (seed_add_paths or []):
        if p and os.path.isfile(p):
            shutil.copy2(p, os.path.join(dest_dir, os.path.basename(p)))

def module_payload(
    module,
    project_repo: ProjectRepository,
    submission_repo: SubmissionRepository,
    total_submission_counts: dict[int, int] | None = None,
    checkpoint_total_counts: dict[int, int] | None = None,
    main_completed_project_ids: set[int] | None = None,
):
    project = project_repo.get_main_project_for_module(int(module.Id)) if module else None
    total_submissions = 0
    checkpoint_total = 0
    main_completed = False

    if project:
        project_id = int(project.Id)

        try:
            if total_submission_counts is None:
                total_submission_counts = submission_repo.get_total_submission_for_all_projects()
            total_submissions = int(total_submission_counts.get(project_id, 0) or 0)
        except Exception:
            total_submissions = 0

        try:
            if checkpoint_total_counts is None:
                checkpoint_total = count_checkpoint_unique_users(project_id)
            else:
                checkpoint_total = int(checkpoint_total_counts.get(project_id, 0) or 0)
        except Exception:
            checkpoint_total = 0

        try:
            if main_completed_project_ids is not None:
                main_completed = project_id in main_completed_project_ids
            else:
                main_completed = bool(
                    Submissions.query.filter(
                        Submissions.Project == project_id,
                        Submissions.User == int(current_user.Id),
                        Submissions.IsCheckpoint == False,
                        Submissions.IsPassing == True,
                    ).first()
                )
        except Exception:
            main_completed = False

    return {
        "Id": module.Id,
        "ClassId": module.ClassId,
        "Name": module.Name,
        "Start": module.Start.strftime("%x %X") if module.Start else "",
        "End": module.End.strftime("%x %X") if module.End else "",
        "MainProjectId": getattr(project, "Id", None),
        "MainProjectName": getattr(project, "Name", "") if project else "",
        "TotalSubmissions": total_submissions,
        "CheckpointTotalSubmissions": int(checkpoint_total),
        "CheckpointsEnabled": True,
        "MainCompleted": main_completed,
    }


def project_payload(
    project,
    submission_repo: SubmissionRepository,
    project_repo: ProjectRepository,
    total_submission_counts: dict[int, int] | None = None,
    checkpoint_total_counts: dict[int, int] | None = None,
):
    if not project:
        return None

    project_id = int(project.Id)

    try:
        if total_submission_counts is None:
            total_submission_counts = submission_repo.get_total_submission_for_all_projects()
        total_submissions = int(total_submission_counts.get(project_id, 0) or 0)
    except Exception:
        total_submissions = 0

    try:
        if checkpoint_total_counts is None:
            checkpoint_total = count_checkpoint_unique_users(project_id)
        else:
            checkpoint_total = int(checkpoint_total_counts.get(project_id, 0) or 0)
    except Exception:
        checkpoint_total = 0

    return {
        "Id": project.Id,
        "Name": project.Name,
        "Start": project_start(project).strftime("%x %X") if project_start(project) else "",
        "End": project_end(project).strftime("%x %X") if project_end(project) else "",
        "TotalSubmissions": total_submissions,
        "CheckpointTotalSubmissions": int(checkpoint_total),
        "CheckpointsEnabled": True,
        **project_setup_status(project_repo, project_id),
    }

@projects_api.route('/all_projects', methods=['GET'])
@jwt_required()
@inject
def all_projects(project_repo: ProjectRepository = Provide[Container.project_repo], submission_repo: SubmissionRepository = Provide[Container.submission_repo]):
    if not is_staff_user():
        return access_denied_response()
    data = filter_projects_for_current_user(project_repo.get_all_projects())
    new_projects = []
    thisdic = submission_repo.get_total_submission_for_all_projects()
    for proj in data:

        checkpoint_total = count_checkpoint_unique_users(int(proj.Id))

        new_projects.append(json.dumps({
            "Id": proj.Id,
            "Name": proj.Name,
            "Start": project_start(proj).strftime("%x %X") if project_start(proj) else "",
            "End": project_end(proj).strftime("%x %X") if project_end(proj) else "",
            "TotalSubmissions": int(thisdic.get(proj.Id, 0) or 0),
            "CheckpointTotalSubmissions": int(checkpoint_total),
            "CheckpointsEnabled": True,
            "ModuleId": getattr(proj, "ModuleId", None),
        }))
    return jsonify(new_projects)

@projects_api.route('/set_checkpoints_enabled', methods=['POST'])
@jwt_required()
@inject
def set_checkpoints_enabled(project_repo: ProjectRepository = Provide[Container.project_repo]):
    if not is_staff_user():
        return access_denied_response()

    data = request.get_json(silent=True) or {}
    pid = parse_int(data.get("project_id", 0), 0)
    enabled = True

    if pid <= 0:
        return make_response({'message': 'Invalid project_id'}, HTTPStatus.BAD_REQUEST)
    if not user_can_access_project_id(pid):
        return access_denied_response(HTTPStatus.FORBIDDEN)

    try:
        project_repo.set_checkpoints_enabled(pid, True)
        return jsonify({'ok': True, 'enabled': True})
    except Exception:
        return make_response({'ok': False}, HTTPStatus.INTERNAL_SERVER_ERROR)

@projects_api.route('/list_checkpoints', methods=['GET'])
@jwt_required()
@inject
def list_checkpoints(project_repo: ProjectRepository = Provide[Container.project_repo]):
    if not is_staff_user():
        return access_denied_response()
    pid = parse_int(request.args.get("project_id", ""), 0)
    if pid <= 0:
        return jsonify({'problems': []})
    if not user_can_access_project_id(pid):
        return access_denied_response(HTTPStatus.FORBIDDEN)
    rows = project_repo.list_checkpoints(int(pid))
    return jsonify({
        'problems': [
            {
                'id': int(r.Id),
                'number': i + 1,
                'name': (getattr(r, "Name", "") or f"Checkpoint {i + 1}"),
                'enabled': bool(getattr(r, "Enabled", True)),
            }
            for i, r in enumerate(rows)
        ]
    })


@projects_api.route('/list_checkpoints_student', methods=['GET'])
@jwt_required()
@inject
def list_checkpoints_student(project_repo: ProjectRepository = Provide[Container.project_repo]):
    """
    Student-safe checkpoint list.
    Returns only enabled checkpoints. Checkpoints are always enabled at the project level.
    """
    project_id = parse_int(request.args.get("project_id", ""), 0)
    if project_id <= 0:
        return jsonify({'problems': []})

    return jsonify({'problems': student_checkpoint_rows(project_repo, project_id)})

@projects_api.route('/create_checkpoint', methods=['POST'])
@jwt_required()
@inject
def create_checkpoint(project_repo: ProjectRepository = Provide[Container.project_repo]):
    if not is_staff_user():
        return access_denied_response()

    data = request.get_json(silent=True) or {}
    pid = parse_int(data.get("project_id", 0), 0)
    name = str(data.get('name', '') or '').strip()

    if pid <= 0:
        return make_response({'message': 'Invalid project_id'}, HTTPStatus.BAD_REQUEST)
    if not user_can_access_project_id(pid):
        return access_denied_response(HTTPStatus.FORBIDDEN)

    if not name:
        try:
            next_number = len(project_repo.list_checkpoints(pid)) + 1
            name = default_checkpoint_name(next_number)
        except Exception:
            name = default_checkpoint_name(1)

    try:
        new_id = project_repo.create_checkpoint(pid, name=name)
    except Exception as exc:
        print(f"[create_checkpoint] failed for project {pid}: {exc}", flush=True)
        return make_response({'message': 'Could not create checkpoint'}, HTTPStatus.INTERNAL_SERVER_ERROR)

    if not new_id:
        return make_response({'message': 'Could not create checkpoint'}, HTTPStatus.INTERNAL_SERVER_ERROR)

    try:
        rows = project_repo.list_checkpoints(pid)
        ordered_ids = [int(row.Id) for row in rows]
        if ordered_ids:
            project_repo.reorder_checkpoints(pid, ordered_ids)
    except Exception as exc:
        print(f"[create_checkpoint] checkpoint created, but numbering refresh failed: {exc}", flush=True)

    return jsonify({'ok': True, 'checkpoint_id': int(new_id)})

@projects_api.route('/reorder_checkpoints', methods=['POST'])
@jwt_required()
@inject
def reorder_checkpoints(project_repo: ProjectRepository = Provide[Container.project_repo]):
    if not is_staff_user():
        return access_denied_response()

    data = request.get_json(silent=True) or {}
    pid = parse_int(data.get("project_id", 0), 0)
    ordered_ids_raw = data.get("ordered_ids", [])

    if pid <= 0 or not isinstance(ordered_ids_raw, list):
        return make_response({'message': 'Missing required fields'}, HTTPStatus.BAD_REQUEST)
    if not user_can_access_project_id(pid):
        return access_denied_response(HTTPStatus.FORBIDDEN)

    ordered_ids = [parse_int(item, 0) for item in ordered_ids_raw]
    ordered_ids = [item for item in ordered_ids if item > 0]

    try:
        rows = project_repo.reorder_checkpoints(pid, ordered_ids)
        return jsonify({
            'ok': True,
            'problems': [
                {
                    'id': int(r.Id),
                    'number': i + 1,
                    'name': (getattr(r, "Name", "") or default_checkpoint_name(i + 1)),
                    'enabled': bool(getattr(r, "Enabled", True)),
                }
                for i, r in enumerate(rows)
            ],
        })
    except Exception as exc:
        print(exc, flush=True)
        return make_response({'message': 'Could not reorder checkpoints'}, HTTPStatus.INTERNAL_SERVER_ERROR)

@projects_api.route('/delete_checkpoint', methods=['POST'])
@jwt_required()
@inject
def delete_checkpoint(project_repo: ProjectRepository = Provide[Container.project_repo]):
    if not is_staff_user():
        return access_denied_response()

    data = request.get_json(silent=True) or {}
    checkpoint_id = parse_int(data.get("checkpoint_id", 0), 0)

    if checkpoint_id <= 0:
        return make_response({'message': 'Missing required fields'}, HTTPStatus.BAD_REQUEST)
    if not user_can_access_checkpoint_id(checkpoint_id):
        return access_denied_response(HTTPStatus.FORBIDDEN)

    try:
        pp = project_repo.get_checkpoint(checkpoint_id)
        if not pp:
            return make_response({'message': 'Checkpoint not found'}, HTTPStatus.NOT_FOUND)

        project_id = int(getattr(pp, "ProjectId", 0) or 0)
        existing_rows = project_repo.list_checkpoints(project_id) if project_id > 0 else []
        if len(existing_rows) <= 1:
            return make_response(
                {'message': 'A module must have at least one checkpoint'},
                HTTPStatus.BAD_REQUEST,
            )

        deleted = project_repo.delete_checkpoint(checkpoint_id)
        if not deleted:
            return make_response({'message': 'Checkpoint not found'}, HTTPStatus.NOT_FOUND)

        remaining_rows = project_repo.list_checkpoints(project_id)
        remaining_ids = [int(row.Id) for row in remaining_rows]
        if remaining_ids:
            remaining_rows = project_repo.reorder_checkpoints(project_id, remaining_ids)
        return jsonify({'ok': True})
    except Exception as exc:
        print(exc, flush=True)
        return make_response({'message': 'Could not delete checkpoint'}, HTTPStatus.INTERNAL_SERVER_ERROR)

@projects_api.route('/list_solution_files', methods=['GET'])
@jwt_required()
@inject
def list_solution_files(project_repo: ProjectRepository = Provide[Container.project_repo]):
    if not is_staff_user():
        return access_denied_response()

    pid = parse_int(request.args.get("id", ""), 0)
    ppid = opt_int(request.args.get("checkpoint_id", ""))

    if pid <= 0:
        return make_response([], HTTPStatus.OK)
    if not user_can_access_project_id(pid):
        return access_denied_response(HTTPStatus.FORBIDDEN)

    p = project_repo.get_project_path(pid, checkpoint_id=ppid)
    if not p:
        return make_response([], HTTPStatus.OK)

    try:
        if os.path.isdir(p):
            names = []
            for fn in sorted(os.listdir(p)):
                full = os.path.join(p, fn)
                if os.path.isfile(full):
                    _, ext = os.path.splitext(fn)
                    if ext.lower() in ALLOWED_SOURCE_EXTS:
                        names.append(fn)
            return make_response(names, HTTPStatus.OK)
        return make_response([os.path.basename(p)], HTTPStatus.OK)
    except Exception:
        return make_response([], HTTPStatus.OK)

@projects_api.route('/check_time_conflict', methods=['POST'])
@jwt_required()
@inject
def check_time_conflict(project_repo: ProjectRepository = Provide[Container.project_repo]):
    """
    JSON body:
      {
        "project_id": <int>,     # current project id (exclude from comparison)
        "class_id": <int>,       # class scope for comparison
        "start_date": "YYYY-MM-DDTHH:MM",
        "end_date":   "YYYY-MM-DDTHH:MM"
      }
    Returns: { "conflict": bool, "conflicts": [ {id,name,start,end}, ... ] }
    """
    if not is_staff_user():
        return access_denied_response()

    data = request.get_json(silent=True) or {}
    pid = int(str(data.get('project_id', 0)) or 0)
    class_id = str(data.get('class_id', '')).strip()
    start_s = str(data.get('start_date', '')).strip()
    end_s = str(data.get('end_date', '')).strip()

    if not class_id or not start_s or not end_s:
        return make_response({'message': 'Missing required fields'}, HTTPStatus.BAD_REQUEST)
    if not user_can_access_class_id(parse_int(class_id, 0)):
        return access_denied_response(HTTPStatus.FORBIDDEN)
    if pid > 0 and not user_can_access_project_id(pid):
        return access_denied_response(HTTPStatus.FORBIDDEN)

    try:
        start_dt = datetime.fromisoformat(start_s)
        end_dt = datetime.fromisoformat(end_s)
    except ValueError:
        return make_response({'message': 'Invalid datetime format'}, HTTPStatus.BAD_REQUEST)

    conflicts = []
    try:
        current_module_id = None
        if pid > 0:
            current_project = project_repo.get_selected_project(pid)
            current_module_id = getattr(current_project, "ModuleId", None) if current_project else None

        modules = project_repo.get_modules_by_class_id(class_id)
        for module in modules:
            if current_module_id and int(getattr(module, "Id", 0) or 0) == int(current_module_id):
                continue
            p_start = getattr(module, 'Start', None)
            p_end = getattr(module, 'End', None)
            if not p_start or not p_end:
                continue
            # strict overlap: allows back-to-back intervals without conflict
            if (start_dt < p_end) and (p_start < end_dt):
                conflicts.append({
                    'id': getattr(module, 'Id', None),
                    'name': getattr(module, 'Name', ''),
                    'start': p_start.isoformat(),
                    'end': p_end.isoformat(),
                })
    except Exception:
        # Fail-safe: treat as no conflicts if repo call fails
        conflicts = []

    return jsonify({'conflict': bool(conflicts), 'conflicts': conflicts})

@projects_api.route('/run-plagiarism', methods=['POST'])
@jwt_required()
@inject
def run_plagiarism(user_repo: UserRepository = Provide[Container.user_repo], submission_repo: SubmissionRepository = Provide[Container.submission_repo], project_repo: ProjectRepository = Provide[Container.project_repo]):
    if not is_staff_user():
        return access_denied_response()
    
    input_json = request.get_json()
    projectid = input_json['project_id']
    if not user_can_access_project_id(projectid):
        return access_denied_response(HTTPStatus.FORBIDDEN)

    # Fetch language from projects DB and pass it through
    proj = project_repo.get_selected_project(projectid)
    language = getattr(proj, "Language", "") if proj else ""

    from src.services.dataService import run_local_plagiarism
    result = run_local_plagiarism(projectid, submission_repo, user_repo, project_repo, language=language)

    return make_response(result, HTTPStatus.OK)
    
@projects_api.route('/projects-by-user', methods=['GET'])
@jwt_required()
@inject
def get_projects_by_user(project_repo: ProjectRepository = Provide[Container.project_repo], submission_repo: SubmissionRepository = Provide[Container.submission_repo]):
    projects= project_repo.get_all_projects()
    student_submissions={}
    for project in projects:
        subs = submission_repo.get_most_recent_submission_by_project(project.Id, [current_user.Id])
        class_name = project_repo.get_className_by_projectId(project.Id)
        if current_user.Id in subs: 
            sub = subs[current_user.Id]
            student_submissions[project.Name]=[sub.Id, 0, sub.Time.strftime("%x %X"), class_name, str(project.ClassId)]
    return jsonify(student_submissions)

@projects_api.route('/past-submissions', methods=['GET'])
@jwt_required()
def past_submissions():
    """
    Student past submissions grouped by project.
    Returns:
      [
        {
          projectId, projectName, classId, className, start, end,
          main: {submissionId,time,passed} | null,
          checkpoints: [{checkpointId,number,name,submissionId,time,passed}, ...]
        }, ...
      ]
    """
    uid = int(getattr(current_user, "Id", 0) or 0)
    if uid <= 0:
        return jsonify([])

    # Projects where this student has ANY submissions (main or checkpoint)
    proj_ids = [
        int(r[0])
        for r in (
            db.session.query(Submissions.Project)
            .filter(Submissions.User == uid)
            .distinct()
            .all()
        )
        if r and r[0] is not None
    ]
    if not proj_ids:
        return jsonify([])

    projects = (
        Projects.query
        .outerjoin(Modules, Projects.ModuleId == Modules.Id)
        .filter(Projects.Id.in_(proj_ids))
        .order_by(Modules.Start.asc(), Projects.Id.asc())
        .all()
    )

    class_ids = {int(getattr(p, "ClassId", 0) or 0) for p in (projects or [])}
    class_ids.discard(0)
    class_name_by_id = {}
    if class_ids:
        for c in Classes.query.filter(Classes.Id.in_(list(class_ids))).all():
            class_name_by_id[int(getattr(c, "Id", 0) or 0)] = str(getattr(c, "Name", "") or "")

    def iso(val):
        if val is None:
            return ""
        try:
            return val.isoformat()
        except Exception:
            return str(val)

    # Most recent MAIN submission per project
    main_by_project = {}
    main_rows = (
        Submissions.query
        .filter(
            Submissions.User == uid,
            Submissions.Project.in_(proj_ids),
            Submissions.IsCheckpoint == False,
        )
        .order_by(Submissions.Project.asc(), Submissions.Time.desc())
        .all()
    )
    for s in (main_rows or []):
        pid = int(getattr(s, "Project", 0) or 0)
        if pid and pid not in main_by_project:
            main_by_project[pid] = s

    # Most recent PRACTICE submission per (project, checkpoint_id)
    latest_checkpoint = {}
    pp_ids = set()
    checkpoint_rows = (
        Submissions.query
        .filter(
            Submissions.User == uid,
            Submissions.Project.in_(proj_ids),
            Submissions.IsCheckpoint == True,
        )
        .filter(Submissions.CheckpointId.isnot(None))
        .order_by(Submissions.Project.asc(), Submissions.CheckpointId.asc(), Submissions.Time.desc())
        .all()
    )
    for s in (checkpoint_rows or []):
        pid = int(getattr(s, "Project", 0) or 0)
        ppid = getattr(s, "CheckpointId", None)
        if not pid or ppid is None:
            continue
        ppid_int = int(ppid)
        key = (pid, ppid_int)
        if key not in latest_checkpoint:
            latest_checkpoint[key] = s
            pp_ids.add(ppid_int)

    pp_map = {}
    if pp_ids:
        for pp in Checkpoints.query.filter(Checkpoints.Id.in_(list(pp_ids))).all():
            pp_map[int(getattr(pp, "Id", 0) or 0)] = pp

    checkpoint_number_by_project_and_id = {}
    for pid in proj_ids:
        try:
            rows = (
                Checkpoints.query
                .filter(
                    Checkpoints.ProjectId == int(pid),
                    Checkpoints.Enabled == True,
                )
                .order_by(Checkpoints.CheckpointNumber.asc(), Checkpoints.Id.asc())
                .all()
            )
            checkpoint_number_by_project_and_id[int(pid)] = {
                int(getattr(row, "Id", 0) or 0): index
                for index, row in enumerate(rows or [], start=1)
            }
        except Exception:
            checkpoint_number_by_project_and_id[int(pid)] = {}

    checkpoints_by_project = defaultdict(list)
    for (pid, ppid), s in latest_checkpoint.items():
        pp = pp_map.get(ppid)
        number = int(checkpoint_number_by_project_and_id.get(pid, {}).get(ppid, 0) or 0)
        name = str(getattr(pp, "Name", "") or "") if pp else ""
        if not name:
            name = f"Checkpoint {number}" if number else "Checkpoint"
        checkpoints_by_project[pid].append({
            "checkpointId": int(ppid),
            "number": int(number),
            "name": name,
            "submissionId": int(getattr(s, "Id", 0) or 0),
            "time": iso(getattr(s, "Time", "")),
            "passed": bool(getattr(s, "IsPassing", False)),
        })
    for pid in checkpoints_by_project:
        checkpoints_by_project[pid].sort(
            key=lambda x: (int(x.get("number", 0) or 0), int(x.get("checkpointId", 0) or 0))
        )

    out = []
    for p in (projects or []):
        pid = int(getattr(p, "Id", 0) or 0)
        cid = int(getattr(p, "ClassId", 0) or 0)
        main_s = main_by_project.get(pid)
        out.append({
            "projectId": pid,
            "projectName": str(getattr(p, "Name", "") or ""),
            "classId": str(cid),
            "className": class_name_by_id.get(cid, ""),
            "start": iso(project_start(p)),
            "end": iso(project_end(p)),
            "main": None if not main_s else {
                "submissionId": int(getattr(main_s, "Id", 0) or 0),
                "time": iso(getattr(main_s, "Time", "")),
                "passed": bool(getattr(main_s, "IsPassing", False)),
            },
            "checkpoints": checkpoints_by_project.get(pid, []),
        })

    return jsonify(out)

@projects_api.route('/create_project', methods=['POST'])
@jwt_required()
@inject
def create_project(project_repo: ProjectRepository = Provide[Container.project_repo]):

    def ts_str() -> str:
        return datetime.now().strftime("%Y%m%d_%H%M%S")

    def safe_name(s: str) -> str:
        # normalize and remove unsafe chars; also collapse spaces
        return secure_filename(s or "").replace(" ", "_")

    if not is_staff_user():
        return access_denied_response()

    # Validate solution files (multi-file)
    solution_uploads = request.files.getlist('solutionFiles')
    solution_uploads = [f for f in solution_uploads if f and f.filename]
    if not solution_uploads:
        return make_response({'message': 'No selected solution files'}, HTTPStatus.BAD_REQUEST)
    if 'assignmentdesc' not in request.files or not request.files['assignmentdesc'].filename:
        return make_response({'message': 'No assignment description file'}, HTTPStatus.BAD_REQUEST)

    # Read form
    name = request.form.get('name', '')
    language = request.form.get('language', '')
    class_id = request.form.get('class_id', '')
    if not user_can_access_class_id(parse_int(class_id, 0)):
        return access_denied_response(HTTPStatus.FORBIDDEN)
    checkpoint_enabled = True
    module_id = request.form.get('module_id', '').strip()

    if name == '' or language == '':
        return make_response("Error in form", HTTPStatus.BAD_REQUEST)

    base_proj = safe_name(name)
    ts = ts_str()
    proj_dir_path = project_dir(base_proj, ts)
    os.makedirs(proj_dir_path, exist_ok=True)

    # Save solution + description + additional into a timestamped version directory
    path = version_dir(proj_dir_path, ts)
    os.makedirs(path, exist_ok=True)
    for up in solution_uploads:
        orig = safe_name(up.filename)
        ext = os.path.splitext(orig)[1].lower()
        if ext not in ALLOWED_SOURCE_EXTS:
            return make_response({'message': f'Unsupported file type: {ext}'}, HTTPStatus.BAD_REQUEST)
        dst = os.path.join(path, orig)
        up.save(dst)

    ad = request.files['assignmentdesc']
    ad_name = safe_name(ad.filename or "assignment.pdf")
    assignmentdesc_path = os.path.join(path, ad_name)
    ad.save(assignmentdesc_path)

    # Multiple additional files: save into version folder, but store only basenames in DB (short)
    add_names = []
    for add_up in request.files.getlist('additionalFiles'):
        if add_up and add_up.filename:
            orig_name = safe_name(add_up.filename)
            dst = os.path.join(path, orig_name)
            add_up.save(dst)
            add_names.append(orig_name)

    selected_path = path
    new_project_id = project_repo.create_project(
        name,
        language,
        class_id,
        selected_path,
        assignmentdesc_path,
        json.dumps(add_names),
        checkpoint_enabled,
        int(module_id) if module_id.isdigit() else None
    )

    try:
        new_project_id_int = int(new_project_id)
    except Exception:
        new_project_id_int = 0

    # Automatically create the first checkpoint for every newly-created project.
    # The admin detail page will show this alongside the main project.
    ensure_default_checkpoint_for_project(
        project_repo,
        new_project_id_int,
        context="create_project",
    )

    return make_response(str(new_project_id), HTTPStatus.OK)

@projects_api.route('/edit_project', methods=['POST'])
@jwt_required()
@inject
def edit_project(project_repo: ProjectRepository = Provide[Container.project_repo]):

    def ts_str() -> str:
        return datetime.now().strftime("%Y%m%d_%H%M%S")

    def safe_name(s: str) -> str:
        return secure_filename(s or "").replace(" ", "_")

    if not is_staff_user():
        return access_denied_response()

    pid_str = request.form.get("id", "").strip()
    if not pid_str.isdigit():
        return make_response({'message': 'Invalid or missing project id'}, HTTPStatus.BAD_REQUEST)
    pid = int(pid_str)
    if not user_can_access_project_id(pid):
        return access_denied_response(HTTPStatus.FORBIDDEN)

    name = request.form.get('name', '')
    language = request.form.get('language', '')
    checkpoint_enabled = True
    module_id = request.form.get('module_id', '').strip()

    if name == '' or language == '':
        return make_response("Error in form", HTTPStatus.BAD_REQUEST)

    # Ensure base_proj exists before any use (fix NameError) and compute project folder
    base_proj = safe_name(name)
    ts = ts_str()
    existing_path = project_repo.get_project_path(pid)
    if existing_path:
        # In the new layout, existing_path is a version directory:
        # teacher-files/<proj_ts>__<base_proj>/<version_ts>
        proj_dir = os.path.dirname(existing_path)
        # Derive base_proj from folder name if not set: "<timestamp>__<base_proj>"
        if not base_proj:
            folder = os.path.basename(proj_dir)
            if "__" in folder:
                base_proj = folder.split("__", 1)[1]
            else:
                base_proj = safe_name(name)
    else:
        proj_dir = project_dir(base_proj, ts)
    os.makedirs(proj_dir, exist_ok=True)

    # Default to existing paths if no new files are uploaded
    path = existing_path
    assignmentdesc_path = project_repo.get_project_desc_path(pid)
    existing_proj = project_repo.get_selected_project(pid)
    add_path = getattr(existing_proj, "AdditionalFilePath", "") if existing_proj else ""

    # Determine whether we need to mint a new version directory
    solution_uploads = request.files.getlist('solutionFiles')
    solution_uploads = [f for f in solution_uploads if f and f.filename]
    solution_changed = False
    ad = request.files.get('assignmentdesc')
    desc_changed = bool(ad and ad.filename)
    remove_add = request.form.get('removeAdditionalFiles', '').strip()
    clear_add = (request.form.get('clearAdditionalFiles', '').strip().lower() == 'true')
    new_add_uploads = [f for f in request.files.getlist('additionalFiles') if f and f.filename]
    try:
        to_remove = json.loads(remove_add) if remove_add else []
    except Exception:
        to_remove = []
    additional_ops = bool(clear_add or to_remove or new_add_uploads)
    needs_new_version = bool(solution_uploads or desc_changed or additional_ops)

    # Seed a new version folder so history is preserved and teacher layout is consistent
    current_version_dir = existing_path if (existing_path and os.path.isdir(existing_path) and is_ts_dir(os.path.basename(existing_path))) else None
    if needs_new_version:
        new_version = version_dir(proj_dir, ts)
        # Seed from current version directory when available; otherwise seed from legacy paths
        try:
            seed_add_paths = []
            existing_add = getattr(existing_proj, "AdditionalFilePath", "") if existing_proj else ""
            existing_list = json.loads(existing_add) if (existing_add or "").startswith('[') else ([existing_add] if existing_add else [])
            # existing_list may be basenames or absolute paths. Resolve for seeding when not using seed_from_dir.
            legacy_base = None
            if existing_path:
                legacy_base = existing_path if os.path.isdir(existing_path) else os.path.dirname(existing_path)
            legacy_base = legacy_base or proj_dir
            for p in (existing_list or []):
                if not p:
                    continue
                if os.path.isabs(p):
                    seed_add_paths.append(p)
                else:
                    seed_add_paths.append(os.path.join(legacy_base, os.path.basename(p)))
        except Exception:
            seed_add_paths = []
        seed_version_dir(
            new_version,
            seed_from_dir=current_version_dir,
            seed_solution_path=existing_path,
            seed_desc_path=assignmentdesc_path,
            seed_add_paths=seed_add_paths,
        )
        path = new_version
        # After seeding, rewrite assignmentdesc_path into this version folder if it existed
        if assignmentdesc_path:
            bn = os.path.basename(assignmentdesc_path)
            cand = os.path.join(path, bn)
            if os.path.exists(cand):
                assignmentdesc_path = cand

    # If new solution file(s) were uploaded, replace solution sources inside the current version folder
    if solution_uploads:
        # Remove old source files only in this (new) version directory
        try:
            for fn in os.listdir(path):
                full = os.path.join(path, fn)
                if os.path.isfile(full) and os.path.splitext(fn)[1].lower() in ALLOWED_SOURCE_EXTS:
                    os.remove(full)
        except Exception:
            pass
        for up in solution_uploads:
            orig = safe_name(up.filename)
            ext = os.path.splitext(orig)[1].lower()
            if ext not in ALLOWED_SOURCE_EXTS:
                return make_response({'message': f'Unsupported file type: {ext}'}, HTTPStatus.BAD_REQUEST)
            dst = os.path.join(path, orig)
            up.save(dst)
        solution_changed = True

    # If a new assignment description was uploaded, save into the version folder
    ad = request.files.get('assignmentdesc')
    if ad and ad.filename:
        ad_name = safe_name(ad.filename or "assignment.pdf")
        assignmentdesc_path = os.path.join(path, ad_name)
        ad.save(assignmentdesc_path)

    # Multiple additional files: store only basenames in DB; operate on files inside `path`.
    existing_add = getattr(existing_proj, "AdditionalFilePath", "") if existing_proj else ""
    try:
        add_names = json.loads(existing_add) if (existing_add or "").startswith('[') else ([existing_add] if existing_add else [])
    except Exception:
        add_names = []
    add_names = [os.path.basename(p) for p in (add_names or []) if p]
    # If we minted a new version dir, keep only names that exist in the new folder.
    if needs_new_version:
        add_names = [n for n in add_names if os.path.exists(os.path.join(path, n))]
    additional_file_changed = False
    # Remove selected files (match by basename)
    if to_remove:
        keep = []
        for n in add_names:
            if n in to_remove:
                try:
                    os.remove(os.path.join(path, n))
                except Exception:
                    pass
                additional_file_changed = True
            else:
                keep.append(n)
        add_names = keep
    # Clear all
    if clear_add and add_names:
        for n in add_names:
            try:
                os.remove(os.path.join(path, n))
            except Exception:
                pass
        add_paths = []
        additional_file_changed = True
    # Append newly uploaded additional files
    for add_up in new_add_uploads:
        if add_up and add_up.filename:
            orig_name = safe_name(add_up.filename)
            dst = os.path.join(path, orig_name)
            add_up.save(dst)
            add_names.append(orig_name)
            additional_file_changed = True

    # Always point the project at the newest version directory when available
    latest_version = pick_latest_version_dir(proj_dir)
    if latest_version:
        path = latest_version

    project_repo.edit_project(
        name, language, pid,
        path, assignmentdesc_path, json.dumps(add_names), checkpoint_enabled
    )

    # Recompute testcase outputs **against the path we just wrote**, so we don't depend on
    # any cached ORM objects or delayed reads.
    try:
        # Recompute if either the solution OR the additional file changed.
        # If only the additional file changed, let recompute pick up the project's saved solution.
        if solution_changed or additional_file_changed:
            recompute_expected_outputs(
                project_repo,
                int(pid),
                solution_override_path=(path if solution_changed else None),
                language_override=language,
            )
    except Exception as e:
        # Don't block the edit on recompute failures, but surface why outputs didn't refresh.
        import traceback
        print(f"[edit_project] recompute_expected_outputs failed: {e}", flush=True)
        traceback.print_exc()

    return make_response("Project Edited", HTTPStatus.OK)

def has_allowed_ext(path: str) -> bool:
    return os.path.splitext(path)[1].lower() in ALLOWED_SOURCE_EXTS

def run_solution_for_input(solution_root: str, language: str, input_text: str, project_id: int, class_id: int, additional_file_path: str = "") -> str:
    """
    Execute code strictly via /tabot-files/grading-scripts/grade.py (ADMIN path).
    Returns stdout (or stderr) with normalized newlines, or "" on failure.
    """
    if not solution_root or not os.path.exists(solution_root):
        return ""
    script = "/tabot-files/grading-scripts/grade.py"

    # Expand DB-stored additional file names to absolute paths under solution_root.
    add_arg = additional_file_path or ""
    try:
        base_dir = solution_root if os.path.isdir(solution_root) else os.path.dirname(solution_root)
        raw = add_arg.strip() if isinstance(add_arg, str) else ""
        if raw.startswith("[") or raw.startswith("{"):
            lst = json.loads(raw)
        else:
            lst = [raw] if raw else []
        abs_list = []
        for p in (lst or []):
            if not p:
                continue
            if os.path.isabs(p):
                abs_list.append(p)
            else:
                abs_list.append(os.path.join(base_dir, os.path.basename(p)))
        add_arg = json.dumps(abs_list)
    except Exception:
        add_arg = additional_file_path or ""

    args = [
        "python", script,
        "ADMIN",              # student_name triggers admin path
        normalize_grader_language(language, solution_root), # language as grade.py expects
        input_text or "",     # goes to admin_run(user_input)
        solution_root,        # file or directory
        add_arg,
        str(project_id or 0),
        str(class_id or 0),
    ]
    try:
        proc = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, cwd=os.path.dirname(solution_root) if os.path.isfile(solution_root) else solution_root)
    except Exception:
        return ""
    out = (proc.stdout or "").strip()
    err = (proc.stderr or "").strip()
    return (out or err)

def load_tabot_module():
    """
    Try to import tabot as a normal module first.
    If that fails, load it from /ta-bot/grading-scripts and make sure
    its directory is on sys.path so sibling imports (output, tests)
    resolve correctly.
    """
    try:
        import tabot as _t
        return _t
    except Exception:
        pass

    grading_dir = "/tabot-files/grading-scripts"
    grading_path = os.path.join(grading_dir, "grade.py")

    spec = importlib.util.spec_from_file_location("tabot-files", grading_path)
    if not spec or not spec.loader:
        raise ImportError(f"Cannot load spec for {grading_path}")

    # Ensure sibling imports like `from output import *` work
    sys.path.insert(0, grading_dir)
    try:
        mod = importlib.util.module_from_spec(spec)
        sys.modules["tabot"] = mod  # let subimports see the module name
        # Optional but helps some relative-import edge cases:
        mod.__package__ = None
        spec.loader.exec_module(mod)
        return mod
    finally:
        # Avoid permanently polluting sys.path
        try:
            sys.path.remove(grading_dir)
        except ValueError:
            pass

try:
    TABOT = load_tabot_module()
except Exception as e:
    TABOT = None
    print(f"[projects] Warning: tabot import failed (will use subprocess path): {e}", flush=True)

def recompute_expected_outputs(project_repo, project_id, *, solution_override_path: str = None, language_override: str = None, checkpoint_id: int | None = None):

    """
    For each testcase, run the (updated) solution and persist the new output.
    """

    # Always fetch the project once (needed for class id, fallback language, etc.)
    try:
        proj_obj = project_repo.get_selected_project(int(project_id))
    except Exception:
        proj_obj = None

    if solution_override_path and os.path.exists(solution_override_path):
        solution_root = solution_override_path
        lang = (language_override or (getattr(proj_obj, "Language", "") if proj_obj else "")).strip()
    else:
        if not proj_obj or not getattr(proj_obj, "solutionpath", None):
            return
        solution_root = getattr(proj_obj, "solutionpath", "")
        lang = getattr(proj_obj, "Language", "")

    cases = project_repo.get_testcases(int(project_id), checkpoint_id=checkpoint_id)

    # Determine class id (needed by repo call)
    class_id = getattr(proj_obj, "ClassId", 0) if proj_obj else 0
    if not class_id:
        try:
            cname = project_repo.get_className_by_projectId(str(project_id))
            class_id = project_repo.get_class_id_by_name(cname)
        except Exception:
            class_id = 0

    for tc_id, vals in cases.items():
        if checkpoint_id:
            pp = project_repo.get_checkpoint(int(checkpoint_id))
            add_path = getattr(pp, "AdditionalFilePath", "") if pp else ""
        else:
            add_path = getattr(proj_obj, "AdditionalFilePath", "") if proj_obj else ""
        try:
            name = vals[1] if len(vals) > 1 else ""
            desc = vals[2] if len(vals) > 2 else ""
            inp = vals[3] if len(vals) > 3 else ""
        except Exception:
            name, desc, inp = "", "", "", False

        new_out = run_solution_for_input(solution_root, lang, inp, project_id, class_id, add_path)
        try:
            project_repo.add_or_update_testcase(
                int(project_id),
                int(tc_id),
                name or "",
                desc or "",
                inp or "",
                new_out,
                int(class_id),
                checkpoint_id=checkpoint_id,
            )
        except Exception:
            # continue on individual failures
            continue

@projects_api.route('/list_source_files', methods=['GET'])
@jwt_required()
@inject
def list_source_files(project_repo: ProjectRepository = Provide[Container.project_repo]):
    """Return list of previewable source files for a project (relative paths if a directory)."""
    if not is_staff_user():
        return access_denied_response()

    pid = parse_int(request.args.get("project_id", ""), 0)
    if pid <= 0:
        return make_response({'message': 'Missing project_id'}, HTTPStatus.BAD_REQUEST)
    if not user_can_access_project_id(pid):
        return access_denied_response(HTTPStatus.FORBIDDEN)

    ppid = opt_int(request.args.get("checkpoint_id", ""))
    root = project_repo.get_project_path(int(pid), checkpoint_id=ppid)

    if not root or not os.path.exists(root):
        return jsonify({'files': []})

    files = []
    if os.path.isdir(root):
        for base, _, fnames in os.walk(root):
            for fname in fnames:
                full = os.path.join(base, fname)
                if has_allowed_ext(full):
                    rel = os.path.relpath(full, root).replace("\\", "/")
                    files.append({'relpath': rel, 'bytes': os.path.getsize(full)})
    else:
        if has_allowed_ext(root):
            files.append({'relpath': os.path.basename(root), 'bytes': os.path.getsize(root)})

    return jsonify({'files': files})


@projects_api.route('/get_source_file', methods=['GET'])
@jwt_required()
@inject
def get_source_file(project_repo: ProjectRepository = Provide[Container.project_repo]):
    """Return the text content of a source file for preview."""
    if not is_staff_user():
        return access_denied_response()

    pid = parse_int(request.args.get("project_id", ""), 0)
    relpath = request.args.get('relpath', '')
    if pid <= 0:
        return make_response({'message': 'Missing project_id'}, HTTPStatus.BAD_REQUEST)
    if not user_can_access_project_id(pid):
        return access_denied_response(HTTPStatus.FORBIDDEN)

    ppid_raw = (request.args.get('checkpoint_id', '') or '').strip()
    ppid = int(ppid_raw) if ppid_raw.isdigit() else None
    root = project_repo.get_project_path(int(pid), checkpoint_id=ppid)

    if not root or not os.path.exists(root):
        return make_response({'message': 'Project path not found'}, HTTPStatus.NOT_FOUND)

    # Resolve full path safely using os.path only
    if os.path.isdir(root):
        candidate = os.path.normpath(os.path.join(root, relpath))
        root_abs = os.path.abspath(root)
        cand_abs = os.path.abspath(candidate)
        if not (cand_abs == root_abs or cand_abs.startswith(root_abs + os.sep)):
            return make_response({'message': 'Invalid path'}, HTTPStatus.BAD_REQUEST)
        full = cand_abs
    else:
        # Single-file project: only that file is allowed
        if relpath and relpath != os.path.basename(root):
            return make_response({'message': 'Invalid path for single-file project'}, HTTPStatus.BAD_REQUEST)
        full = root

    if not os.path.exists(full):
        return make_response({'message': 'File not found'}, HTTPStatus.NOT_FOUND)
    if not has_allowed_ext(full):
        return make_response({'message': 'Unsupported file type'}, HTTPStatus.BAD_REQUEST)

    # Limit preview size to 2 MB
    if os.path.getsize(full) > 2 * 1024 * 1024:
        return make_response({'message': 'File too large to preview'}, HTTPStatus.BAD_REQUEST)

    with open(full, 'r', encoding='utf-8', errors='replace') as f:
        text = f.read()

    resp = make_response(text, HTTPStatus.OK)
    resp.headers['Content-Type'] = 'text/plain; charset=utf-8'
    resp.headers['Cache-Control'] = 'no-store'
    return resp

@projects_api.route('/get_project_id', methods=['GET'])
@jwt_required()
@inject
def get_project(project_repo: ProjectRepository = Provide[Container.project_repo]):
    if not is_staff_user():
        return access_denied_response()

    pid_raw = (request.args.get('id') or '').strip()
    if not pid_raw.isdigit():
        return make_response(json.dumps({}), HTTPStatus.OK)
    pid = int(pid_raw)
    if not user_can_access_project_id(pid):
        return access_denied_response(HTTPStatus.FORBIDDEN)
    ppid = opt_int(request.args.get("checkpoint_id", ""))
    project_info = project_repo.get_project(pid, checkpoint_id=ppid)

    return make_response(json.dumps(project_info), HTTPStatus.OK)
    
@projects_api.route('/get_testcases', methods=['GET'])
@jwt_required()
@inject
def get_testcases(project_repo: ProjectRepository = Provide[Container.project_repo]):
    if not is_staff_user():
        return access_denied_response()

    project_id = parse_int(request.args.get("id", ""), 0)
    if not user_can_access_project_id(project_id):
        return access_denied_response(HTTPStatus.FORBIDDEN)
    ppid = opt_int(request.args.get("checkpoint_id", ""))
    testcases = project_repo.get_testcases(int(project_id), checkpoint_id=ppid)
 
    return make_response(json.dumps(testcases), HTTPStatus.OK)


@projects_api.route('/count_testcases', methods=['GET'])
@jwt_required()
@inject
def count_testcases(project_repo: ProjectRepository = Provide[Container.project_repo]):
    if not is_staff_user():
        return access_denied_response()

    project_id = parse_int(request.args.get("id", ""), 0)
    if not user_can_access_project_id(project_id):
        return access_denied_response(HTTPStatus.FORBIDDEN)

    ppid = opt_int(request.args.get("checkpoint_id", ""))
    count = project_repo.count_testcases(int(project_id), checkpoint_id=ppid)
    return jsonify({"count": int(count)})


@projects_api.route('/json_add_testcases', methods=['POST'])
@jwt_required()
@inject   
def json_add_testcases(project_repo: ProjectRepository = Provide[Container.project_repo]):
    if not is_staff_user():
        return access_denied_response()

    file = request.files['file']
    project_id = request.form["project_id"]
    if not user_can_access_project_id(parse_int(project_id, 0)):
        return access_denied_response(HTTPStatus.FORBIDDEN)
    ppid = opt_int(request.form.get("checkpoint_id", ""))

    # Require a solution root for whichever scope we're writing testcases into (main or checkpoint)
    sol = project_repo.get_project_path(int(project_id), checkpoint_id=ppid)
    if not sol:
        msg = 'Checkpoint has no solution files' if ppid else 'Assignment has no solution files'
        return make_response({'message': msg}, HTTPStatus.BAD_REQUEST)

    try:
        proj = project_repo.get_selected_project(int(project_id))
        class_id = int(getattr(proj, "ClassId", 0) or 0)
    except Exception:
        class_id = 0

    try:
        json_obj = json.load(file)
    except json.JSONDecodeError:
         message = {
            'message': 'Incorrect JSON format'
        }
         return make_response(message, HTTPStatus.INTERNAL_SERVER_ERROR)
    else:
        for testcase in json_obj:
            project_repo.add_or_update_testcase(
                int(project_id),
                -1,
                testcase["name"],
                testcase["description"],
                testcase["input"],
                testcase["output"],
                class_id,
                bool(testcase.get("hidden", False)),
                checkpoint_id=ppid,
            )

    return make_response("Testcase Added", HTTPStatus.OK)

@projects_api.route('/add_or_update_testcase', methods=['POST'])
@jwt_required()
@inject   
def add_or_update_testcase(project_repo: ProjectRepository = Provide[Container.project_repo]):
    if not is_staff_user():
        return access_denied_response()

    # Grab all fields safely (defaults prevent NameError)
    id_val = request.form.get('id', '').strip()
    name = request.form.get('name', '').strip()
    input_data = request.form.get('input', '')
    output = request.form.get('output', '')
    project_id = request.form.get('project_id', '').strip()
    description = request.form.get('description', '').strip()
    class_id = request.form.get('class_id', '').strip()

    ppid_raw = request.form.get('checkpoint_id', '').strip()
    
    if id_val == '' or name == '' or input_data == '' or project_id == '' or description == '' or class_id == '':
        return make_response("Error in form", HTTPStatus.BAD_REQUEST)    

    # Coerce types with validation
    try:
        project_id = int(project_id)
        id_val = int(id_val)
        class_id_int = int(class_id)
    except ValueError:
        return make_response("Invalid numeric id", HTTPStatus.BAD_REQUEST)

    hidden = parse_bool(request.form.get("hidden", ""))
    checkpoint_id = int(ppid_raw) if (ppid_raw or "").isdigit() else None
    if not user_can_access_project_id(project_id):
        return access_denied_response(HTTPStatus.FORBIDDEN)
    if not user_can_access_class_id(class_id_int):
        return access_denied_response(HTTPStatus.FORBIDDEN)

    # Do not allow testcase edits/creates unless solution files exist (main or checkpoint)
    sol = project_repo.get_project_path(int(project_id), checkpoint_id=checkpoint_id)
    if not sol:
        return make_response(
            "Checkpoint has no solution files" if checkpoint_id else "Assignment has no solution files",
            HTTPStatus.BAD_REQUEST
        )

    # Auto-recompute expected output when editing a testcase.
    # If the project's language is Python, run the saved solution with the new input
    # and overwrite the provided `output` with the program's stdout.
    try:
        project = project_repo.get_selected_project(int(project_id))
        language = (getattr(project, "Language", "") or "")
        # If this testcase is PRACTICE, use checkpoint solution/desc/additional
        if checkpoint_id:
            solution_root = project_repo.get_project_path(int(project_id), checkpoint_id=checkpoint_id)
            pp = project_repo.get_checkpoint(int(checkpoint_id))
            add_path = getattr(pp, "AdditionalFilePath", "") if pp else ""
        else:
            solution_root = (getattr(project, "solutionpath", "") or "")
            add_path = getattr(project, "AdditionalFilePath", "") if project else ""
        output = run_solution_for_input(solution_root, language, input_data, int(project_id), int(class_id_int), add_path)

    except Exception:
        # Fall back to the submitted output if recomputation fails
        pass

    project_repo.add_or_update_testcase(
        project_id,
        id_val,
        name,
        description,
        input_data,
        output,
        class_id_int,
        hidden,
        checkpoint_id=checkpoint_id,
    )

    return make_response("Testcase Added", HTTPStatus.OK)

@projects_api.route('/remove_testcase', methods=['POST'])
@jwt_required()
@inject
def remove_testcase(project_repo: ProjectRepository = Provide[Container.project_repo]):
    if not is_staff_user():
        return access_denied_response()

    if 'id' in request.form:
        id_val = request.form['id']
    else:
        return make_response({'message': 'Missing testcase id'}, HTTPStatus.BAD_REQUEST)
    testcase = project_repo.get_testcase(parse_int(id_val, 0)) if hasattr(project_repo, 'get_testcase') else None
    if testcase is not None and not user_can_access_project_id(int(getattr(testcase, 'ProjectId', 0) or 0)):
        return access_denied_response(HTTPStatus.FORBIDDEN)
    project_repo.remove_testcase(id_val)
    return make_response("Testcase Removed", HTTPStatus.OK)

@projects_api.route('/get_modules_by_class_id', methods=['GET'])
@jwt_required()
@inject
def get_modules_by_class_id(project_repo: ProjectRepository = Provide[Container.project_repo], submission_repo: SubmissionRepository = Provide[Container.submission_repo]):
    if not is_staff_user():
        return access_denied_response()

    class_id = request.args.get('id')
    if not user_can_access_class_id(parse_int(class_id, 0)):
        return access_denied_response(HTTPStatus.FORBIDDEN)
    modules = project_repo.get_modules_by_class_id(class_id)
    module_projects = [project_repo.get_main_project_for_module(int(module.Id)) for module in modules]
    project_ids = [int(project.Id) for project in module_projects if project is not None]
    total_submission_counts = submission_repo.get_total_submission_for_all_projects()
    checkpoint_total_counts = checkpoint_unique_user_counts(project_ids)
    main_completed_ids = main_completed_project_ids(project_ids)

    return jsonify([
        module_payload(
            module,
            project_repo,
            submission_repo,
            total_submission_counts=total_submission_counts,
            checkpoint_total_counts=checkpoint_total_counts,
            main_completed_project_ids=main_completed_ids,
        )
        for module in modules
    ])

@projects_api.route('/create_module', methods=['POST'])
@jwt_required()
@inject
def create_module(project_repo: ProjectRepository = Provide[Container.project_repo]):
    if not is_staff_user():
        return access_denied_response()

    data = request.get_json(silent=True) or {}
    name = str(data.get('name', '')).strip()
    class_id = str(data.get('class_id', '')).strip()
    start_date = str(data.get('start_date', '')).strip()
    end_date = str(data.get('end_date', '')).strip()

    if not name or not class_id or not start_date or not end_date:
        return make_response({'message': 'Missing required fields'}, HTTPStatus.BAD_REQUEST)
    if not user_can_access_class_id(parse_int(class_id, 0)):
        return access_denied_response(HTTPStatus.FORBIDDEN)

    try:
        module_id = project_repo.create_module(
            int(class_id),
            name,
            datetime.fromisoformat(start_date),
            datetime.fromisoformat(end_date),
        )
    except Exception as exc:
        return make_response({'message': f'Could not create module: {exc}'}, HTTPStatus.BAD_REQUEST)

    default_checkpoint_id = ensure_default_checkpoint_for_module(
        project_repo,
        int(module_id),
        context="create_module",
    )

    return jsonify({
        'module_id': int(module_id),
        'checkpoint_id': int(default_checkpoint_id) if default_checkpoint_id else None,
    })

@projects_api.route('/get_modules_by_class_id_student', methods=['GET'])
@jwt_required()
@inject
def get_modules_by_class_id_student(project_repo: ProjectRepository = Provide[Container.project_repo], submission_repo: SubmissionRepository = Provide[Container.submission_repo]):
    class_id = request.args.get('id')

    if not class_id:
        return jsonify([])

    modules = project_repo.get_modules_by_class_id(class_id)
    module_projects = [project_repo.get_main_project_for_module(int(module.Id)) for module in modules]
    project_ids = [int(project.Id) for project in module_projects if project is not None]
    total_submission_counts = submission_repo.get_total_submission_for_all_projects()
    checkpoint_total_counts = checkpoint_unique_user_counts(project_ids)
    main_completed_ids = main_completed_project_ids(project_ids)

    return jsonify([
        module_payload(
            module,
            project_repo,
            submission_repo,
            total_submission_counts=total_submission_counts,
            checkpoint_total_counts=checkpoint_total_counts,
            main_completed_project_ids=main_completed_ids,
        )
        for module in modules
    ])

@projects_api.route('/get_module_overview_student', methods=['GET'])
@jwt_required()
@inject
def get_module_overview_student(project_repo: ProjectRepository = Provide[Container.project_repo], submission_repo: SubmissionRepository = Provide[Container.submission_repo]):
    module_id = parse_int(request.args.get('module_id', 0), 0)
    if module_id <= 0:
        return make_response({'message': 'Module not found'}, HTTPStatus.NOT_FOUND)

    module = project_repo.get_module(module_id)
    if not module:
        return make_response({'message': 'Module not found'}, HTTPStatus.NOT_FOUND)

    project = project_repo.get_main_project_for_module(int(module.Id))
    checkpoint_rows = student_checkpoint_rows(project_repo, int(project.Id)) if project else []

    return jsonify({
        "module": module_payload(module, project_repo, submission_repo),
        "checkpoints": checkpoint_rows,
        "practiceProblems": checkpoint_rows,
    })

@projects_api.route('/update_module', methods=['POST'])
@jwt_required()
@inject
def update_module(project_repo: ProjectRepository = Provide[Container.project_repo]):
    if not is_staff_user():
        return access_denied_response()

    data = request.get_json(silent=True) or {}
    module_id = int(str(data.get('module_id', 0)) or 0)
    name = str(data.get('name', '')).strip()
    start_date = str(data.get('start_date', '')).strip()
    end_date = str(data.get('end_date', '')).strip()

    if module_id <= 0 or not name or not start_date or not end_date:
        return make_response({'message': 'Missing required fields'}, HTTPStatus.BAD_REQUEST)
    if not user_can_access_module_id(module_id):
        return access_denied_response(HTTPStatus.FORBIDDEN)

    module = project_repo.update_module(
        module_id,
        name,
        datetime.fromisoformat(start_date),
        datetime.fromisoformat(end_date),
    )

    if not module:
        return make_response({'message': 'Module not found'}, HTTPStatus.NOT_FOUND)

    return jsonify({'message': 'Module updated'})

@projects_api.route('/get_module_overview', methods=['GET'])
@jwt_required()
@inject
def get_module_overview(project_repo: ProjectRepository = Provide[Container.project_repo], submission_repo: SubmissionRepository = Provide[Container.submission_repo]):
    if not is_staff_user():
        return access_denied_response()

    module_id = int(str(request.args.get('module_id', 0)) or 0)
    project_id = int(str(request.args.get('project_id', 0)) or 0)
    if module_id > 0 and not user_can_access_module_id(module_id):
        return access_denied_response(HTTPStatus.FORBIDDEN)
    if project_id > 0 and not user_can_access_project_id(project_id):
        return access_denied_response(HTTPStatus.FORBIDDEN)

    module = project_repo.get_module(module_id) if module_id > 0 else None
    if not module and project_id > 0:
        module = project_repo.get_module_by_project_id(project_id)

    if not module:
        return make_response({'message': 'Module not found'}, HTTPStatus.NOT_FOUND)

    project = project_repo.get_main_project_for_module(module.Id)
    if not project:
        return make_response({'message': 'Main project not found'}, HTTPStatus.NOT_FOUND)

    project_id = int(project.Id)
    ensure_default_checkpoint_for_project(
        project_repo,
        project_id,
        context="get_module_overview",
    )
    total_submission_counts = submission_repo.get_total_submission_for_all_projects()
    checkpoint_total_counts = checkpoint_unique_user_counts([project_id])
    main_completed_ids = main_completed_project_ids([project_id])

    checkpoint_rows = []
    try:
        problems = project_repo.list_checkpoints(project_id)
        submission_counts = checkpoint_submission_count_map(project_id)
        testcase_counts = project_repo.count_testcases_by_checkpoint(project_id)

        for idx, pp in enumerate(problems):
            pp_id = int(pp.Id)
            setup_status = project_setup_status(
                project_repo,
                project_id,
                checkpoint_id=pp_id,
                testcase_count=int(testcase_counts.get(pp_id, 0) or 0),
            )
            checkpoint_rows.append({
                "id": pp_id,
                "number": idx + 1,
                "name": str(getattr(pp, "Name", "") or f"Checkpoint {idx + 1}"),
                "enabled": bool(getattr(pp, "Enabled", True)),
                "submissions": int(submission_counts.get(pp_id, 0) or 0),
                "hasSolutionProgram": bool(setup_status["HasSolutionProgram"]),
                "hasTestcases": bool(setup_status["HasTestcases"]),
                "testcaseCount": int(setup_status["TestcaseCount"]),
            })
    except Exception:
        checkpoint_rows = []

    return jsonify({
        "module": module_payload(
            module,
            project_repo,
            submission_repo,
            total_submission_counts=total_submission_counts,
            checkpoint_total_counts=checkpoint_total_counts,
            main_completed_project_ids=main_completed_ids,
        ),
        "project": project_payload(
            project,
            submission_repo,
            project_repo,
            total_submission_counts=total_submission_counts,
            checkpoint_total_counts=checkpoint_total_counts,
        ),
        "checkpoints": checkpoint_rows,
    })

@projects_api.route('/update_project_name', methods=['POST'])
@jwt_required()
@inject
def update_project_name(project_repo: ProjectRepository = Provide[Container.project_repo]):
    if not is_staff_user():
        return access_denied_response()

    data = request.get_json(silent=True) or {}
    project_id = int(str(data.get('project_id', 0)) or 0)
    name = str(data.get('name', '')).strip()

    if project_id <= 0 or not name:
        return make_response({'message': 'Missing required fields'}, HTTPStatus.BAD_REQUEST)
    if not user_can_access_project_id(project_id):
        return access_denied_response(HTTPStatus.FORBIDDEN)

    project = project_repo.update_project_name(project_id, name)
    if not project:
        return make_response({'message': 'Project not found'}, HTTPStatus.NOT_FOUND)

    return jsonify({'message': 'Project name updated'})

@projects_api.route('/update_checkpoint_name', methods=['POST'])
@jwt_required()
@inject
def update_checkpoint_name(project_repo: ProjectRepository = Provide[Container.project_repo]):
    if not is_staff_user():
        return access_denied_response()

    data = request.get_json(silent=True) or {}
    checkpoint_id = int(str(data.get('checkpoint_id', 0)) or 0)
    name = str(data.get('name', '')).strip()

    if checkpoint_id <= 0 or not name:
        return make_response({'message': 'Missing required fields'}, HTTPStatus.BAD_REQUEST)
    if not user_can_access_checkpoint_id(checkpoint_id):
        return access_denied_response(HTTPStatus.FORBIDDEN)

    pp = project_repo.update_checkpoint_name(checkpoint_id, name)
    if not pp:
        return make_response({'message': 'Checkpoint not found'}, HTTPStatus.NOT_FOUND)

    return jsonify({'message': 'Checkpoint name updated'})


@projects_api.route('/get_projects_by_class_id', methods=['GET'])
@jwt_required()
@inject
def get_projects_by_class_id(project_repo: ProjectRepository = Provide[Container.project_repo], submission_repo: SubmissionRepository = Provide[Container.submission_repo]):
    if not is_staff_user():
        return access_denied_response()
    class_id = request.args.get('id')
    if not user_can_access_class_id(parse_int(class_id, 0)):
        return access_denied_response(HTTPStatus.FORBIDDEN)
    data = project_repo.get_projects_by_class_id(class_id)
    
    new_projects = []
    thisdic = submission_repo.get_total_submission_for_all_projects()
    for proj in data:

        checkpoint_total = count_checkpoint_unique_users(int(proj.Id))

        new_projects.append(json.dumps({
            "Id": proj.Id,
            "Name": proj.Name,
            "Start": project_start(proj).strftime("%x %X") if project_start(proj) else "",
            "End": project_end(proj).strftime("%x %X") if project_end(proj) else "",
            "TotalSubmissions": int(thisdic.get(proj.Id, 0) or 0),
            "CheckpointTotalSubmissions": int(checkpoint_total),
            "CheckpointsEnabled": True,
            "ModuleId": getattr(proj, "ModuleId", None),
        }))
    return jsonify(new_projects)

@projects_api.route('/checkpoint_submission_counts', methods=['GET'])
@jwt_required()
def checkpoint_submission_counts():
    """
    Returns checkpoint submission counts per checkpoint_id (and total) for a project.
    Response:
      { "total": <int>, "by_problem": { "<ppid>": <count>, ... } }
    """
    if not is_staff_user():
        return access_denied_response()

    pid = parse_int(request.args.get("project_id", ""), 0)
    if pid <= 0:
        return jsonify({'total': 0, 'by_problem': {}})
    pid = int(pid)
    if not user_can_access_project_id(pid):
        return access_denied_response(HTTPStatus.FORBIDDEN)

    if not hasattr(Submissions, "IsCheckpoint"):
        return jsonify({'total': 0, 'by_problem': {}})

    total = 0
    by_problem = {}
    try:
        total = count_checkpoint_unique_users(int(pid))

        # If your Submissions model tracks which checkpoint was submitted:
        if hasattr(Submissions, "CheckpointId"):
            rows = (
                db.session.query(
                    Submissions.CheckpointId,
                    func.count(func.distinct(Submissions.User))
                )

                .filter(Submissions.Project == pid, Submissions.IsCheckpoint == True)
                .group_by(Submissions.CheckpointId)
                .all()
            )
            for ppid, cnt in rows:
                if ppid is None:
                    continue
                by_problem[str(int(ppid))] = int(cnt or 0)
    except Exception:
        total = 0
        by_problem = {}

    return jsonify({'total': int(total), 'by_problem': by_problem})

@projects_api.route('/getAssignmentDescription', methods=['GET'])
@jwt_required()
@inject
def getAssignmentDescription(project_repo: ProjectRepository = Provide[Container.project_repo]):
    
    project_id = request.args.get('project_id')
    if not current_user_can_download_project_files(parse_int(project_id, 0)):
        return access_denied_response(HTTPStatus.FORBIDDEN)
    ppid_raw = (request.args.get('checkpoint_id', '') or '').strip()
    ppid = int(ppid_raw) if ppid_raw.isdigit() else None
    assignmentdesc_contents = project_repo.get_project_desc_file(int(project_id), checkpoint_id=ppid)
    assignmentdesc_path = project_repo.get_project_desc_path(int(project_id), checkpoint_id=ppid)

    fname = os.path.basename(assignmentdesc_path) if assignmentdesc_path else 'assignment_description'
    ext = os.path.splitext(fname)[1].lower()
    if ext == '.pdf':
        mime = 'application/pdf'
    elif ext == '.docx':
        mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    elif ext == '.doc':
        mime = 'application/msword'
    else:
        mime = 'application/octet-stream'
    file_stream = BytesIO(assignmentdesc_contents)
    data = file_stream.getvalue()
    # Send original filename; expose headers for CORS so frontend can read them
    return Response(
        data,
        content_type=mime,
        headers={
            'Content-Disposition': f"attachment; filename=\"{fname}\"; filename*=UTF-8''{quote(fname)}",
            'Content-Length': str(len(data)),
            'X-Filename': fname,
            'Access-Control-Expose-Headers': 'Content-Disposition, Content-Type, X-Filename',
        },
    )

@projects_api.route('/edit_checkpoint_project_files', methods=['POST'])
@jwt_required()
@inject
def edit_checkpoint_project_files(project_repo: ProjectRepository = Provide[Container.project_repo]):
    """
    Upload checkpoint solution files + assignment description (and optional additional files)
    into a dedicated checkpoint folder, and store paths on CheckpointProjects (not Projects).
    """
    def ts_str() -> str:
        return datetime.now().strftime("%Y%m%d_%H%M%S")

    def safe_name(s: str) -> str:
        return secure_filename(s or "").replace(" ", "_")

    if not is_staff_user():
        return access_denied_response()

    pid_str = (request.form.get("project_id", "") or "").strip()
    ppid_str = (request.form.get("checkpoint_id", "") or "").strip()
    if not pid_str.isdigit() or not ppid_str.isdigit():
        return make_response({'message': 'Invalid project_id or checkpoint_id'}, HTTPStatus.BAD_REQUEST)
    pid = int(pid_str)
    ppid = int(ppid_str)
    if not user_can_access_project_id(pid):
        return access_denied_response(HTTPStatus.FORBIDDEN)
    if not user_can_access_checkpoint_id(ppid):
        return access_denied_response(HTTPStatus.FORBIDDEN)

    proj = project_repo.get_selected_project(pid)
    if not proj:
        return make_response({'message': 'Project not found'}, HTTPStatus.NOT_FOUND)

    # Require both solution and description for checkpoint files
    solution_uploads = request.files.getlist('solutionFiles')
    solution_uploads = [f for f in solution_uploads if f and f.filename]
    if not solution_uploads:
        return make_response({'message': 'No selected solution files'}, HTTPStatus.BAD_REQUEST)
    if 'assignmentdesc' not in request.files or not request.files['assignmentdesc'].filename:
        return make_response({'message': 'No assignment description file'}, HTTPStatus.BAD_REQUEST)

    pp = project_repo.get_checkpoint(ppid)
    if not pp:
        return make_response({'message': 'Checkpoint not found'}, HTTPStatus.NOT_FOUND)

    ts = ts_str()
    base_dir = os.path.join(checkpoint_project_dir(pid), str(ppid), ts)
    os.makedirs(base_dir, exist_ok=True)

    # Save solution file(s)
    for up in solution_uploads:
        orig = safe_name(up.filename)
        ext = os.path.splitext(orig)[1].lower()
        if ext not in ALLOWED_SOURCE_EXTS:
            return make_response({'message': f'Unsupported file type: {ext}'}, HTTPStatus.BAD_REQUEST)
        up.save(os.path.join(base_dir, orig))

    # Save description
    ad = request.files['assignmentdesc']
    ad_name = safe_name(ad.filename or "assignment.pdf")
    desc_path = os.path.join(base_dir, ad_name)
    ad.save(desc_path)

    # Save additional checkpoint files (optional)
    add_names = []
    for add_up in request.files.getlist('additionalFiles'):
        if add_up and add_up.filename:
            orig_name = safe_name(add_up.filename)
            add_up.save(os.path.join(base_dir, orig_name))
            add_names.append(orig_name)

    # Persist checkpoint-only paths
    pp.solutionpath = base_dir
    pp.AsnDescriptionPath = desc_path
    pp.AdditionalFilePath = json.dumps(add_names)
    pp.Language = getattr(proj, "Language", "") or pp.Language
    pp.Enabled = True
    try:
        from src.repositories.database import db
        db.session.commit()
    except Exception:
        return make_response({'message': 'Failed to save checkpoint paths'}, HTTPStatus.INTERNAL_SERVER_ERROR)

    # Recompute outputs for this PRACTICE PROBLEM's testcases using this checkpoint solution
    try:
        recompute_expected_outputs(
            project_repo,
            int(pid),
            solution_override_path=base_dir,
            language_override=getattr(proj, "Language", ""),
            checkpoint_id=int(ppid),
        )
    except Exception:
        pass

    return jsonify({'ok': True})

@projects_api.route('/rename_checkpoint', methods=['POST'])
@jwt_required()
@inject
def rename_checkpoint(project_repo: ProjectRepository = Provide[Container.project_repo]):
    if not is_staff_user():
        return access_denied_response()

    data = request.get_json(silent=True) or {}
    try:
        pid = int(str(data.get('project_id', 0)) or 0)
    except ValueError:
        pid = 0
    try:
        ppid = int(str(data.get('checkpoint_id', 0)) or 0)
    except ValueError:
        ppid = 0
    name = str(data.get('name', '') or '').strip()

    if pid <= 0 or ppid <= 0 or not name:
        return make_response({'message': 'Missing required fields'}, HTTPStatus.BAD_REQUEST)
    if not user_can_access_project_id(pid):
        return access_denied_response(HTTPStatus.FORBIDDEN)
    if not user_can_access_checkpoint_id(ppid):
        return access_denied_response(HTTPStatus.FORBIDDEN)

    pp = project_repo.get_checkpoint(ppid)
    if not pp or int(getattr(pp, "ProjectId", 0) or 0) != int(pid):
        return make_response({'message': 'Checkpoint not found'}, HTTPStatus.NOT_FOUND)

    pp.Name = name
    try:
        from src.repositories.database import db
        db.session.commit()
    except Exception:
        return make_response({'message': 'Failed to rename checkpoint'}, HTTPStatus.INTERNAL_SERVER_ERROR)

    return jsonify({'ok': True, 'name': name})

@projects_api.route('/ProjectGrading', methods=['POST'])
@jwt_required()
@inject
def ProjectGrading(submission_repo: SubmissionRepository = Provide[Container.submission_repo], project_repo: ProjectRepository = Provide[Container.project_repo], class_repo: ClassRepository = Provide[Container.class_repo], user_repo: UserRepository = Provide[Container.user_repo]):
    if not is_staff_user():
        return access_denied_response(HTTPStatus.FORBIDDEN)

    input_json = request.get_json()
    project_id = input_json['ProjectId']
    if not user_can_access_project_id(project_id):
        return access_denied_response(HTTPStatus.FORBIDDEN)
    user_id = input_json['userID']
    checkpoint_raw = (input_json or {}).get('checkpoint', False)
    checkpoint = str(checkpoint_raw).strip().lower() in ('1', 'true', 'yes', 'y', 'on')

    ppid_raw = (input_json or {}).get('checkpoint_id', None)
    try:
        checkpoint_id = int(ppid_raw) if ppid_raw is not None else None
    except (TypeError, ValueError):
        checkpoint_id = None

    if checkpoint and hasattr(Submissions, "IsCheckpoint"):

        q = (
            Submissions.query
            .filter(
                Submissions.Project == project_id,
                Submissions.User == user_id,
                Submissions.IsCheckpoint == True
            )
        )
        # If grading a specific checkpoint, restrict to that checkpoint_id.
        if checkpoint_id is not None and hasattr(Submissions, "CheckpointId"):
            q = q.filter(Submissions.CheckpointId == checkpoint_id)
        sub = q.order_by(Submissions.Time.desc()).first()

        submissions = {user_id: sub} if sub else {}
    else:
        submissions = submission_repo.get_most_recent_submission_by_project(project_id, [user_id])

    test_info = []
    grading_data = {}
    student_code = ""
    project_language = project_repo.get_selected_project(project_id).Language

    if user_id in submissions:
        student_code = submission_repo.read_code_file(submissions[user_id].CodeFilepath)
        student_output = submission_repo.read_output_file(submissions[user_id].OutputFilepath)
        try:
            payload = json.loads(student_output) if student_output else {}
        except Exception:
            payload = {}
        for r in (payload or {}).get("results", []):
            test_info.append({
                "name": (r or {}).get("name", ""),
                "passed": bool((r or {}).get("passed", False)),
                "State": bool((r or {}).get("passed", False)),
                "shortDiff": (r or {}).get("shortDiff", ""),
                "longDiff": (r or {}).get("longDiff", ""),
            })

        grading_data[user_id] = [student_code, test_info]
    else:
        grading_data[user_id] = ["", ""]

    return make_response(json.dumps({"Code": student_code, "TestResults": test_info, "Language": project_language}), HTTPStatus.OK)


@projects_api.route('/unlockStudentAccount', methods=['POST'])
@jwt_required()
@inject
def unlockStudentAccount(user_repo: UserRepository = Provide[Container.user_repo]):
    if not is_staff_user():
        return access_denied_response(HTTPStatus.FORBIDDEN)
    input_json = request.get_json()
    user_Id = input_json['UserId']
    if not user_can_access_student_id(user_Id):
        return access_denied_response(HTTPStatus.FORBIDDEN)
    user_repo.unlock_student_account(user_Id)
    message = {
        'message': 'Success'
    }
    return make_response(message, HTTPStatus.OK)