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
from src.services.link_service import LinkService
import itertools

from werkzeug.utils import secure_filename

PISTON_URL = "https://emkc.org/api/v2/piston/execute"

projects_api = Blueprint('projects_api', __name__)

ALLOWED_SOURCE_EXTS = {'.py', '.c', '.java', '.rkt'}

def _project_root() -> str:
    return "/ta-bot/project-files"

def _teacher_root() -> str:
    return os.path.join(_project_root(), "teacher-files")

def _student_root() -> str:
    return os.path.join(_project_root(), "student-files")

def _tmp_root() -> str:
    return os.path.join(_project_root(), "tmp")

def _project_dir(base_proj: str, ts: str) -> str:
    # teacher-files/<YYYYMMDD_HHMMSS>__<projectname>
    return os.path.join(_teacher_root(), f"{ts}__{base_proj}")

def _extract_ts(name: str, base_proj: str) -> str:
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
def _is_solution_candidate(entry: str, full: str) -> bool:
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


def _pick_latest_solution(proj_dir: str, base_proj: str):
    """Return absolute path to the newest (by embedded timestamp) solution file/dir in proj_dir."""
    try:
        best_ts = ""
        best_path = None
        for entry in os.listdir(proj_dir):
            full = os.path.join(proj_dir, entry)
            if not _is_solution_candidate(entry, full):
                continue
            ts = _extract_ts(entry, base_proj)
            if not ts:
                continue
            if best_ts == "" or ts > best_ts:
                best_ts = ts
                best_path = full
        return best_path
    except Exception:
        return None

def _collect_files_for_piston(root_path: str, language: str, preferred_first: str | None = None):
    """
    Build the `files` payload for Piston.
    - If `root_path` is a file, send that single file.
    - If it's a directory, include relevant sources; for Java, put the main class first if found.
    - If `preferred_first` is provided, put that file first and rename it to Piston's expected
      entrypoint name (e.g., main.py / Main.java / main.c / main.cpp / main.rkt) in the payload.
    """

    def _read(path):
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            return f.read()

    # allow a few extras that are commonly needed at build time
    extra_exts = {".h", ".hpp", ".cpp", ".scm"}  # headers, C++, Scheme

    files = []

    def _entry_name_for(language: str, path: str) -> str:
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
        # default python
        return "main.py"

    if os.path.isfile(root_path):
        # If a specific entrypoint is passed, use its content/name; otherwise root_path is the file
        actual = preferred_first if (preferred_first and os.path.isfile(preferred_first)) else root_path
        return [{
            "name": _entry_name_for(language, actual),
            "content": _read(actual)
        }]

    # directory: gather
    java_mains, regular = [], []
    preferred_blob = None
    for base, _, fnames in os.walk(root_path):
        for fname in fnames:
            full = os.path.join(base, fname)
            _, ext = os.path.splitext(fname)
            if (ext.lower() in ALLOWED_SOURCE_EXTS) or (ext.lower() in extra_exts):
                content = _read(full)
                if preferred_first and os.path.abspath(full) == os.path.abspath(preferred_first):
                    preferred_blob = {"name": _entry_name_for(language, full), "content": content}
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

