from flask.json import jsonify
import json
import os
import subprocess
from typing import Optional

from flask_jwt_extended import jwt_required
from flask_jwt_extended import current_user
from flask import Blueprint
from flask import request
from flask import make_response
from flask import current_app
from http import HTTPStatus
from datetime import datetime
from math import ceil
from dependency_injector.wiring import inject, Provide

from container import Container
from src.constants import ADMIN_ROLE, STUDENT_ROLE, TEACHER_ROLE
from src.repositories.class_repository import ClassRepository
from src.repositories.models import Checkpoints, Classes, ClassAssignments, Projects, Submissions, Users
from src.repositories.project_repository import ProjectRepository
from src.repositories.database import db
from src.repositories.submission_repository import SubmissionRepository
from src.repositories.user_repository import UserRepository

upload_api = Blueprint("upload_api", __name__)

ALLOWED_EXTENSIONS_BY_LANGUAGE = {
    "py": [".py"],
    "python": [".py"],
    "python3": [".py"],
    "java": [".java"],
    "c": [".c"],
    "racket": [".rkt"],
    "rkt": [".rkt"],
    "scheme": [".rkt"],
}

ALLOWED_SOURCE_EXTENSIONS = {".py", ".java", ".c", ".rkt"}
SUBMISSION_COOLDOWN_SECONDS = 120


def parse_int(v, default: int = 0) -> int:
    try:
        return int(str(v).strip())
    except Exception:
        return default


def parse_bool(v) -> bool:
    if isinstance(v, bool):
        return v

    s = str(v or "").strip().lower()
    return s in ("1", "true", "yes", "y", "on")


def current_user_id() -> int:
    return parse_int(getattr(current_user, "Id", 0), 0)


def current_user_global_role() -> int:
    user_id = current_user_id()

    if user_id <= 0:
        return STUDENT_ROLE

    role_rows = db.session.query(ClassAssignments.Role).filter(
        ClassAssignments.UserId == user_id
    ).all()

    roles = []
    for role_row in role_rows:
        if hasattr(role_row, "Role"):
            role_value = role_row.Role
        elif isinstance(role_row, (tuple, list)):
            role_value = role_row[0]
        else:
            role_value = role_row

        roles.append(parse_int(role_value, STUDENT_ROLE))

    return max([STUDENT_ROLE] + roles)


def is_admin_user() -> bool:
    return current_user_global_role() >= ADMIN_ROLE


def is_teacher_user() -> bool:
    return current_user_global_role() == TEACHER_ROLE


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


def class_assignment_for_user(class_id: int, user_id: int):
    class_id = parse_int(class_id, 0)
    user_id = parse_int(user_id, 0)

    if class_id <= 0 or user_id <= 0:
        return None

    try:
        return ClassAssignments.query.filter(
            ClassAssignments.ClassId == class_id,
            ClassAssignments.UserId == user_id,
        ).first()
    except Exception:
        return None


def current_user_assignment_role_for_class(class_id: int) -> int | None:
    assignment = class_assignment_for_user(class_id, current_user_id())

    if assignment is None:
        return None

    return parse_int(getattr(assignment, "Role", None), STUDENT_ROLE)


def user_id_is_enrolled_in_class(user_id: int, class_id: int) -> bool:
    return class_assignment_for_user(class_id, user_id) is not None


def current_user_is_enrolled_in_class(class_id: int) -> bool:
    return user_id_is_enrolled_in_class(current_user_id(), class_id)


def current_user_has_staff_assignment() -> bool:
    user_id = current_user_id()

    if user_id <= 0:
        return False

    try:
        if (
            ClassAssignments.query.filter(
                ClassAssignments.UserId == user_id,
                ClassAssignments.Role >= TEACHER_ROLE,
            ).first()
            is not None
        ):
            return True
    except Exception:
        pass

    try:
        for class_item in Classes.query.filter(Classes.Tid.isnot(None)).all():
            if teacher_id_is_on_class(user_id, class_item):
                return True
    except Exception:
        pass

    return False


def is_staff_user() -> bool:
    return current_user_global_role() >= TEACHER_ROLE or current_user_has_staff_assignment()


def user_can_access_class_id(class_id: int) -> bool:
    class_id = parse_int(class_id, 0)

    if class_id <= 0:
        return False

    class_item = Classes.query.filter(Classes.Id == class_id).first()
    if class_item is None:
        return False

    if is_admin_user():
        return True

    assignment_role = current_user_assignment_role_for_class(class_id)
    if assignment_role is not None and assignment_role >= TEACHER_ROLE:
        return True

    return teacher_id_is_on_class(current_user_id(), class_item)


