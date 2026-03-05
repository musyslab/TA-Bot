from datetime import timedelta
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
from src.constants import EMPTY, ADMIN_ROLE
import json
import zipfile
from io import BytesIO
from tap.parser import Parser
from flask import jsonify
from datetime import datetime
from dependency_injector.wiring import inject, Provide
from container import Container
from urllib.parse import unquote
import csv
from io import StringIO
from src.ai_suggestions import ERROR_DEFS
from src.repositories.models import Testcases, Submissions

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

def opt_int(raw) -> int | None:
    s = str(raw or "").strip()
    return int(s) if s.isdigit() else None

def practice_params_from_args() -> tuple[bool, int | None]:
    want_practice = parse_bool(request.args.get("practice", ""))
    ppid = opt_int(request.args.get("practice_problem_id", ""))
    return want_practice, ppid

def latest_practice_submission(project_id: int, user_id: int, practice_problem_id: int | None):
    try:
        q = (
            Submissions.query
            .filter(
                Submissions.Project == int(project_id),
                Submissions.User == int(user_id),
                Submissions.IsPractice == True,
            )
        )
        if practice_problem_id is not None and hasattr(Submissions, "PracticeProblemId"):
            q = q.filter(Submissions.PracticeProblemId == int(practice_problem_id))
        return q.order_by(Submissions.Time.desc()).first()
    except Exception:
        return None

def resolve_submission_for_current_user(
    submission_repo: SubmissionRepository,
    project_repo: ProjectRepository,
    submission_id: int,
    class_id: int,
    want_practice: bool,
    ppid: int | None,
):
    """
    Resolves:
      - real submission id -> that submission
      - otherwise treats submission_id as project id and returns latest (main/practice) for current_user
      - if submission_id is EMPTY, resolves current project by class_id and returns latest main submission
    Returns: (submission | None, project_id:int, practice_problem_id_for_hidden_flags:int|None)
    """
    project_id = -1
    sub = None
    practice_problem_id = None

    if submission_id != EMPTY and submission_id != -1:
        sub = submission_repo.get_submission_by_submission_id(int(submission_id))
        if sub is None:
            project_id = int(submission_id)
            if want_practice:
                sub = latest_practice_submission(project_id, int(current_user.Id), ppid)
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
        if bool(getattr(sub, "IsPractice", False)) and getattr(sub, "PracticeProblemId", None) is not None:
            practice_problem_id = int(getattr(sub, "PracticeProblemId"))
    except Exception:
        practice_problem_id = None

    return sub, int(project_id), practice_problem_id

def apply_hidden_flags_to_results(output_json: str, project_id: int, practice_problem_id: int | None) -> str:
    try:
        obj = json.loads(output_json) if isinstance(output_json, str) else (output_json or {})
        results = obj.get("results", None) if isinstance(obj, dict) else None
        if not isinstance(results, list) or int(project_id) <= 0:
            return output_json

        q = Testcases.query.filter(Testcases.ProjectId == int(project_id))
        if practice_problem_id is not None:
            q = q.filter(Testcases.PracticeProblemId == int(practice_problem_id))
        else:
            q = q.filter(Testcases.PracticeProblemId.is_(None))
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
        if (s.startswith("{") or s.startswith("[")) and "\n" in s:
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
    want_practice, ppid_qs = practice_params_from_args()

    submission, projectid, practice_problem_id = resolve_submission_for_current_user(
        submission_repo,
        project_repo,
        submission_id,
        class_id,
        want_practice,
        ppid_qs,
    )
    if submission is None:
        return make_response(json.dumps({"results": []}), HTTPStatus.OK)

    if current_user.Role != ADMIN_ROLE:
        real_sub_id = int(getattr(submission, "Id", -1) or -1)
        if real_sub_id <= 0 or not submission_repo.submission_view_verification(int(current_user.Id), real_sub_id):
            return make_response("Not Authorized", HTTPStatus.UNAUTHORIZED)
   
    output = convert_tap_to_json(submission.OutputFilepath, current_user.Role, 0, False)
    output = apply_hidden_flags_to_results(output, int(projectid), practice_problem_id)

    return make_response(output, HTTPStatus.OK)