@projects_api.route('/run-moss', methods=['POST'])
@jwt_required()
@inject
def run_moss(user_repo: UserRepository = Provide[Container.user_repo], submission_repo: SubmissionRepository = Provide[Container.submission_repo]):
    if current_user.Role != ADMIN_ROLE:
        message = {
            'message': 'Access Denied'
        }
        return make_response(message, HTTPStatus.UNAUTHORIZED)
    
    input_json = request.get_json()
    projectid = input_json['project_id']

    userId=current_user.Id
    all_submissions(projectid, userId, submission_repo, user_repo)
    
    return make_response("Done, the results should appear in your email within 24 hours. Please only run this call once a day. NOTE: PLEASE CHECK JUNK FOLDER ", HTTPStatus.OK)
    
    
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
            student_submissions[project.Name]=[sub.Id, sub.Points, sub.Time.strftime("%x %X"), class_name, str(project.ClassId)]
    return make_response(json.dumps(student_submissions), HTTPStatus.OK)

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

    def _ts() -> str:
        return datetime.now().strftime("%Y%m%d_%H%M%S")

    def _safe(s: str) -> str:
        # normalize and remove unsafe chars; also collapse spaces
        return secure_filename(s or "").replace(" ", "_")

    if current_user.Role != ADMIN_ROLE:
        return make_response({'message': 'Access Denied'}, HTTPStatus.UNAUTHORIZED)

    # Validate files
    if 'file' not in request.files or not request.files['file'].filename:
        return make_response({'message': 'No selected file'}, HTTPStatus.BAD_REQUEST)
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

    os.makedirs(_teacher_root(), exist_ok=True)
    os.makedirs(_student_root(), exist_ok=True)
    os.makedirs(_tmp_root(), exist_ok=True)

    up = request.files['file']
    base_prog = os.path.splitext(_safe(up.filename))[0]  
    base_proj = _safe(name)
    ts = _ts()
    proj_dir = _project_dir(base_proj, ts)
    os.makedirs(proj_dir, exist_ok=True)

    # Save solution/program file
    filename = up.filename
    ext = os.path.splitext(filename)[1].lower()
    if ext == ".zip":
        # unique directory for extracted zip, inside the project folder
        dir_name = f"{ts}__{base_prog}__{base_proj}"
        path = os.path.join(proj_dir, dir_name)
        os.makedirs(path, exist_ok=True)
        try:
            # Ensure we read the uploaded stream from the beginning
            up.stream.seek(0)
            with zipfile.ZipFile(up.stream) as zip_ref:
                zip_ref.extractall(path)
        except zipfile.BadZipFile:
            return make_response({'message': 'Uploaded ZIP is invalid'}, HTTPStatus.BAD_REQUEST)
    elif ext in ALLOWED_SOURCE_EXTS:
        unique_name = f"{ts}__{base_prog}__{base_proj}{ext}"
        path = os.path.join(proj_dir, unique_name)
        up.save(path)
    else:
        return make_response({'message': f'Unsupported file type: {ext}'}, HTTPStatus.BAD_REQUEST)

    # Save assignment description using the same naming scheme as solutions:
    # "{ts}__{file}__{base_proj}[.ext]"
    ad = request.files['assignmentdesc']
    ad_base = os.path.splitext(_safe(ad.filename or "assignment"))[0]
    ad_ext = os.path.splitext(ad.filename or "")[1] or ".pdf"
    ad_name = f"{ts}__{ad_base}__{base_proj}{ad_ext}"
    assignmentdesc_path = os.path.join(proj_dir, ad_name)
    ad.save(assignmentdesc_path)

    # Always record the newest (by embedded timestamp) solution in the project folder
    selected_path = _pick_latest_solution(proj_dir, base_proj) or path
    project_repo.create_project(name, start_date, end_date, language, class_id, selected_path, assignmentdesc_path)
    
    new_project_id = project_repo.get_project_id_by_name(name)
    project_repo.levels_creator(new_project_id)
    return make_response(str(new_project_id), HTTPStatus.OK)

