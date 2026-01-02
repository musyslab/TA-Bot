import ast
from collections import defaultdict
from io import BytesIO
import json
import os
import re
import shutil
import subprocess
import os.path
from typing import List
import zipfile
import stat
import sys

import requests

from subprocess import Popen
from src.repositories.class_repository import ClassRepository
from src.repositories.user_repository import UserRepository
from src.repositories.submission_repository import SubmissionRepository
from flask import Blueprint, Response, send_file, current_app
from flask import make_response
from http import HTTPStatus
from injector import inject
from flask_jwt_extended import jwt_required
from flask_jwt_extended import current_user
from src.repositories.project_repository import ProjectRepository
from src.services.dataService import all_submissions 
from src.models.ProjectJson import ProjectJson
from src.constants import ADMIN_ROLE
from flask import jsonify
from flask import request
from dependency_injector.wiring import inject, Provide
from container import Container
from datetime import datetime
import itertools
import importlib.util
from werkzeug.utils import secure_filename
from urllib.parse import quote

projects_api = Blueprint('projects_api', __name__)

ALLOWED_SOURCE_EXTS = {'.py', '.c', '.java', '.rkt'}

def project_root() -> str:
    return "/ta-bot/project-files"

def teacher_root() -> str:
    return os.path.join(project_root(), "teacher-files")

def student_root() -> str:
    return os.path.join(project_root(), "student-files")

def project_dir(base_proj: str, ts: str) -> str:
    # teacher-files/<YYYYMMDD_HHMMSS>__<projectname>
    return os.path.join(teacher_root(), f"{ts}__{base_proj}")

def extract_ts(name: str, base_proj: str) -> str:
    """
    Extract timestamp "YYYYMMDD_HHMMSS" from the **new** naming scheme:
      "{ts}__{file}__{base_proj}[.ext]"
    """
    if f"__{base_proj}" not in name:
        return ""
    first_seg = name.split("__", 1)[0]
    if (
        len(first_seg) == 15 and first_seg[8] == "_" and
        first_seg[:8].isdigit() and first_seg[9:].isdigit()
    ):
        return first_seg
    return ""

# NEW: restrict which entries can be considered solutions
def is_solution_candidate(entry: str, full: str) -> bool:
    # never treat assignment descriptions or export folders as solutions
    if entry.startswith("assignment__"):
        return False
    if "-out" in entry:
        return False
    # extracted ZIPs are directories; accept them
    if os.path.isdir(full):
        return True
    # otherwise, only allow source files
    _, ext = os.path.splitext(entry)
    return ext.lower() in ALLOWED_SOURCE_EXTS


def pick_latest_solution(proj_dir: str, base_proj: str):
    """Return absolute path to the newest (by embedded timestamp) solution file/dir in proj_dir."""
    try:
        best_ts = ""
        best_path = None
        for entry in os.listdir(proj_dir):
            full = os.path.join(proj_dir, entry)
            if not is_solution_candidate(entry, full):
                continue
            ts = extract_ts(entry, base_proj) 
            if not ts:
                continue
            if best_ts == "" or ts > best_ts:
                best_ts = ts
                best_path = full
        return best_path
    except Exception:
        return None