@submission_api.route('/codefinder', methods=['GET'])
@jwt_required()
@inject
def codefinder(submission_repo: SubmissionRepository = Provide[Container.submission_repo], project_repo: ProjectRepository = Provide[Container.project_repo]):
    submissionid = parse_int(request.args.get("id", "-1"), -1)
    class_id = parse_int(request.args.get("class_id", "-1"), -1)
    fmt = (request.args.get("format", "") or "").strip().lower()
    want_json = fmt in ("json", "view", "preview")

    want_practice, ppid = practice_params_from_args()

    code_output = ""
    if submissionid != EMPTY:
        sub = submission_repo.get_submission_by_submission_id(submissionid)
        if sub is not None and (current_user.Role == ADMIN_ROLE or submission_repo.submission_view_verification(current_user.Id, submissionid)):
            code_output = submission_repo.get_code_path_by_submission_id(submissionid)
        else:
            resolved, _, _ = resolve_submission_for_current_user(
                submission_repo,
                project_repo,
                int(submissionid),
                int(class_id),
                bool(want_practice),
                ppid,
            )
            code_output = getattr(resolved, "CodeFilepath", "") if resolved else ""
    else:
        projectid = project_repo.get_current_project_by_class(class_id).Id
        code_output = submission_repo.get_submission_by_user_and_projectid(current_user.Id,projectid).CodeFilepath
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

@submission_api.route('/recentsubproject', methods=['POST'])
@jwt_required()
@inject
def recentsubproject(submission_repo: SubmissionRepository = Provide[Container.submission_repo], user_repo: UserRepository = Provide[Container.user_repo],project_repo: ProjectRepository = Provide[Container.project_repo] ):
    if(current_user.Role != ADMIN_ROLE):
        return make_response("Not Authorized", HTTPStatus.UNAUTHORIZED)
    input_json = request.get_json()
    projectid = input_json['project_id']
    practice_raw = (input_json or {}).get('practice', False)
    practice = str(practice_raw).strip().lower() in ('1', 'true', 'yes', 'y', 'on')
    
    ppid_raw = (input_json or {}).get('practice_problem_id', None)
    try:
        practice_problem_id = int(ppid_raw) if ppid_raw is not None else None
    except (TypeError, ValueError):
        practice_problem_id = None
    
    class_name = project_repo.get_className_by_projectId(projectid)
    class_id = project_repo.get_class_id_by_name(class_name)
    users = user_repo.get_all_users_by_cid(class_id)
    studentattempts={}
    userids=[]
    for user in users:
        userids.append(user.Id)

    if practice and hasattr(Submissions, "IsPractice"):
        bucket = {}
        submission_counter_dict = {uid: 0 for uid in userids}
        
        q = (
            Submissions.query
            .filter(
                Submissions.Project == projectid,
                Submissions.User.in_(userids),
                Submissions.IsPractice == True,
            )
        )
        # If the UI requested a specific practice problem, scope to it.
        if practice_problem_id is not None and hasattr(Submissions, "PracticeProblemId"):
            q = q.filter(Submissions.PracticeProblemId == practice_problem_id)
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
        if int(user.Role) == 0:
            if user.Id in bucket:
                student_grade = 0 if practice else project_repo.get_student_grade(projectid, user.Id)
                student_id = user_repo.get_StudentNumber(user.Id)
                studentattempts[user.Id]=[
                    user.Lastname,
                    user.Firstname,
                    user_lectures_dict[user.Id],
                    user_labs_dict[user.Id],
                    submission_counter_dict[user.Id],
                    bucket[user.Id].Time.isoformat(),
                    bucket[user.Id].IsPassing,
                    bucket[user.Id].Id,
                    str(class_id),
                    student_grade,
                    student_id,
                    user.IsLocked
                ]
            else:
                student_id = user_repo.get_StudentNumber(user.Id)
                studentattempts[user.Id] = [
                    user.Lastname,
                    user.Firstname,
                    user_lectures_dict[user.Id],
                    user_labs_dict[user.Id],
                    "N/A",
                    "N/A",
                    "N/A",
                    "N/A",
                    -1,
                    str(class_id),
                    "0",
                    student_id,
                    user.IsLocked
                ]
    return make_response(json.dumps(studentattempts), HTTPStatus.OK)