@projects_api.route('/edit_project', methods=['POST'])
@jwt_required()
@inject
def edit_project(project_repo: ProjectRepository = Provide[Container.project_repo]):

    def _ts() -> str:
        return datetime.now().strftime("%Y%m%d_%H%M%S")

    def _safe(s: str) -> str:
        return secure_filename(s or "").replace(" ", "_")

    if current_user.Role != ADMIN_ROLE:
        return make_response({'message': 'Access Denied'}, HTTPStatus.UNAUTHORIZED)

    pid = request.form.get("id", "")
    name = request.form.get('name', '')
    start_date = request.form.get('start_date', '')
    end_date = request.form.get('end_date', '')
    language = request.form.get('language', '')
    if name == '' or start_date == '' or end_date == '' or language == '':
        return make_response("Error in form", HTTPStatus.BAD_REQUEST)

    # Ensure base_proj exists before any use (fix NameError) and compute project folder
    base_proj = _safe(name)
    ts = _ts()
    existing_path = project_repo.get_project_path(pid)
    if existing_path:
        proj_dir = os.path.dirname(existing_path)
        # Derive base_proj from folder name if not set: "<timestamp>__<base_proj>"
        if not base_proj:
            folder = os.path.basename(proj_dir)
            if "__" in folder:
                base_proj = folder.split("__", 1)[1]
            else:
                base_proj = _safe(name)
    else:
        proj_dir = _project_dir(base_proj, ts)
    os.makedirs(proj_dir, exist_ok=True)
    os.makedirs(_tmp_root(), exist_ok=True)

    # Default to existing paths if no new files are uploaded
    path = existing_path
    assignmentdesc_path = project_repo.get_project_desc_path(pid)

    # If a new solution/program file was uploaded, save with a unique name
    up = request.files.get('file')
    solution_changed = False
    if up and up.filename:
        base_prog = os.path.splitext(_safe(up.filename))[0]
        ext = os.path.splitext(up.filename)[1].lower()
        if ext != ".zip":
            unique_name = f"{ts}__{base_prog}__{base_proj}{ext}"
            path = os.path.join(proj_dir, unique_name)
            up.save(path)
        else:
            # Keep same "{ts}__{file}__{base_proj}" scheme as creation so _pick_latest_solution works
            dir_name = f"{ts}__{base_prog}__{base_proj}"

            path = os.path.join(proj_dir, dir_name)
            os.makedirs(path, exist_ok=True)

            try:
                up.stream.seek(0)
            except Exception:
                pass
            with zipfile.ZipFile(up.stream) as zip_ref:
                zip_ref.extractall(path)

        # Note: we DO NOT delete the prior file/dir; this preserves history.
        solution_changed = True

    # If a new assignment description was uploaded, save with a unique name
    ad = request.files.get('assignmentdesc')
    if ad and ad.filename:
        ad_base = os.path.splitext(_safe(ad.filename or "assignment"))[0]
        ad_ext = os.path.splitext(ad.filename or "")[1] or ".pdf"
        assignmentdesc_path = os.path.join(proj_dir, f"{ts}__{ad_base}__{base_proj}{ad_ext}")
        ad.save(assignmentdesc_path)

    # Always point the project at the newest solution inside its folder
    latest = _pick_latest_solution(proj_dir, base_proj)
    if latest:
        path = latest

    project_repo.edit_project(name, start_date, end_date, language, pid, path, assignmentdesc_path)

    # Recompute testcase outputs **against the path we just wrote**, so we don't depend on
    # any cached ORM objects or delayed reads.
    try:
        if solution_changed and path:
            _recompute_expected_outputs(
                project_repo,
                int(pid),
                solution_override_path=path,
                language_override=language,
            )
    except Exception as e:
        # Don't block the edit on recompute failures, but surface why outputs didn't refresh.
        import traceback
        print(f"[edit_project] recompute_expected_outputs failed: {e}", flush=True)
        traceback.print_exc()

    return make_response("Project Edited", HTTPStatus.OK)

def _has_allowed_ext(path: str) -> bool:
    return os.path.splitext(path)[1].lower() in ALLOWED_SOURCE_EXTS

def _determine_entrypoint(root_path, language):
    """
    If root_path is a file, return it. If it's a dir, pick a plausible main file.
    Minimal, Python-first heuristic; extend as needed for other languages.
    """
    if not root_path or not os.path.exists(root_path):
        return None
    if os.path.isfile(root_path):
        return root_path
    lang = (language or "").lower()
    preferred_exts = []
    if lang.startswith("py"):
        preferred_exts = [".py"]
    elif "java" in lang:
        preferred_exts = [".java"]
    elif "cpp" in lang or "c++" in lang:
        preferred_exts = [".cpp"]
    elif lang == "c":
        preferred_exts = [".c"]
    elif "racket" in lang or "scheme" in lang:
        preferred_exts = [".rkt", ".scm"]
    # Pass 1: prefer files named like main.*
    for base, _, files in os.walk(root_path):
        for f in files:
            name, ext = os.path.splitext(f)
            if name.lower().startswith("main") and (not preferred_exts or ext.lower() in preferred_exts):
                return os.path.join(base, f)
    # Pass 2: first file matching preferred extension
    for base, _, files in os.walk(root_path):
        for f in files:
            _, ext = os.path.splitext(f)
            if not preferred_exts or ext.lower() in preferred_exts:
                return os.path.join(base, f)
    return None

def _run_solution_for_input(entrypoint, language, input_text, workdir):
    """
    Run the stored solution via Piston and capture stdout.
    Supports python/java/c/cpp/racket (if supported by your Piston instance).
    """
    if not entrypoint or not os.path.exists(entrypoint):
        return ""

    lang = (language or "").lower()
    # map to Piston language keys
    if lang.startswith("py"):
        piston_lang = "python"
    elif "java" in lang:
        piston_lang = "java"
    elif "c++" in lang or "cpp" in lang:
        piston_lang = "cpp"
    elif lang == "c":
        piston_lang = "c"
    elif "racket" in lang or "scheme" in lang:
        piston_lang = "racket"
    else:
        # unknown: try raw string
        piston_lang = language or "python"

    # Build the file list with the resolved entrypoint first to avoid executing stale files
    root_dir = (
        os.path.dirname(entrypoint) if os.path.isfile(entrypoint)
        else (entrypoint if os.path.isdir(entrypoint) else workdir)
    )
    files = _collect_files_for_piston(root_dir, piston_lang, preferred_first=entrypoint)

    if not files:
        return ""

    try:
        payload = {
            "language": piston_lang,
            "version": "*",
            "stdin": input_text or "",
            "files": files
        }
        resp = requests.post(PISTON_URL, json=payload, timeout=30)
        if not resp.ok:
            return ""
        data = resp.json() or {}
        run = data.get("run", {})
        out = run.get("stdout") or run.get("stderr") or ""
        return (out or "").strip()
    except Exception:
        return ""