def collect_files_for_piston(root_path: str, language: str, preferred_first: str | None = None):
     """
     Build the `files` payload for Piston.
     - If `root_path` is a file, send that single file.
     - If it's a directory, include relevant sources; for Java, put the main class first if found.
     - If `preferred_first` is provided, put that file first and rename it to Piston's expected
       entrypoint name (e.g., main.py / Main.java / main.c / main.cpp / main.rkt) in the payload.
     """
     def read_file(path: str) -> str:
         with open(path, "r", encoding="utf-8", errors="replace") as f:
             return f.read()
     # allow a few extras that are commonly needed at build time
     extra_exts = {".h", ".hpp", ".cpp", ".scm"}  # headers, C++, Scheme
     def entry_name_for(language: str, path: str) -> str:
         lang = (language or "").lower()
         _, ext = os.path.splitext(path)
         if "java" in lang:
             return "Main.java"
         if "c++" in lang or "cpp" in lang:
             return "main.cpp"
         if lang == "c":
             return "main.c"
         if "racket" in lang or "scheme" in lang:
             return "main.rkt"
         return "main.py"
     if os.path.isfile(root_path):
         actual = preferred_first if (preferred_first and os.path.isfile(preferred_first)) else root_path
         return [{"name": entry_name_for(language, actual), "content": read_file(actual)}]
     java_mains, regular = [], []
     preferred_blob = None
     for base, _, fnames in os.walk(root_path):
         for fname in fnames:
             full = os.path.join(base, fname)
             _, ext = os.path.splitext(fname)
             if (ext.lower() in ALLOWED_SOURCE_EXTS) or (ext.lower() in extra_exts):
                 content = read_file(full)
                 if preferred_first and os.path.abspath(full) == os.path.abspath(preferred_first):
                     preferred_blob = {"name": entry_name_for(language, full), "content": content}
                 elif "java" in (language or "").lower() and "public static void main(" in content:
                     java_mains.append({"name": os.path.basename(full), "content": content})
                 else:
                     regular.append({"name": os.path.basename(full), "content": content})
     ordered = []
     if preferred_blob:
         ordered.append(preferred_blob)
     ordered.extend(java_mains)
     ordered.extend(regular)
     return ordered

@projects_api.route('/all_projects', methods=['GET'])
@jwt_required()
@inject
def all_projects(project_repo: ProjectRepository = Provide[Container.project_repo], submission_repo: SubmissionRepository = Provide[Container.submission_repo]):
    if current_user.Role != ADMIN_ROLE:
        message = {
            'message': 'Access Denied'
        }
        return make_response(message, HTTPStatus.UNAUTHORIZED)
    data = project_repo.get_all_projects()
    new_projects = []
    thisdic = submission_repo.get_total_submission_for_all_projects()
    for proj in data:
        new_projects.append(ProjectJson(proj.Id, proj.Name, proj.Start.strftime("%x %X"), proj.End.strftime("%x %X"), thisdic[proj.Id]).toJson())
    return jsonify(new_projects)