@submission_api.route('/submitOHquestion', methods=['GET'])
@jwt_required()
@inject
def Submit_OH_Question(submission_repo: SubmissionRepository = Provide[Container.submission_repo]):
    question = str(request.args.get("question"))
    project_id_raw = (request.args.get("projectId") or "").strip()
    if not project_id_raw.isdigit():
        return make_response("Invalid projectId", HTTPStatus.BAD_REQUEST)
    project_id = int(project_id_raw)
    return make_response(
        submission_repo.Submit_Student_OH_question(question, current_user.Id, project_id),
        HTTPStatus.OK
    )

@submission_api.route('/getOHquestions', methods=['GET'])
@jwt_required()
@inject
def Get_OH_Questions(submission_repo: SubmissionRepository = Provide[Container.submission_repo], user_repo: UserRepository = Provide[Container.user_repo], project_repo: ProjectRepository = Provide[Container.project_repo]):
    if current_user.Role != ADMIN_ROLE:
        return make_response("Not Authorized", HTTPStatus.UNAUTHORIZED)

    def fmt_dt(dt_val):
        if dt_val is None:
            return ""
        try:
            return dt_val.strftime("%x %X")
        except Exception:
            return str(dt_val)

    # Admin view needs ALL OHVisits entries (active + dismissed) so the UI can split
    # into Current Queue vs History.
    questions = submission_repo.Get_all_OH_questions(include_dismissed=True)
    question_list = []
    #Need class ID and submission ID
    for question in questions:
        # If the project was deleted / missing, skip this OH entry so the admin page doesn't 500.
        try:
            proj = project_repo.get_selected_project(int(getattr(question, "projectId", 0) or 0))
        except Exception:
            proj = None
        if not proj:
            continue
        user = user_repo.get_user(question.StudentId)
        Student_name = user.Firstname + " " + user.Lastname
        class_id = int(getattr(proj, "ClassId", 0) or 0)
        subs = submission_repo.get_most_recent_submission_by_project(question.projectId, [question.StudentId])
        try:
            question_list.append([
                question.Sqid,
                question.StudentQuestionscol,
                fmt_dt(question.TimeSubmitted),
                Student_name,
                question.ruling,
                int(getattr(question, "dismissed", 0) or 0),
                fmt_dt(getattr(question, "TimeAccepted", None)),
                fmt_dt(getattr(question, "TimeCompleted", None)),
                question.projectId,
                class_id,
                subs[question.StudentId].Id
            ])
        except:
            question_list.append([
                question.Sqid,
                question.StudentQuestionscol,
                fmt_dt(question.TimeSubmitted),
                Student_name,
                question.ruling,
                int(getattr(question, "dismissed", 0) or 0),
                fmt_dt(getattr(question, "TimeAccepted", None)),
                fmt_dt(getattr(question, "TimeCompleted", None)),
                question.projectId,
                class_id,
                -1
            ])
    return make_response(json.dumps(question_list), HTTPStatus.OK)