def _recompute_expected_outputs(project_repo, project_id, *, solution_override_path: str = None, language_override: str = None):
    """
    For each testcase, run the (updated) solution and persist the new output.
    IMPORTANT: preserve the testcase level by resolving level *name* from level *id*
    when the name is not present in repository-returned data.
    """

    # Always fetch the project once (needed for class id, fallback language, etc.)
    try:
        proj_obj = project_repo.get_selected_project(int(project_id))
    except Exception:
        proj_obj = None

    # Prefer the freshly-saved path/language if provided to avoid stale ORM caches.
    if solution_override_path and os.path.exists(solution_override_path):
        solution_root = solution_override_path
        # If caller didn't pass language, fall back to the DB record (when available)
        lang = (language_override or (getattr(proj_obj, "Language", "") if proj_obj else "")).strip()
    else:
        if not proj_obj or not getattr(proj_obj, "solutionpath", None):
            return
        solution_root = getattr(proj_obj, "solutionpath", "")
        lang = getattr(proj_obj, "Language", "")

    entry = _determine_entrypoint(solution_root, lang)

    if not entry:
        return
    workdir = os.path.dirname(entry) if os.path.isfile(entry) else solution_root

    # Fetch testcases: { id: [levelid, name, desc, input, output, isHidden, addpath, (optional) levelname] }
    cases = project_repo.get_testcases(str(project_id))

    # Build a level-id -> level-name map (repo.get_testcases() doesn't include names by default)
    id_to_levelname = {}
    try:
        levels = project_repo.get_levels_by_project(str(project_id))
        for lvl in levels or []:
            # repo objects use .Id / .Name elsewhere in this file
            id_to_levelname[getattr(lvl, "Id", None)] = getattr(lvl, "Name", "")
    except Exception:
        id_to_levelname = {}

    # Determine class id (needed by repo call)
    class_id = getattr(proj_obj, "ClassId", 0) if proj_obj else 0
    if not class_id:
        try:
            cname = project_repo.get_className_by_projectId(str(project_id))
            class_id = project_repo.get_class_id_by_name(cname)
        except Exception:
            class_id = 0

    for tc_id, vals in cases.items():
        if not isinstance(vals, list) or len(vals) < 7:
            continue
        levelid, name, desc, inp, _old_out, is_hidden, addpath = vals[:7]
        existing_levelname = vals[7] if len(vals) > 7 else ""
        # Resolve level name from id if missing
        try:
            lid = int(levelid)
        except Exception:
            lid = None
        resolved_levelname = existing_levelname or id_to_levelname.get(lid, "")

        new_out = _run_solution_for_input(entry, lang, inp, workdir)
        try:
            project_repo.add_or_update_testcase(
                int(project_id),
                int(tc_id),
                resolved_levelname,
                name or "",
                desc or "",
                inp or "",
                new_out,
                bool(is_hidden),
                (addpath or "").strip(),
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
                if _has_allowed_ext(full):
                    rel = os.path.relpath(full, root).replace("\\", "/")
                    files.append({'relpath': rel, 'bytes': os.path.getsize(full)})
    else:
        if _has_allowed_ext(root):
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
    if not _has_allowed_ext(full):
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
    levels = project_repo.get_levels_by_project(project_id)
    for key in testcases:
        value = testcases[key]
        for level in levels:
            if level.Id==value[0]:
                value.append(level.Name)

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
        json_obj = json.load(file)
    except json.JSONDecodeError:
         message = {
            'message': 'Incorrect JSON format'
        }
         return make_response(message, HTTPStatus.INTERNAL_SERVER_ERROR)
    else:
        for testcase in json_obj:
            project_repo.add_or_update_testcase(project_id, -1, testcase["levelname"], testcase["name"], testcase["description"], testcase["input"], testcase["output"], bool(testcase["isHidden"]), testcase["additionalfilepath"])
    return make_response("Testcase Added", HTTPStatus.OK)


@projects_api.route('/add_or_update_testcase', methods=['POST'])
@jwt_required()
@inject   
def add_or_update_testcase(project_repo: ProjectRepository = Provide[Container.project_repo]):
    path = ""
    if current_user.Role != ADMIN_ROLE:
        message = {
            'message': 'Access Denied'
        }
        return make_response(message, HTTPStatus.UNAUTHORIZED)

    # Grab all fields safely (defaults prevent NameError)
    id_val = request.form.get('id', '').strip()
    name = request.form.get('name', '').strip()
    level_name = request.form.get('levelName', '').strip()
    input_data = request.form.get('input', '')
    output = request.form.get('output', '')
    project_id = request.form.get('project_id', '').strip()
    isHidden = request.form.get('isHidden', '').strip()
    description = request.form.get('description', '').strip()
    path = request.form.get('additionalfilepath', '').strip()
    class_id = request.form.get('class_id', '').strip()

    if 'additionalFile' in request.files:
        additionalFile = request.files['additionalFile']
        counter = 1
        path = os.path.join("/ta-bot/project-files", f"duplicatenum({counter}){additionalFile.filename}")
        while os.path.isfile(path):
            path = os.path.join("/ta-bot/project-files", f"duplicatenum({counter}){additionalFile.filename}")
            counter += 1
        additionalFile.save(path)
    else:
        additionalFile = None
    
    if id_val == '' or name == '' or input_data == '' or project_id == '' or isHidden == '' or description == '' or class_id == '':
        return make_response("Error in form", HTTPStatus.BAD_REQUEST)    

    # Coerce types with validation
    try:
        project_id = int(project_id)
        id_val = int(id_val)
        class_id_int = int(class_id)
    except ValueError:
        return make_response("Invalid numeric id", HTTPStatus.BAD_REQUEST)

    isHidden = True if isHidden.lower() == "true" else False  

    # Auto-recompute expected output when editing a testcase.
    # If the project's language is Python, run the saved solution with the new input
    # and overwrite the provided `output` with the program's stdout.
    try:
        project = project_repo.get_selected_project(int(project_id))
        language = (getattr(project, "Language", "") or "")
        solution_root = (getattr(project, "solutionpath", "") or "")
        entrypoint = _determine_entrypoint(solution_root, language)
        if entrypoint:
            workdir = os.path.dirname(entrypoint) if os.path.isfile(entrypoint) else solution_root
            output = _run_solution_for_input(entrypoint, language, input_data, workdir)
    except Exception:
        # Fall back to the submitted output if recomputation fails
        pass

    project_repo.add_or_update_testcase(project_id, id_val, level_name, name, description, input_data, output, isHidden, path, class_id_int)

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


@projects_api.route('/reset_project', methods=['POST', 'DELETE'])
@jwt_required()
@inject
def reset_project(project_repo: ProjectRepository = Provide[Container.project_repo], submission_repo: SubmissionRepository = Provide[Container.submission_repo]):
    if current_user.Role != ADMIN_ROLE:
        message = {
            'message': 'Access Denied'
        }
        return make_response(message, HTTPStatus.UNAUTHORIZED)
    project_id = request.args.get('id')
    project_repo.wipe_submissions(project_id)
    return make_response("Project reset", HTTPStatus.OK)

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

    # Send as a download with the original filename and best-guess MIME type
    return Response(
        file_stream.getvalue(),
        content_type=mime,
        headers={'Content-Disposition': f'attachment; filename={fname}'}
    )

@projects_api.route('/ProjectGrading', methods=['POST'])
@jwt_required()
@inject
def ProjectGrading(submission_repo: SubmissionRepository = Provide[Container.submission_repo], project_repo: ProjectRepository = Provide[Container.project_repo], class_repo: ClassRepository = Provide[Container.class_repo], user_repo: UserRepository = Provide[Container.user_repo], link_service: LinkService = Provide[Container.link_service]):
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
        suite_re = re.compile(rf"suite:\s*'{Q}'")
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
                    'level': None,
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
                m = suite_re.search(s)
                if m and current_test is not None:
                    current_test['level'] = m.group(1).replace("''", "'")
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


#@projects_api.route('/export_project_submissions', methods=['GET'])
#@jwt_required()
#@inject
#def export_project_submissions(project_repo: ProjectRepository = Provide[Container.project_repo], submission_repo: SubmissionRepository = Provide[Container.submission_repo]):
#    if current_user.Role != ADMIN_ROLE:
#        message = {
#            'message': 'Access Denied'
#        }
#        return make_response(message, HTTPStatus.UNAUTHORIZED)

#    project_id = request.args.get('id')
#    project = project_repo.get_selected_project(int(project_id))
#    # Use the project's folder; pick newest out folder inside it, then remove after zipping
#    proj_dir = os.path.dirname(project.solutionpath) if project and getattr(project, "solutionpath", None) else None
#    if not proj_dir or not os.path.isdir(proj_dir):
#        return make_response({'message': 'Project folder not found'}, HTTPStatus.NOT_FOUND)
#    candidates = []
#    for d in os.listdir(proj_dir):
#        full = os.path.join(proj_dir, d)
#        if os.path.isdir(full) and ("-out" in d):
#            candidates.append((os.path.getmtime(full), full))
#    if not candidates:
#        return make_response({'message': 'No exportable submissions found'}, HTTPStatus.NOT_FOUND)
#    candidates.sort(reverse=True)
#    submission_path = candidates[0][1]
#    zip_path = shutil.make_archive(submission_path, 'zip', submission_path)
#    try:
#        shutil.rmtree(submission_path)
#    except Exception:
#        pass
#    return send_file(zip_path, as_attachment=True)

#TODO: Complete this call
@projects_api.route('/getSubmissionSummary', methods=['GET'])
@jwt_required()
@inject
def getSubmissionSummary(submission_repo: SubmissionRepository = Provide[Container.submission_repo], project_repo: ProjectRepository = Provide[Container.project_repo], class_repo: ClassRepository = Provide[Container.class_repo], user_repo: UserRepository = Provide[Container.user_repo], link_service: LinkService = Provide[Container.link_service]):
    if current_user.Role != ADMIN_ROLE:
        message = {
            'message': 'Access Denied'
        }
        return make_response(message, HTTPStatus.UNAUTHORIZED)
    """
    Endpoint to fetch unique submissions for a specific project.
    The returned object is a list where the first element is the number of total unique submissions 
    and the second element is the total number of students in the course.

    :param submission_repo: SubmissionRepository instance provided by Dependency Injector
    :return: JSON response containing the list of unique submissions and HTTPStatus.OK
    """
    # Extract 'project_id' from the request arguments
    project_id = request.args.get('id')


    # Get list of users in the course

    class_Name = project_repo.get_className_by_projectId(project_id)
    class_Id = project_repo.get_class_id_by_name(class_Name)
    users=user_repo.get_all_users_by_cid(class_Id)
    user_ids = []
    for user in users:
        user_ids.append(user.Id)
    # Fetch unique submissions for the project from the repository
    user_submissions = submission_repo.get_most_recent_submission_by_project(project_id, user_ids)



    total_students = class_repo.get_studentcount(class_Id)
    holder = [len(user_submissions), total_students]



    testcase_results = {"Passed": {}, "Failed": {}}
    testcase_links = {}
    linting_results = {}

    # Get the Linting results for each submission, aggregate them, and return them as a dictionary with the key being the linting error and the value being the number of times it occurred
    for user in user_submissions:
        user = user_submissions[user]
        linting_results_user =""
        if user.LintingResults is None:
            continue
        try:
            linting_results_user = ast.literal_eval(user.LintingResults)
        except Exception as e:
            print("Error parsing linting results: ", str(e), flush=True)
            continue
        for key in linting_results_user:
            if key not in linting_results:
                linting_results[key] = linting_results_user[key]
            else:
                linting_results[key] += linting_results_user[key]
    # Get the Testcase Results for each submission, aggregate them, with the key being "passed" or "failed" and the value being a dictionary with the key being the testcase name and the value being the number of times it occurred
        testcase_results_user =""
        if user.TestCaseResults is None:
            continue
        try:
            testcase_results_user = ast.literal_eval(user.TestCaseResults)
        except Exception as e:
            print("Error parsing testcase results: ", str(e), flush=True)
            continue
        for status in ['Passed', 'Failed']:
            if status in testcase_results_user:
                for test_case in testcase_results_user[status]:
                    for test_name, level in test_case.items():
                        if test_name not in testcase_results[status]:
                            testcase_results[status][test_name] = 1
                        else:
                            testcase_results[status][test_name] += 1
    pass_averages = {}

    # Generates pass averages for each test case
    for test_case in set(testcase_results['Passed'].keys()).union(testcase_results['Failed'].keys()):
        pass_count = testcase_results['Passed'].get(test_case, 0)
        fail_count = testcase_results['Failed'].get(test_case, 0)
        total = pass_count + fail_count
        pass_averages[test_case] = (pass_count / total) * 100 if total != 0 else 0

    dates, passed, failed, no_submission = submission_repo.day_to_day_visualizer(project_id, user_ids)
    submission_heatmap, potential_students_list = submission_repo.get_all_submission_times(project_id)

    ## Sort Linting results based on the number of times they occurred, only send top 6 most common linting errors
    linting_results = {k: v for k, v in itertools.islice(sorted(linting_results.items(), key=lambda item: item[1], reverse=True), 6)}

    # Sort Testcase results based on the number of times they occurred, only send the worst 6 averages
    pass_averages = {k: v for k, v in itertools.islice(sorted(pass_averages.items(), key=lambda item: item[1], reverse=False), 6)}
    return make_response(json.dumps({"LintData":linting_results, "UniqueSubmissions": holder, "TestCaseResults": pass_averages, "dates": dates, "passed": passed, "failed": failed, "noSubmission": no_submission, "submissionHeatmap": submission_heatmap, "PotentialAtRisk": potential_students_list }), HTTPStatus.OK)

@projects_api.route('/AtRiskStudents', methods=['GET'])
@jwt_required()
@inject
def AtRiskStudents(submission_repo: SubmissionRepository = Provide[Container.submission_repo], project_repo: ProjectRepository = Provide[Container.project_repo], class_repo: ClassRepository = Provide[Container.class_repo], user_repo: UserRepository = Provide[Container.user_repo], link_service: LinkService = Provide[Container.link_service]):
    if current_user.Role != ADMIN_ROLE:
        message = {
            'message': 'You do not have permission to do this!'
        }
        return make_response(message, HTTPStatus.FORBIDDEN)
    project_id = request.args.get('id')
    no_submission_prior_assignment = []
    failing_two_out_of_three = []
    high_failing_rate = []

    class_Name = project_repo.get_className_by_projectId(project_id)
    class_Id = project_repo.get_class_id_by_name(class_Name)
    users=user_repo.get_all_users_by_cid(class_Id)
    user_ids = [user.Id for user in users]

    projects = project_repo.get_projects_by_class_id(class_Id)
    projects = sorted(projects, key=lambda project: project.End)
    
    if len(projects) == 0 or len(projects)==1:
        return make_response(json.dumps({"noSubmission": no_submission_prior_assignment, "TwoOutThree": failing_two_out_of_three, "HighFailRate" : high_failing_rate}), HTTPStatus.OK) 
    no_submission_prior_assignment = list(user_ids)
    
    current_asn_index = 0
    for project in projects:
        if project.Id == int(project_id):
            break
        current_asn_index += 1
    """
    These next two parts of this function identifies students who may be at risk based on two criteria:

    1. Students who did not submit anything for the previous assignment.
    2. Students who submitted more than 10 times for the previous assignment but did not achieve a passing grade.

    This is considered the first level of risk assessment for students.
    """
    # Get students who did not submit anything for the previous assignment
    try:
        holder = submission_repo.get_most_recent_submission_by_project(projects[current_asn_index - 1].Id, user_ids) # TODO: get all submissions for the previous assignment
        for key in holder:
            if key in no_submission_prior_assignment:
                no_submission_prior_assignment.remove(key)
    except Exception as e:
        no_submission_prior_assignment = []
        print("An error occurred or no prior submissions: ", str(e), flush=True)

    # Get students who submitted more than 10 times for the previous assignment but did not achieve a passing result
    try:
        high_subs_failing={}
        holder = submission_repo.get_all_submissions_for_project(projects[current_asn_index - 1].Id) #TODO: get all submissions for the previous assignment
        temp = {}
        for submission in holder:
            if submission.User not in temp:
                temp[submission.User] = [1, submission.IsPassing]
            else:
                if submission.IsPassing==1:
                    temp[submission.User][0] += 1
                    temp[submission.User][1] = submission.IsPassing
                else:
                    temp[submission.User][0] += 1
                    if temp[submission.User][1] == 0:
                        temp[submission.User][1] = submission.IsPassing
        for key in temp:
            if temp[key][1] == 0 and temp[key][0] >= 10:
                high_subs_failing[key] = [temp[key][0], project.Id]
    except Exception as e:
        high_subs_failing = {}
        print("An error occurred or no prior asn High_subs_failing: ", str(e), flush=True)

    # Go through the prior assignments and get users who have failed two out of three most recent assignments
    failing_two_out_of_three = {}

    if current_asn_index >=3 and projects[current_asn_index-1] is not None and projects[current_asn_index-2] is not None and projects[current_asn_index-3] is not None:
        temp = [projects[current_asn_index-1].Id, projects[current_asn_index-2].Id, projects[current_asn_index-3].Id]
        for project_id in temp:
            submissions  = submission_repo.get_most_recent_submission_by_project(project_id, user_ids)
            for user_id in user_ids:
                passed_flag = False
                made_submission = False
                for submission in submissions:
                    if submissions[submission].User == user_id:
                        made_submission = True
                        if submissions[submission].IsPassing == 1:
                            passed_flag = True
                if not passed_flag or not made_submission:
                    if user_id not in failing_two_out_of_three:
                        failing_two_out_of_three[user_id] = 1
                    else:
                        failing_two_out_of_three[user_id] += 1
    """
    The next portion of this function identifies the severity of a student's risk based on the following criteria:
    1. Students who have failed two out of three most recent assignments.
    2. Students who have not made a submission for the previous assignment.
    3. Students who have submitted more than 10 times for the previous assignment but did not achieve a passing grade.
    
    No prior submission = 1
    More than 10 submissions without passing = 2
    failing two out of three = 3
    No prior submission + failing two out of three = 4
    More than 10 submissions without passing + failing two out of three = 5    
    
    """
    NO_PRIOR_ONLY = 1
    HIGH_SUBS_FAIL_ONLY = 2
    FAIL_TWO_OUT_OF_THREE_ONLY = 3
    NO_PRIOR_PLUS_FAIL_TWO_OUT_OF_THREE = 4
    HIGH_SUBS_FAIL_PLUS_FAIL_TWO_OUT_OF_THREE = 5

    at_riskstudents ={}

    for value in no_submission_prior_assignment:
        if value not in failing_two_out_of_three:
            at_riskstudents[value] = NO_PRIOR_ONLY
        if value in failing_two_out_of_three:
            at_riskstudents[value] = NO_PRIOR_PLUS_FAIL_TWO_OUT_OF_THREE
    for value in high_subs_failing:
        if value not in failing_two_out_of_three:
            at_riskstudents[value] = HIGH_SUBS_FAIL_ONLY 
        if value in failing_two_out_of_three:
            at_riskstudents[value] = HIGH_SUBS_FAIL_PLUS_FAIL_TWO_OUT_OF_THREE
    for value in failing_two_out_of_three:
        if value not in at_riskstudents:
            at_riskstudents[value] = FAIL_TWO_OUT_OF_THREE_ONLY
    
    for key in at_riskstudents:
        user = user_repo.get_user(key)
        counter = 0
        for project in projects:
            counter += submission_repo.get_number_of_questions_asked(project.Id, key)
        at_riskstudents[key] = [at_riskstudents[key], user.Firstname + " " + user.Lastname, counter, user.Email]
    
    message = {
        'message': 'Success'
    }
    return make_response(json.dumps({"AtRiskStudents": at_riskstudents}), HTTPStatus.OK)

@projects_api.route('/AtRiskStudentDetail', methods=['GET'])
@jwt_required()
@inject
def AtRiskStudentDetail(submission_repo: SubmissionRepository = Provide[Container.submission_repo], project_repo: ProjectRepository = Provide[Container.project_repo], class_repo: ClassRepository = Provide[Container.class_repo], user_repo: UserRepository = Provide[Container.user_repo], link_service: LinkService = Provide[Container.link_service]):
    if current_user.Role != ADMIN_ROLE:
        message = {
            'message': 'You do not have permission to do this!'
        }
        return make_response(message, HTTPStatus.FORBIDDEN)
    user_id = request.args.get('id')
    project_id = request.args.get('project_id')
    class_Name = project_repo.get_className_by_projectId(project_id)
    class_Id = project_repo.get_class_id_by_name(class_Name)
    projects = project_repo.get_projects_by_class_id(class_Id)
    projects = sorted(projects, key=lambda project: project.End, reverse=False)

    submissions = submission_repo.get_all_submissions_for_user(user_id)
    count = {}
    for submission in submissions:
        if submission.Project not in count:
            count[submission.Project] = 1
        else:
            count[submission.Project] += 1
    
    data = {}
    total_OH_questions = 0
    current_OH_questions = 0
    student_questions =[]
    for project in projects:
        questions = submission_repo.get_student_questions_asked(user_id, project.Id)
        if len(questions) > 0:
            questions = [question.StudentQuestionscol for question in questions]
            for question in questions:
                if project.Id == int(project_id):
                    total_OH_questions += 1
                    current_OH_questions += 1
                else:
                    total_OH_questions += 1
                student_questions.append([project.Name, question])
    for project in projects:
        if project.Id in count:
            data[project.Name] = count[project.Id]
        else:
            data[project.Name] = 0

    return make_response(json.dumps({"StudentData": data, "currentOHQCount": current_OH_questions, "AllOHQCount": total_OH_questions, "OHQuestionsDetails": student_questions}), HTTPStatus.OK)



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