def normalize_grader_language(language: str, solution_root: str = "") -> str:
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
            candidates = [
                os.path.splitext(name)[1].lower()
                for name in os.listdir(solution_root)
            ]
        elif solution_root:
            candidates = [os.path.splitext(solution_root)[1].lower()]

        if ".py" in candidates:
            return "py"
        if ".java" in candidates:
            return "java"
        if ".c" in candidates:
            return "c"
        if ".rkt" in candidates:
            return "racket"
    except Exception:
        pass

    return raw or "py"


def allowed_file(filename: str) -> bool:
    if not filename or "." not in filename:
        return False

    _, extension = os.path.splitext(filename)
    return extension.lower() in ALLOWED_SOURCE_EXTENSIONS


def expected_extensions_for_language(language: str) -> list[str]:
    raw = str(language or "").strip().lower()
    normalized = normalize_grader_language(raw)

    if raw in ALLOWED_EXTENSIONS_BY_LANGUAGE:
        return ALLOWED_EXTENSIONS_BY_LANGUAGE[raw]

    if normalized in ALLOWED_EXTENSIONS_BY_LANGUAGE:
        return ALLOWED_EXTENSIONS_BY_LANGUAGE[normalized]

    return []


def sanitize_fs_name(value: str) -> str:
    safe = "".join(
        c if c.isalnum() or c in "-_" else "_"
        for c in str(value or "").strip()
    )

    return safe or "unknown"


def safe_upload_filename(filename: str) -> str:
    base = os.path.basename(filename or "")
    stem, extension = os.path.splitext(base)

    safe_stem = "".join(
        c if c.isalnum() or c in "-_" else "_"
        for c in str(stem or "").strip()
    )

    return f"{safe_stem or 'submission'}{extension.lower()}"


def path_segment(value: str, fallback: str = "unnamed") -> str:
    safe = sanitize_fs_name(value)
    return safe if safe != "unknown" else fallback


def project_files_root() -> str:
    return "/tabot-files/project-files"


def student_root_for_class(class_id: int) -> str:
    class_item = Classes.query.filter(Classes.Id == int(class_id)).first()
    class_name = path_segment(getattr(class_item, "Name", "") if class_item else f"class_{class_id}", f"class_{class_id}")
    school = getattr(class_item, "School", None) if class_item else None
    school_name = path_segment(getattr(school, "Name", "") if school else "school", "school")
    return os.path.join(project_files_root(), school_name, class_name, "student-files")


def project_module(project):
    module = getattr(project, "Module", None)
    if module:
        return module
    module_id = getattr(project, "ModuleId", None)
    if module_id:
        from src.repositories.models import Modules
        return Modules.query.filter(Modules.Id == int(module_id)).first()
    return None


def module_folder_name(project, timestamp_hint: str) -> str:
    module = project_module(project)
    fallback_name = getattr(project, "Name", "") or "module"

    if module is None:
        return f"{timestamp_hint}_{path_segment(fallback_name, 'module')}"

    changed = False

    if not getattr(module, "FileTimestamp", None):
        module.FileTimestamp = timestamp_hint
        changed = True

    if not getattr(module, "FirstName", None):
        module.FirstName = getattr(module, "Name", None) or fallback_name
        changed = True

    if changed:
        db.session.commit()

    return f"{module.FileTimestamp}_{path_segment(module.FirstName, 'module')}"


def project_first_folder(project) -> str:
    if not getattr(project, "FirstName", None):
        project.FirstName = getattr(project, "Name", None) or "project"
        db.session.commit()
    return path_segment(project.FirstName, "project")


def checkpoint_first_folder(checkpoint: Checkpoints) -> str:
    if not getattr(checkpoint, "FirstName", None):
        checkpoint.FirstName = getattr(checkpoint, "Name", None) or "checkpoint"
        db.session.commit()
    return path_segment(checkpoint.FirstName, "checkpoint")


def student_project_bucket(class_id: int, project, checkpoint: Optional[Checkpoints], timestamp_hint: str) -> str:
    module_folder = module_folder_name(project, timestamp_hint)

    if checkpoint is not None:
        scope = "checkpoint"
        item_folder = checkpoint_first_folder(checkpoint)
    else:
        scope = "main"
        item_folder = project_first_folder(project)

    return os.path.join(
        student_root_for_class(class_id),
        module_folder,
        scope,
        item_folder,
    )