@submission_api.route('/getOHqueue', methods=['GET'])
@jwt_required()
@inject
def Get_OH_Queue(submission_repo: SubmissionRepository = Provide[Container.submission_repo], user_repo: UserRepository = Provide[Container.user_repo], project_repo: ProjectRepository = Provide[Container.project_repo]):
    """
    Student-safe queue endpoint.
    Returns only ACTIVE (dismissed == 0) OHVisits for a single project.
    Accepts either:
      - project_id=<int>
      - class_id=<int>  (uses current project for that class)
    Response (list rows): [Sqid, question, time_submitted, student_name]
    """
    def fmt_dt(dt_val):
        if dt_val is None:
            return ""
        try:
            return dt_val.strftime("%x %X")
        except Exception:
            return str(dt_val)

    project_id = None
    pid_raw = (request.args.get("project_id", "") or "").strip()
    if pid_raw.isdigit():
        project_id = int(pid_raw)
    else:
        cid_raw = request.args.get("class_id", None)
        try:
            class_id = int(cid_raw) if cid_raw is not None else None
        except (TypeError, ValueError):
            class_id = None
        if class_id is not None:
            try:
                proj = project_repo.get_current_project_by_class(class_id)
                project_id = int(getattr(proj, "Id", 0) or 0) if proj else None
            except Exception:
                project_id = None

    if not project_id:
        return make_response(json.dumps([]), HTTPStatus.OK)

    questions = submission_repo.Get_active_OH_questions_for_project(int(project_id))
    out = []
    for q in (questions or []):
        try:
            user = user_repo.get_user(q.StudentId)
            student_name = (user.Firstname + " " + user.Lastname) if user else "Unknown"
        except Exception:
            student_name = "Unknown"
        out.append([q.Sqid, q.StudentQuestionscol, fmt_dt(q.TimeSubmitted), student_name])

    return make_response(json.dumps(out), HTTPStatus.OK)

@submission_api.route('/submitOHQuestionRuling', methods=['GET'])
@jwt_required()
@inject
def Submit_OH_Question_Ruling(submission_repo: SubmissionRepository = Provide[Container.submission_repo]):
    question_id = str(request.args.get("question_id"))
    ruling = str(request.args.get("ruling"))
    return make_response(submission_repo.Submit_OH_ruling(question_id,ruling), HTTPStatus.OK)

#dismiss question
@submission_api.route('/dismissOHQuestion', methods=['GET'])
@jwt_required()
@inject
def Dismiss_OH_Question(submission_repo: SubmissionRepository = Provide[Container.submission_repo]):
    question_id = str(request.args.get("question_id"))
    user_id, class_id = submission_repo.Submit_OH_dismiss(question_id)
    reward_amount = 2
    submission_repo.add_reward_charge(user_id, class_id, reward_amount)
    return make_response("ok", HTTPStatus.OK)

@submission_api.route('/getactivequestion', methods=['GET'])
@jwt_required()
@inject
def get_active_Question(submission_repo: SubmissionRepository = Provide[Container.submission_repo]):
    accepted_only_raw = request.args.get("acceptedOnly", "")
    accepted_only = str(accepted_only_raw).lower() in ("1", "true", "yes", "y")
    return make_response(str(submission_repo.get_active_question(current_user.Id, accepted_only)), HTTPStatus.OK)

@submission_api.route('/getAcceptedOHForClass', methods=['GET'])
@jwt_required()
@inject
def get_accepted_oh_for_class(submission_repo: SubmissionRepository = Provide[Container.submission_repo]):
    """
    Returns the Sqid of the most recent ACCEPTED (ruling==1, not dismissed)
    office-hours question for the current user, scoped to the given class_id's
    current project. If none, returns -1.
    """
    class_id_raw = request.args.get("class_id", None)
    try:
        class_id = int(class_id_raw) if class_id_raw is not None else None
    except (TypeError, ValueError):
        class_id = None
    qid = submission_repo.get_accepted_oh_for_class(current_user.Id, class_id)
    return make_response(str(qid if qid is not None else -1), HTTPStatus.OK)