@projects_api.route('/list_solution_files', methods=['GET'])
@jwt_required()
@inject
def list_solution_files(project_repo: ProjectRepository = Provide[Container.project_repo]):
    if current_user.Role != ADMIN_ROLE:
        return make_response({'message': 'Access Denied'}, HTTPStatus.UNAUTHORIZED)

    pid_str = (request.args.get("id", "") or "").strip()
    if not pid_str.isdigit():
        return make_response([], HTTPStatus.OK)
    pid = int(pid_str)

    p = project_repo.get_project_path(pid)
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
    if current_user.Role != ADMIN_ROLE:
        return make_response({'message': 'Access Denied'}, HTTPStatus.UNAUTHORIZED)

    data = request.get_json(silent=True) or {}
    pid = int(str(data.get('project_id', 0)) or 0)
    class_id = str(data.get('class_id', '')).strip()
    start_s = str(data.get('start_date', '')).strip()
    end_s = str(data.get('end_date', '')).strip()

    if not class_id or not start_s or not end_s:
        return make_response({'message': 'Missing required fields'}, HTTPStatus.BAD_REQUEST)

    try:
        start_dt = datetime.fromisoformat(start_s)
        end_dt = datetime.fromisoformat(end_s)
    except ValueError:
        return make_response({'message': 'Invalid datetime format'}, HTTPStatus.BAD_REQUEST)

    conflicts = []
    try:
        projects = project_repo.get_projects_by_class_id(class_id)
        for p in projects:
            if getattr(p, 'Id', None) == pid:
                continue
            p_start = getattr(p, 'Start', None)
            p_end = getattr(p, 'End', None)
            if not p_start or not p_end:
                continue
            # strict overlap: allows back-to-back intervals without conflict
            if (start_dt < p_end) and (p_start < end_dt):
                conflicts.append({
                    'id': getattr(p, 'Id', None),
                    'name': getattr(p, 'Name', ''),
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
    if current_user.Role != ADMIN_ROLE:
        message = {
            'message': 'Access Denied'
        }
        return make_response(message, HTTPStatus.UNAUTHORIZED)
    
    input_json = request.get_json()
    projectid = input_json['project_id']

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

@projects_api.route('/submission-by-user-most-recent-project', methods=['GET'])
@jwt_required()
@inject
def get_submission_by_user_most_recent_project(project_repo: ProjectRepository = Provide[Container.project_repo], submission_repo: SubmissionRepository = Provide[Container.submission_repo]):
    projectId = str(request.args.get("projectId"))
    subs = submission_repo.get_most_recent_submission_by_project(projectId, [current_user.Id])
    temp =[]
    temp.append(subs[current_user.Id].Id)
    return make_response(json.dumps(temp), HTTPStatus.OK)
    


@projects_api.route('/create_project', methods=['POST'])
@jwt_required()
@inject
def create_project(project_repo: ProjectRepository = Provide[Container.project_repo]):

    def ts_str() -> str:
        return datetime.now().strftime("%Y%m%d_%H%M%S")

    def safe_name(s: str) -> str:
        # normalize and remove unsafe chars; also collapse spaces
        return secure_filename(s or "").replace(" ", "_")

    if current_user.Role != ADMIN_ROLE:
        return make_response({'message': 'Access Denied'}, HTTPStatus.UNAUTHORIZED)

    # Validate solution files (multi-file)
    solution_uploads = request.files.getlist('solutionFiles')
    solution_uploads = [f for f in solution_uploads if f and f.filename]
    if not solution_uploads:
        return make_response({'message': 'No selected solution files'}, HTTPStatus.BAD_REQUEST)
    if 'assignmentdesc' not in request.files or not request.files['assignmentdesc'].filename:
        return make_response({'message': 'No assignment description file'}, HTTPStatus.BAD_REQUEST)

    # Read form
    name = request.form.get('name', '')
    start_date = request.form.get('start_date', '')
    end_date = request.form.get('end_date', '')
    language = request.form.get('language', '')
    class_id = request.form.get('class_id', '')
    if name == '' or start_date == '' or end_date == '' or language == '':
        return make_response("Error in form", HTTPStatus.BAD_REQUEST)

    base_proj = safe_name(name)
    ts = ts_str()
    proj_dir_path = project_dir(base_proj, ts)
    os.makedirs(proj_dir_path, exist_ok=True)

    # Save multi-file solution into a timestamped solution directory
    sol_dir_name = f"{ts}__solution__{base_proj}"
    path = os.path.join(proj_dir_path, sol_dir_name)
    os.makedirs(path, exist_ok=True)
    for up in solution_uploads:
        orig = safe_name(up.filename)
        ext = os.path.splitext(orig)[1].lower()
        if ext not in ALLOWED_SOURCE_EXTS:
            return make_response({'message': f'Unsupported file type: {ext}'}, HTTPStatus.BAD_REQUEST)
        dst = os.path.join(path, orig)
        up.save(dst)

    # Save assignment description using the same naming scheme as solutions:
    # "{ts}__{file}__{base_proj}[.ext]"
    ad = request.files['assignmentdesc']
    ad_base = os.path.splitext(safe_name(ad.filename or "assignment"))[0]
    ad_ext = os.path.splitext(ad.filename or "")[1] or ".pdf"
    ad_name = f"{ts}__{ad_base}__{base_proj}{ad_ext}"
    assignmentdesc_path = os.path.join(proj_dir_path, ad_name)
    ad.save(assignmentdesc_path)

    # Multiple additional files (preserve original filenames; no renaming)
    add_paths = []
    for add_up in request.files.getlist('additionalFiles'):
        if add_up and add_up.filename:
            orig_name = safe_name(add_up.filename)
            dst = os.path.join(proj_dir_path, orig_name)
            add_up.save(dst)
            add_paths.append(dst)
    # Use the just-uploaded path directly; avoid directory scan on create
    selected_path = path
    new_project_id = project_repo.create_project(
        name, start_date, end_date, language, class_id,
        selected_path, assignmentdesc_path, json.dumps(add_paths)
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

    if current_user.Role != ADMIN_ROLE:
        return make_response({'message': 'Access Denied'}, HTTPStatus.UNAUTHORIZED)

    pid_str = request.form.get("id", "").strip()
    if not pid_str.isdigit():
        return make_response({'message': 'Invalid or missing project id'}, HTTPStatus.BAD_REQUEST)
    pid = int(pid_str)

    name = request.form.get('name', '')
    start_date = request.form.get('start_date', '')
    end_date = request.form.get('end_date', '')
    language = request.form.get('language', '')
    if name == '' or start_date == '' or end_date == '' or language == '':
        return make_response("Error in form", HTTPStatus.BAD_REQUEST)

    # Ensure base_proj exists before any use (fix NameError) and compute project folder
    base_proj = safe_name(name)
    ts = ts_str()
    existing_path = project_repo.get_project_path(pid)
    if existing_path:
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

    # If new solution file(s) were uploaded, save as a new timestamped solution directory
    solution_uploads = request.files.getlist('solutionFiles')
    solution_uploads = [f for f in solution_uploads if f and f.filename]
    solution_changed = False
    if solution_uploads:
        sol_dir_name = f"{ts}__solution__{base_proj}"
        path = os.path.join(proj_dir, sol_dir_name)
        os.makedirs(path, exist_ok=True)
        for up in solution_uploads:
            orig = safe_name(up.filename)
            ext = os.path.splitext(orig)[1].lower()
            if ext not in ALLOWED_SOURCE_EXTS:
                return make_response({'message': f'Unsupported file type: {ext}'}, HTTPStatus.BAD_REQUEST)
            dst = os.path.join(path, orig)
            up.save(dst)
        # Note: we DO NOT delete the prior directory; this preserves history.
        solution_changed = True

    # If a new assignment description was uploaded, save with a unique name
    ad = request.files.get('assignmentdesc')
    if ad and ad.filename:
        ad_base = os.path.splitext(safe_name(ad.filename or "assignment"))[0]
        ad_ext = os.path.splitext(ad.filename or "")[1] or ".pdf"
        assignmentdesc_path = os.path.join(proj_dir, f"{ts}__{ad_base}__{base_proj}{ad_ext}")
        ad.save(assignmentdesc_path)

    # Multiple additional files: load current list, remove/clear, then append new uploads
    existing_add = getattr(existing_proj, "AdditionalFilePath", "") if existing_proj else ""
    try:
        add_paths = json.loads(existing_add) if (existing_add or "").startswith('[') else ([existing_add] if existing_add else [])
    except Exception:
        add_paths = []
    clear_add = (request.form.get('clearAdditionalFiles', '').strip().lower() == 'true')
    remove_add = request.form.get('removeAdditionalFiles', '').strip()
    try:
        to_remove = json.loads(remove_add) if remove_add else []
    except Exception:
        to_remove = []
    additional_file_changed = False
    # Remove selected files (match by basename)
    if to_remove:
        keep = []
        for p in add_paths:
            bn = os.path.basename(p)
            if bn in to_remove:
                try:
                    os.remove(p)
                except Exception:
                    pass
                additional_file_changed = True
            else:
                keep.append(p)
        add_paths = keep
    # Clear all
    if clear_add and add_paths:
        for p in add_paths:
            try:
                os.remove(p)
            except Exception:
                pass
        add_paths = []
        additional_file_changed = True
    # Append newly uploaded additional files
    for add_up in request.files.getlist('additionalFiles'):
        if add_up and add_up.filename:
            orig_name = safe_name(add_up.filename)
            dst = os.path.join(proj_dir, orig_name)
            add_up.save(dst)
            add_paths.append(dst)
            additional_file_changed = True

    # Always point the project at the newest solution inside its folder
    latest = pick_latest_solution(proj_dir, base_proj)
    if latest:
        path = latest

    project_repo.edit_project(
        name, start_date, end_date, language, pid,
        path, assignmentdesc_path, json.dumps(add_paths)
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
    Execute code strictly via /ta-bot/grading-scripts/tabot.py (ADMIN path).
    Returns stdout (or stderr) with normalized newlines, or "" on failure.
    """
    if not solution_root or not os.path.exists(solution_root):
        return ""
    script = "/ta-bot/grading-scripts/tabot.py"
    args = [
        "python", script,
        "ADMIN",              # student_name triggers admin path
        language or "python", # language as tabot expects
        input_text or "",     # goes to admin_run(user_input)
        solution_root,        # file or directory
        additional_file_path or "",  # additional_file_path
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

    grading_dir = "/ta-bot/grading-scripts"
    grading_path = os.path.join(grading_dir, "tabot.py")

    spec = importlib.util.spec_from_file_location("tabot", grading_path)
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

def recompute_expected_outputs(project_repo, project_id, *, solution_override_path: str = None, language_override: str = None):    
    
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

    cases = project_repo.get_testcases(str(project_id))

    # Determine class id (needed by repo call)
    class_id = getattr(proj_obj, "ClassId", 0) if proj_obj else 0
    if not class_id:
        try:
            cname = project_repo.get_className_by_projectId(str(project_id))
            class_id = project_repo.get_class_id_by_name(cname)
        except Exception:
            class_id = 0

    for tc_id, vals in cases.items():
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
            )
        except Exception:
            # continue on individual failures
            continue

@projects_api.route('/list_source_files', methods=['GET'])
@jwt_required()
@inject
def list_source_files(project_repo: ProjectRepository = Provide[Container.project_repo]):
    """Return list of previewable source files for a project (relative paths if a directory)."""
    if current_user.Role != ADMIN_ROLE:
        return make_response({'message': 'Access Denied'}, HTTPStatus.UNAUTHORIZED)

    pid = request.args.get('project_id', '')
    if not pid:
        return make_response({'message': 'Missing project_id'}, HTTPStatus.BAD_REQUEST)

    root = project_repo.get_project_path(pid)  # absolute path previously saved
    if not root or not os.path.exists(root):
        return make_response({'message': 'Project path not found'}, HTTPStatus.NOT_FOUND)

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
    if current_user.Role != ADMIN_ROLE:
        return make_response({'message': 'Access Denied'}, HTTPStatus.UNAUTHORIZED)

    pid = request.args.get('project_id', '')
    relpath = request.args.get('relpath', '')
    if not pid:
        return make_response({'message': 'Missing project_id'}, HTTPStatus.BAD_REQUEST)

    root = project_repo.get_project_path(pid)
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
    if current_user.Role != ADMIN_ROLE:
        message = {
            'message': 'Access Denied'
        }
        return make_response(message, HTTPStatus.UNAUTHORIZED)
    project_info=project_repo.get_project(request.args.get('id'))
    return make_response(json.dumps(project_info), HTTPStatus.OK)
    
@projects_api.route('/get_testcases', methods=['GET'])
@jwt_required()
@inject
def get_testcases(project_repo: ProjectRepository = Provide[Container.project_repo]):
    if current_user.Role != ADMIN_ROLE:
        message = {
            'message': 'Access Denied'
        }
        return make_response(message, HTTPStatus.UNAUTHORIZED)

    project_id = request.args.get('id')
    testcases = project_repo.get_testcases(project_id)

    return make_response(json.dumps(testcases), HTTPStatus.OK)


@projects_api.route('/json_add_testcases', methods=['POST'])
@jwt_required()
@inject   
def json_add_testcases(project_repo: ProjectRepository = Provide[Container.project_repo]):
    if current_user.Role != ADMIN_ROLE:
        message = {
            'message': 'Access Denied'
        }
        return make_response(message, HTTPStatus.UNAUTHORIZED)

    file = request.files['file']
    project_id = request.form["project_id"]
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
                class_id
            )

    return make_response("Testcase Added", HTTPStatus.OK)

@projects_api.route('/add_or_update_testcase', methods=['POST'])
@jwt_required()
@inject   
def add_or_update_testcase(project_repo: ProjectRepository = Provide[Container.project_repo]):
    if current_user.Role != ADMIN_ROLE:
        message = {
            'message': 'Access Denied'
        }
        return make_response(message, HTTPStatus.UNAUTHORIZED)

    # Grab all fields safely (defaults prevent NameError)
    id_val = request.form.get('id', '').strip()
    name = request.form.get('name', '').strip()
    input_data = request.form.get('input', '')
    output = request.form.get('output', '')
    project_id = request.form.get('project_id', '').strip()
    description = request.form.get('description', '').strip()
    class_id = request.form.get('class_id', '').strip()
    
    if id_val == '' or name == '' or input_data == '' or project_id == '' or description == '' or class_id == '':
        return make_response("Error in form", HTTPStatus.BAD_REQUEST)    

    # Coerce types with validation
    try:
        project_id = int(project_id)
        id_val = int(id_val)
        class_id_int = int(class_id)
    except ValueError:
        return make_response("Invalid numeric id", HTTPStatus.BAD_REQUEST)

    # Auto-recompute expected output when editing a testcase.
    # If the project's language is Python, run the saved solution with the new input
    # and overwrite the provided `output` with the program's stdout.
    try:
        project = project_repo.get_selected_project(int(project_id))
        language = (getattr(project, "Language", "") or "")
        solution_root = (getattr(project, "solutionpath", "") or "")
        add_path = getattr(project, "AdditionalFilePath", "") if project else ""
        output = run_solution_for_input(solution_root, language, input_data, int(project_id), int(class_id_int), add_path)
    except Exception:
        # Fall back to the submitted output if recomputation fails
        pass

    project_repo.add_or_update_testcase(project_id, id_val, name, description, input_data, output, class_id_int)

    return make_response("Testcase Added", HTTPStatus.OK)
    


@projects_api.route('/remove_testcase', methods=['POST'])
@jwt_required()
@inject
def remove_testcase(project_repo: ProjectRepository = Provide[Container.project_repo]):
    if current_user.Role != ADMIN_ROLE:
        message = {
            'message': 'Access Denied'
        }
        return make_response(message, HTTPStatus.UNAUTHORIZED)

    if 'id' in request.form:
        id_val=request.form['id']
    project_repo.remove_testcase(id_val)
    return make_response("Testcase Removed", HTTPStatus.OK)
    
@projects_api.route('/get_projects_by_class_id', methods=['GET'])
@jwt_required()
@inject
def get_projects_by_class_id(project_repo: ProjectRepository = Provide[Container.project_repo], submission_repo: SubmissionRepository = Provide[Container.submission_repo]):
    data = project_repo.get_projects_by_class_id(request.args.get('id'))
    
    new_projects = []
    thisdic = submission_repo.get_total_submission_for_all_projects()
    for proj in data:
        new_projects.append(ProjectJson(proj.Id, proj.Name, proj.Start.strftime("%x %X"), proj.End.strftime("%x %X"), thisdic[proj.Id]).toJson())
    return jsonify(new_projects)

@projects_api.route('/delete_project', methods=['POST', 'DELETE'])
@jwt_required()
@inject
def delete_project(project_repo: ProjectRepository = Provide[Container.project_repo], submission_repo: SubmissionRepository = Provide[Container.submission_repo]):
    if current_user.Role != ADMIN_ROLE:
        message = {
            'message': 'Access Denied'
        }
        return make_response(message, HTTPStatus.UNAUTHORIZED)
    project_id = request.args.get('id')
    
    project_repo.wipe_submissions(project_id)
    
    project_repo.delete_project(project_id)
    
    return make_response("Project reset", HTTPStatus.OK)

@projects_api.route('/getAssignmentDescription', methods=['GET'])
@jwt_required()
@inject
def getAssignmentDescription(project_repo: ProjectRepository = Provide[Container.project_repo]):
    
    project_id = request.args.get('project_id')
    assignmentdesc_contents = project_repo.get_project_desc_file(project_id)
    assignmentdesc_path = project_repo.get_project_desc_path(project_id)
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

@projects_api.route('/ProjectGrading', methods=['POST'])
@jwt_required()
@inject
def ProjectGrading(submission_repo: SubmissionRepository = Provide[Container.submission_repo], project_repo: ProjectRepository = Provide[Container.project_repo], class_repo: ClassRepository = Provide[Container.class_repo], user_repo: UserRepository = Provide[Container.user_repo]):
    if current_user.Role != ADMIN_ROLE:
        message = {
            'message': 'You do not have permission to do this!'
        }
        return make_response(message, HTTPStatus.FORBIDDEN)

    input_json = request.get_json()
    project_id = input_json['ProjectId']
    user_id = input_json['userID']

    submissions = submission_repo.get_most_recent_submission_by_project(project_id, [user_id])

    test_info = []
    grading_data = {}
    student_code = ""
    project_language = project_repo.get_selected_project(project_id).Language

    if user_id in submissions:
        student_code = submission_repo.read_code_file(submissions[user_id].CodeFilepath)
        student_output = submission_repo.read_output_file(submissions[user_id].OutputFilepath)

        current_test = None
        in_test = False
        in_diag = False
        in_output = False
        output_lines: list[str] = []

        Q = r"([^']*(?:''[^']*)*)"
        name_re = re.compile(rf"name:\s*'{Q}'")
        output_item_re = re.compile(rf"^-\s*'{Q}'\s*$")

        for raw_line in student_output.splitlines():
            line = raw_line.rstrip("\r\n")
            s = line.strip()

            if s.startswith("TAP version"):
                continue

            if s.startswith("ok") or s.startswith("not ok"):
                if in_test and current_test and in_output:
                    current_test['output'] = output_lines[:]
                    test_info.append(current_test)

                in_test = True
                in_diag = False
                in_output = False
                output_lines = []
                current_test = {
                    'name': None,
                    'passed': s.startswith('ok'),
                    'State': s.startswith('ok'),  
                    'output': []  
                }
                continue

            if not in_test:
                continue

            if s == '---':
                in_diag = True
                continue
            if s == '...':
                if current_test is not None:
                    current_test['output'] = output_lines[:]
                    test_info.append(current_test)
                in_test = False
                in_diag = False
                in_output = False
                output_lines = []
                current_test = None
                continue

            if not in_diag:
                continue

            if not in_output:
                m = name_re.search(s)
                if m and current_test is not None:
                    current_test['name'] = m.group(1).replace("''", "'")
                    continue
                if s.startswith('output:'):
                    in_output = True
                    output_lines = []
                    continue
            else:
                m = output_item_re.match(s)
                if m:
                    item = m.group(1).replace("''", "'")
                    output_lines.append(item)

        grading_data[user_id] = [student_code, test_info]
    else:
        grading_data[user_id] = ["", ""]

    return make_response(json.dumps({"Code": student_code, "TestResults": test_info, "Language": project_language}), HTTPStatus.OK)


@projects_api.route('/unlockStudentAccount', methods=['POST'])
@jwt_required()
@inject
def unlockStudentAccount(user_repo: UserRepository = Provide[Container.user_repo]):
    if current_user.Role != ADMIN_ROLE:
        message = {
            'message': 'You do not have permission to do this!'
        }
        return make_response(message, HTTPStatus.FORBIDDEN)
    input_json = request.get_json()
    user_Id = input_json['UserId']
    user_repo.unlock_student_account(user_Id)
    message = {
        'message': 'Success'
    }
    return make_response(message, HTTPStatus.OK)