def resolve_additional_files_payload(owner, solution_path: str) -> str:
    try:
        teacher_base_dir = (
            solution_path
            if solution_path and os.path.isdir(solution_path)
            else os.path.dirname(solution_path or "")
        )

        raw = str(getattr(owner, "AdditionalFilePath", "") or "").strip()

        if not raw:
            return json.dumps({"base_dir": teacher_base_dir, "files": []})

        if raw.startswith("[") or raw.startswith("{"):
            parsed = json.loads(raw)
        else:
            parsed = [raw]

        if isinstance(parsed, dict):
            parsed = parsed.get("files", [])

        abs_list = []

        for path_value in parsed or []:
            if not path_value:
                continue

            path_text = str(path_value)

            if os.path.isabs(path_text):
                abs_list.append(path_text)
            else:
                abs_list.append(
                    os.path.join(teacher_base_dir, os.path.basename(path_text))
                )

        return json.dumps({"base_dir": teacher_base_dir, "files": abs_list})
    except Exception:
        return ""


def load_grader_status(json_out: str) -> tuple[bool, dict]:
    status = False
    testcase_results = {"Passed": [], "Failed": []}

    try:
        with open(json_out, "r", encoding="utf-8", errors="replace") as f:
            payload = json.load(f) or {}

        passed = []
        failed = []

        for result in payload.get("results", []):
            name = str((result or {}).get("name", "") or "")

            if bool((result or {}).get("passed", False)):
                passed.append(name)
            else:
                failed.append(name)

        status = len(failed) == 0
        testcase_results = {"Passed": passed, "Failed": failed}
    except Exception:
        pass

    return status, testcase_results