@submission_api.route('/GetSubmissionDetails', methods=['GET'])
@jwt_required()
@inject
def get_remaining_OH_Time(submission_repo: SubmissionRepository = Provide[Container.submission_repo], project_repo: ProjectRepository = Provide[Container.project_repo]):
    class_id = int(request.args.get("class_id"))
    submission_details = []

    # Use the current-project ORM object directly (avoids brittle indexing/parsing)
    proj = project_repo.get_current_project_by_class(class_id)
    if proj is None:
        # no active project → keep array shape consistent for frontend
        # [remaining_oh_time, days_passed, next_submission_str, project_name, end_time, project_id]
        return make_response(["None", "0", "None", "", "", "-1"], HTTPStatus.OK)

    projectId = int(getattr(proj, "Id", 0) or 0)
    submission_details.append(str(submission_repo.get_remaining_OH_Time(current_user.Id, projectId)))

    # Compute days since start from proj.Start (datetime or ISO string)
    start_val = getattr(proj, "Start", None)
    current_time = datetime.now()
    start_date = None
    try:
        if isinstance(start_val, datetime):
            start_date = start_val
        elif isinstance(start_val, str) and start_val.strip():
            # Handle "YYYY-MM-DDTHH:MM:SS" (optionally with microseconds)
            s = start_val.strip()
            if "." in s:
                s = s.split(".", 1)[0]
            start_date = datetime.strptime(s, "%Y-%m-%dT%H:%M:%S")
    except Exception:
        start_date = None

    days_passed = (current_time - start_date).days if start_date else 0
    submission_details.append(str(days_passed))

    time_until_next_submission = submission_repo.check_timeout(current_user.Id, projectId)[1]

    if time_until_next_submission != "None":
        hours = time_until_next_submission.seconds // 3600
        minutes = (time_until_next_submission.seconds % 3600) // 60
        seconds = time_until_next_submission.seconds % 60
        time_until_next_submission_str = f"{hours} hours, {minutes} minutes, {seconds} seconds"
        submission_details.append(time_until_next_submission_str)
    else:
        submission_details.append("None")

    # Project name + due date
    submission_details.append(str(getattr(proj, "Name", "") or ""))

    end_val = getattr(proj, "End", None)
    if isinstance(end_val, datetime):
        end_str = end_val.isoformat(timespec="seconds")
    else:
        end_str = str(end_val or "")
    submission_details.append(end_str)

    submission_details.append(str(projectId))

    return make_response(submission_details, HTTPStatus.OK)

@submission_api.route('/get_oh_visits_by_projectId', methods=['POST'])
@jwt_required()
@inject
def get_oh_visits_by_projectId(submission_repo: SubmissionRepository = Provide[Container.submission_repo]):
    """
    Helper to get all OHVisits entries for a given project_id.
    Returns list of OHVisits objects.
    """
    input_json = request.get_json()
    
    project_id = input_json['project_id'] 
    
    visits = submission_repo.get_oh_visits_by_projectId(project_id)

    return make_response(jsonify(visits), HTTPStatus.OK)

@submission_api.route('/submitgrades', methods=['POST'])
@jwt_required()
@inject
def submit_grades(project_repo: ProjectRepository = Provide[Container.project_repo]):
    if(current_user.Role != ADMIN_ROLE):
        return make_response("Not Authorized", HTTPStatus.UNAUTHORIZED)
    #spacing issue
    data = request.get_json()
    project_id = data['projectID']
    userId = data['userId']
    grade = data['grade']
    project_repo.set_student_grade(int(project_id), int(userId), int(grade))
    return make_response("StudentGrades Submitted", HTTPStatus.OK)

@submission_api.route('/getprojectscores', methods=['GET'])
@jwt_required()
@inject
def getprojectscores(project_repo: ProjectRepository = Provide[Container.project_repo], submission_repo: SubmissionRepository = Provide[Container.submission_repo], user_repo: UserRepository = Provide[Container.user_repo]):
    project_id = str(request.args.get("projectID"))
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

@submission_api.route('/GetCharges', methods=['GET'])
@jwt_required()
@inject
def GetCharges(submission_repo: SubmissionRepository = Provide[Container.submission_repo], project_repo: ProjectRepository = Provide[Container.project_repo]):
    class_id = int(request.args.get("class_id"))
    project = project_repo.get_current_project_by_class(class_id)
    if project is None:
        return make_response(json.dumps({
            "error": f"No current project found for class_id {class_id}"
        }), HTTPStatus.NOT_FOUND)
    projectId = project.Id
    base_charge, reward_charge = submission_repo.get_charges(current_user.Id, class_id, projectId)

    hours_until_recharge = 0
    minutes_until_recharge = 0
    seconds_until_recharge = 0
    if base_charge != 3:
        time_until_recharge = submission_repo.get_time_until_recharge(current_user.Id, class_id, projectId)
        # Convert time_until_recharge to hours, minutes, and seconds
        hours_until_recharge, remainder = divmod(time_until_recharge.total_seconds(), 3600)
        minutes_until_recharge, seconds_until_recharge = divmod(remainder, 60)

    return make_response(json.dumps({
        "baseCharge": base_charge,
        "rewardCharge": reward_charge,
        "HoursUntilRecharge": str(hours_until_recharge),
        "MinutesUntilRecharge": str(minutes_until_recharge),
        "SecondsUntilRecharge": str(seconds_until_recharge)
    }), HTTPStatus.OK)

@submission_api.route('/ConsumeCharge', methods=['GET'])
@jwt_required()
@inject
def ConsumeCharge(submission_repo: SubmissionRepository = Provide[Container.submission_repo], project_repo: ProjectRepository = Provide[Container.project_repo]):
    try:
        class_id = int(request.args.get("class_id"))
        projectId = project_repo.get_current_project_by_class(class_id).Id
        submission_repo.consume_reward_charge(current_user.Id, class_id, projectId)
    except Exception as e:
        print("Error: ", e, flush=True)
        return make_response("Error: " + str(e), HTTPStatus.INTERNAL_SERVER_ERROR)
    return make_response("Charge Consumed", HTTPStatus.OK)

@submission_api.route('/log_ui', methods=['POST'])
@jwt_required()
def log_ui_click():
    data = request.get_json(silent=True) or {}
    submission_id = data.get('id', -1)
    action = str(data.get('action', '')).strip()
    started_state = data.get('started_state', None)
    switched_to = data.get('switched_to', None)

    username = getattr(current_user, 'Username', None) or 'unknown'
    role = getattr(current_user, 'Role', None) or 0

    ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    log_path = ui_clicks_log
    os.makedirs(os.path.dirname(log_path), exist_ok=True)

    line = f"{ts} | user:{username} | role:{role} | submission:{submission_id} | action:{action}"
    if action == 'Diff Finder':
        line += f" | switched_to:{bool(switched_to)} | started:{bool(started_state)}"
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
    grade = input_json.get('grade')
    scoring_mode = input_json.get('scoringMode')
    error_points = input_json.get('errorPoints')
    error_defs = input_json.get('errorDefs')
    errors = input_json.get('errors')  # Expecting list: [{startLine,endLine,errorId,count}, ...]
    success = submission_repo.save_manual_grading(submission_id, grade, scoring_mode, error_points, errors, error_defs)

    # 3. Respond to the frontend
    if success:
        return make_response(json.dumps({'success': True, 'msg': 'Grading saved'}), HTTPStatus.OK)
    else:
        return make_response("Failed to save grading", HTTPStatus.INTERNAL_SERVER_ERROR)

@submission_api.route('/get-grading/<int:submission_id>', methods=['GET'])
@jwt_required()
@inject
def get_grading(submission_id, submission_repo: SubmissionRepository = Provide[Container.submission_repo]):
    
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
    if(current_user.Role != ADMIN_ROLE):
        return make_response("Not Authorized", HTTPStatus.UNAUTHORIZED)

    project_id = int(request.args.get("project_id"))

    grade_list = submission_repo.get_project_grade_info(project_id)
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