def parse_submission_datetime(value) -> datetime | None:
    if isinstance(value, datetime):
        return value

    raw = str(value or "").strip()
    if not raw:
        return None

    for fmt in ("%Y/%m/%d %H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(raw[:19], fmt)
        except ValueError:
            pass

    return None


def get_latest_student_submission_in_class(user_id: int, class_id: int):
    try:
        return (
            db.session.query(Submissions)
            .join(Projects, Submissions.Project == Projects.Id)
            .filter(
                Submissions.User == int(user_id),
                Projects.ClassId == int(class_id),
            )
            .order_by(Submissions.Time.desc())
            .first()
        )
    except Exception:
        return None


def student_submission_cooldown_response(user_id: int, class_id: int):
    latest = get_latest_student_submission_in_class(user_id, class_id)

    if latest is None:
        return None

    submitted_at = parse_submission_datetime(getattr(latest, "Time", None))

    if submitted_at is None:
        return None

    elapsed_seconds = (datetime.now() - submitted_at).total_seconds()
    remaining_seconds = int(ceil(SUBMISSION_COOLDOWN_SECONDS - elapsed_seconds))

    if remaining_seconds <= 0:
        return None

    response = make_response(
        {
            "message": f"Please wait {remaining_seconds} seconds before submitting again.",
            "retry_after_seconds": remaining_seconds,
            "cooldown_seconds": SUBMISSION_COOLDOWN_SECONDS,
        },
        HTTPStatus.TOO_MANY_REQUESTS,
    )
    response.headers["Retry-After"] = str(remaining_seconds)
    return response


@upload_api.route("/total_students_by_cid", methods=["GET"])
@jwt_required()
@inject
def total_students(user_repo: UserRepository = Provide[Container.user_repo]):
    class_id = request.args.get("class_id")
    class_id_int = parse_int(class_id, 0)

    if class_id_int <= 0:
        return make_response({"message": "Invalid class_id"}, HTTPStatus.BAD_REQUEST)

    if not user_can_access_class_id(class_id_int):
        return make_response({"message": "Access Denied"}, HTTPStatus.FORBIDDEN)

    users = (
        db.session.query(Users)
        .join(ClassAssignments, ClassAssignments.UserId == Users.Id)
        .filter(
            ClassAssignments.ClassId == class_id_int,
            ClassAssignments.Role == STUDENT_ROLE,
        )
        .order_by(Users.Lastname.asc(), Users.Firstname.asc(), Users.Id.asc())
        .all()
    )

    list_of_user_info = []

    for user in users:
        list_of_user_info.append(
            {
                "name": f"{user.Firstname} {user.Lastname}".strip(),
                "mscsnet": user.Username,
                "id": user.Id,
            }
        )

    return jsonify(list_of_user_info)


@upload_api.route("/", methods=["POST"])
@jwt_required()
@inject
def file_upload(
    user_repository: UserRepository = Provide[Container.user_repo],
    submission_repo: SubmissionRepository = Provide[Container.submission_repo],
    project_repo: ProjectRepository = Provide[Container.project_repo],
    class_repo: ClassRepository = Provide[Container.class_repo],
):
    class_id = request.form.get("class_id", "").strip()

    if not class_id:
        return make_response({"message": "Missing class_id"}, HTTPStatus.BAD_REQUEST)

    class_id_int = parse_int(class_id, 0)

    if class_id_int <= 0:
        return make_response({"message": "Invalid class_id"}, HTTPStatus.BAD_REQUEST)

    is_staff_upload = user_can_access_class_id(class_id_int)

    if "student_id" in request.form and not is_staff_upload:
        return make_response({"message": "Access Denied"}, HTTPStatus.FORBIDDEN)

    if not is_staff_upload and not current_user_is_enrolled_in_class(class_id_int):
        return make_response({"message": "Access Denied"}, HTTPStatus.FORBIDDEN)

    username = current_user.Username
    user_id = current_user.Id

    if "student_id" in request.form:
        student_id = parse_int(request.form.get("student_id"), 0)

        if student_id <= 0:
            return make_response(
                {"message": "Invalid student_id"},
                HTTPStatus.BAD_REQUEST,
            )

        user_lookup = user_repository.get_user_by_id(student_id)
        username = getattr(user_lookup, "Username", user_lookup)

        if not username:
            return make_response(
                {"message": "Student not found"},
                HTTPStatus.NOT_FOUND,
            )

        user_obj = user_repository.getUserByName(username)

        if not user_obj:
            return make_response(
                {"message": "Student not found"},
                HTTPStatus.NOT_FOUND,
            )

        user_id = user_obj.Id

        if not user_id_is_enrolled_in_class(user_id, class_id_int):
            return make_response(
                {"message": "Student is not enrolled in this class"},
                HTTPStatus.FORBIDDEN,
            )

    project = None

    if "project_id" in request.form:
        project_id = parse_int(request.form.get("project_id"), 0)

        if project_id <= 0:
            return make_response(
                {"message": "Invalid project_id"},
                HTTPStatus.BAD_REQUEST,
            )

        project = project_repo.get_selected_project(project_id)
    else:
        project = project_repo.get_current_project_by_class(class_id)

    if project is None:
        return make_response(
            {"message": "No active project"},
            HTTPStatus.NOT_ACCEPTABLE,
        )

    if int(getattr(project, "ClassId", 0) or 0) != class_id_int:
        return make_response(
            {"message": "Project does not belong to this class"},
            HTTPStatus.BAD_REQUEST,
        )

    checkpoint_id = parse_int(request.form.get("checkpoint_id", ""), 0)
    is_checkpoint = parse_bool(request.form.get("checkpoint", "")) or checkpoint_id > 0

    checkpoint: Optional[Checkpoints] = None

    if is_checkpoint:
        if checkpoint_id <= 0:
            return make_response(
                {"message": "Missing checkpoint_id"},
                HTTPStatus.BAD_REQUEST,
            )

        checkpoint = project_repo.get_checkpoint(checkpoint_id)

        if checkpoint is None:
            return make_response(
                {"message": "Checkpoint not found"},
                HTTPStatus.NOT_FOUND,
            )

        if int(getattr(checkpoint, "ProjectId", 0) or 0) != int(project.Id):
            return make_response(
                {"message": "Checkpoint does not belong to this project"},
                HTTPStatus.BAD_REQUEST,
            )

        if not bool(getattr(checkpoint, "Enabled", True)):
            return make_response(
                {"message": "Checkpoint is disabled"},
                HTTPStatus.FORBIDDEN,
            )

    if not is_staff_upload:
        cooldown_response = student_submission_cooldown_response(user_id, class_id_int)

        if cooldown_response is not None:
            return cooldown_response

    upload_files = request.files.getlist("files")

    if not upload_files:
        single = request.files.get("file")

        if single and single.filename:
            upload_files = [single]

    upload_files = [f for f in upload_files if f and f.filename]

    if not upload_files:
        return make_response({"message": "No selected file"}, HTTPStatus.BAD_REQUEST)

    if not all(allowed_file(f.filename) for f in upload_files):
        return make_response(
            {"message": "Unsupported file type"},
            HTTPStatus.UNSUPPORTED_MEDIA_TYPE,
        )

    owner = checkpoint if checkpoint is not None else project

    effective_language = (
        getattr(owner, "Language", None)
        or getattr(project, "Language", None)
        or ""
    )

    solution_path = ""

    try:
        solution_path = project_repo.get_project_path(
            int(project.Id),
            checkpoint_id=(checkpoint_id if is_checkpoint else None),
        )
    except Exception:
        solution_path = ""

    if not solution_path:
        solution_path = str(getattr(owner, "solutionpath", "") or "")

    if not solution_path:
        return make_response(
            {
                "message": (
                    "Checkpoint has no solution files"
                    if is_checkpoint
                    else "Assignment has no solution files"
                )
            },
            HTTPStatus.BAD_REQUEST,
        )

    grader_language = normalize_grader_language(effective_language, solution_path)
    expected_extensions = expected_extensions_for_language(effective_language)

    if not expected_extensions:
        expected_extensions = expected_extensions_for_language(grader_language)

    if not expected_extensions:
        return make_response(
            {"message": "Unsupported language"},
            HTTPStatus.UNSUPPORTED_MEDIA_TYPE,
        )

    submitted_extensions = [
        os.path.splitext(f.filename)[1].lower()
        for f in upload_files
    ]

    if grader_language == "java":
        invalid_java_files = [
            f.filename
            for f in upload_files
            if os.path.splitext(f.filename)[1].lower() != ".java"
        ]

        if invalid_java_files:
            return make_response(
                {
                    "message": (
                        "Selected project expects Java: upload one or more .java files."
                    )
                },
                HTTPStatus.UNSUPPORTED_MEDIA_TYPE,
            )
    else:
        if len(upload_files) != 1:
            return make_response(
                {
                    "message": (
                        "Only Java projects support multi-file student uploads."
                    )
                },
                HTTPStatus.UNSUPPORTED_MEDIA_TYPE,
            )

        if submitted_extensions[0] not in expected_extensions:
            readable = ", ".join(expected_extensions)
            return make_response(
                {
                    "message": (
                        f"Selected project expects {readable}: upload the correct file type."
                    )
                },
                HTTPStatus.UNSUPPORTED_MEDIA_TYPE,
            )

    class_repo.get_class_name_withId(class_id)

    ts_now = datetime.now()
    ts_stamp = ts_now.strftime("%Y%m%d_%H%M%S")
    dt_string = ts_now.strftime("%Y/%m/%d %H:%M:%S")

    project_bucket = student_project_bucket(
        class_id_int,
        project,
        checkpoint if is_checkpoint else None,
        ts_stamp,
    )

    safe_username = sanitize_fs_name(username)
    user_bucket = os.path.join(project_bucket, safe_username)
    os.makedirs(user_bucket, exist_ok=True)

    outputpath = project_bucket
    submission_dir = os.path.join(user_bucket, ts_stamp)
    os.makedirs(submission_dir, exist_ok=True)

    for upload_file in upload_files:
        safe_filename = safe_upload_filename(upload_file.filename)
        destination = os.path.join(submission_dir, safe_filename)
        upload_file.save(destination)

    try:
        testcase_info_json = project_repo.testcases_to_json(
            int(project.Id),
            checkpoint_id=(checkpoint_id if is_checkpoint else None),
        )
    except TypeError:
        testcase_info_json = project_repo.testcases_to_json(int(project.Id))

    grading_script = "/tabot-files/grading-scripts/grade.py"
    project_id_arg = str(project.Id)
    class_id_arg = str(class_id)

    add_payload = resolve_additional_files_payload(owner, solution_path)

    cmd = [
        "python",
        grading_script,
        str(username),
        grader_language,
        str(testcase_info_json),
        submission_dir,
        add_payload,
        project_id_arg,
        class_id_arg,
    ]

    result = subprocess.run(cmd, cwd=outputpath)

    if result.returncode != 0:
        return make_response(
            {"message": "Error in running grading script!"},
            HTTPStatus.INTERNAL_SERVER_ERROR,
        )

    json_out = os.path.join(submission_dir, "testcases.json")

    if not os.path.exists(json_out):
        alternate_json_out = os.path.join(submission_dir, f"{username}.json")

        if os.path.exists(alternate_json_out):
            json_out = alternate_json_out

    status, testcase_results = load_grader_status(json_out)

    submission_id = submission_repo.create_submission(
        user_id=user_id,
        output=json_out,
        codepath=submission_dir,
        time=dt_string,
        project_id=project.Id,
        status=status,
        errorcount=0,
        testcase_results=testcase_results,
        is_checkpoint=is_checkpoint,
        checkpoint_id=(checkpoint_id if is_checkpoint else None),
    )

    if not is_staff_upload and not is_checkpoint:
        submission_repo.consume_charge(user_id, class_id, project.Id, submission_id)

    message = {
        "message": "Success",
        "remainder": 10,
        "sid": submission_id,
        "cooldown_seconds": SUBMISSION_COOLDOWN_SECONDS,
    }

    return make_response(message, HTTPStatus.OK)