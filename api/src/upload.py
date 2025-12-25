from flask.json import jsonify
from src.repositories.config_repository import ConfigRepository
import json
import os
import subprocess
import os.path
from typing import List
from subprocess import Popen

from flask_jwt_extended import jwt_required
from flask_jwt_extended import current_user
from flask import Blueprint
from flask import request
from flask import make_response
from flask import current_app
from http import HTTPStatus
from datetime import datetime
from flask_cors import cross_origin
from src.repositories.submission_repository import SubmissionRepository
from src.repositories.project_repository import ProjectRepository
from src.repositories.user_repository import UserRepository
from src.repositories.class_repository import ClassRepository
from src.repositories.config_repository import ConfigRepository
from src.services.timeout_service import on_timeout
from tap.parser import Parser
from dependency_injector.wiring import inject, Provide
from container import Container
from src.constants import ADMIN_ROLE


upload_api = Blueprint('upload_api', __name__)

ext={"python": [".py","py"],"java": [".java","java"],"c": [".c", "c"]}

def _sanitize_fs(s: str) -> str:
    """Make a string safe for filesystem paths: keep alnum, dash, underscore."""
    return "".join(c if (c.isalnum() or c in "-_") else "_" for c in (s or "").strip())

def _safe_upload_filename(filename: str) -> str:
    base = os.path.basename(filename or "")
    stem, extn = os.path.splitext(base)
    return f"{_sanitize_fs(stem)}{extn.lower()}"

def allowed_file(filename):
    """[function for checking to see if the file is an allowed file type]

    Args:
        filename ([string]): [a string version of the filename]

    Returns:
        [Boolean]: [returns a bool if the file is allowed or not]
    """
    filetype=filename.rsplit('.', 1)[1].lower()
    for key in ext:
        if filetype in ext[key]:
            return True 


def python_error_count(filepath):
    """[A function that finds the ammount of errors from the pylint.out file that was generated]

    Args:
        filepath ([string]): [path to the .out file]

    Returns:
        [int]: [The number of errors that the student had in their pylint output]
    """
    with open(filepath+".out.lint", "r") as file:
        parsed_json = json.load(file)
        error_count = 0
        for line in parsed_json:
            if("UPPER_CASE" in line["message"]):
                continue
            else:
                error_count = error_count + 1
        return error_count
    
def LintErrorLogger(filepath, language):
    if language == "python":
        """A function that saves all the Linting errors into a dictionary"""
        with open(filepath+".out.lint", "r") as file:
            parsed_json = json.load(file)
            error_dict = {}
            for line in parsed_json:
                message = line["symbol"]
                if message in error_dict:
                    error_dict[message] += 1
                else:
                    error_dict[message] = 1
            return error_dict
    else:
        return {}

def output_pass_or_fail(filepath):
    """[a function that looks at all results from a students test run]

    Args:
        filepath ([string]): [path to students submission]

    Returns:
        [Bool]: [If there is even an instance of a student failing a single test case the return type is false ]
    """
    with open(filepath, "r") as file:
        for line in file:
            if "not ok" in line:
                return False
    return True

def test_case_result_finder(filepath):
    results = {'Passed': [], 'Failed': []}
    current_test = {'name': None}

    with open(filepath, "r") as file:
        for line in file:
            line = line.strip()
            if line.startswith('not ok'):
                current_test = {'name': None}
                is_passing = False
            elif line.startswith('ok'):
                current_test = {'name': None}
                is_passing = True
            elif line.startswith('name:'):
                current_test['name'] = line.split('\'')[1]
            elif line.startswith('...') and current_test['name']:
                if is_passing:
                    results['Passed'].append(current_test['name'])
                else:
                    results['Failed'].append(current_test['name'])
    return results


def pylint_score_finder(error_count):
    """
    Calculates a pylint score based on the number of errors found in the code.

    Args:
        error_count (int): The number of errors found in the code.

    Returns:
        int: The pylint score calculated based on the number of errors found.
    """
    if error_count <= 10 and error_count > 7:
        return 25
    if error_count <= 7 and error_count > 5:
        return 30
    if error_count <= 5:
        return 40
    else:
        return 10

@upload_api.route('/total_students_by_cid', methods=['GET'])
@jwt_required()
@inject
def total_students(user_repo: UserRepository = Provide[Container.user_repo]):
    if current_user.Role != ADMIN_ROLE:
        message = {
            'message': 'Access Denied'
        }
        return make_response(message, HTTPStatus.UNAUTHORIZED)
    class_id = request.args.get('class_id')
    users=user_repo.get_all_users_by_cid(class_id)
    list_of_user_info=[]
    for user in users:
        list_of_user_info.append({"name":user.Firstname +" "+ user.Lastname,"mscsnet":user.Username,"id":user.Id})
    return jsonify(list_of_user_info)

def find_line_by_char(c_file: str, target_char_count: int) -> int:
    line_count = 1
    char_count = 0
    with open(c_file, "r") as file:
        lines = file.read()
    # 0 based fileoffset indexing in .yaml file
    for c in lines:
        if c == '\n':
            line_count += 1
        if c == lines[target_char_count] and char_count == target_char_count:
            return line_count
        char_count += 1
    return -1


@upload_api.route('/', methods=['POST'])
@jwt_required()
@inject
def file_upload(user_repository: UserRepository =Provide[Container.user_repo],submission_repo: SubmissionRepository = Provide[Container.submission_repo], project_repo: ProjectRepository = Provide[Container.project_repo], config_repo: ConfigRepository = Provide[Container.config_repo],config_repos: ConfigRepository = Provide[Container.config_repo],class_repo: ClassRepository = Provide[Container.class_repo]):
    """[summary]

    Args:
        submission_repository (ASubmissionRepository): [the existing submissions directory and all the functions in it]
        project_repository (AProjectRepository): [the existing projects directory and all the functions in it]

    Returns:
        [HTTP]: [a pass or fail HTTP message]
    """

    class_id = request.form['class_id']
    username = current_user.Username
    user_id = current_user.Id
    if "student_id" in request.form:
        username= user_repository.get_user_by_id(int(request.form["student_id"])) 
        user_id = user_repository.getUserByName(username).Id

    project_id = project_repo.get_current_project_by_class(class_id)
    project = None
    if "project_id" in request.form:
        project = project_repo.get_selected_project(int(request.form["project_id"]))
    else:
        project = project_repo.get_current_project_by_class(class_id)
        
    if project == None:
        message = {
                'message': 'No active project'
            }
        return make_response(message, HTTPStatus.NOT_ACCEPTABLE)

    #Check to see if student is able to upload or still on timeout
    if(current_user.Role != ADMIN_ROLE):
        class_id = request.form['class_id']

    # Accept either legacy single-file field ("file") or new multi-file field ("files")
    upload_files = request.files.getlist('files')
    if not upload_files:
        single = request.files.get('file')
        if single and single.filename:
            upload_files = [single]
    upload_files = [f for f in upload_files if f and f.filename]
    if not upload_files:
        message = { 'message': 'No selected file' }
        return make_response(message, HTTPStatus.BAD_REQUEST)

    proj_lang = (project.Language or "").strip().lower()
    if proj_lang == "java":
        bad = [f.filename for f in upload_files if os.path.splitext(f.filename)[1].lower() != ".java"]
        if bad:
            message = { 'message': 'Selected project expects Java: upload one or more .java files.' }
            return make_response(message, HTTPStatus.UNSUPPORTED_MEDIA_TYPE)
    elif proj_lang == "python":
         if len(upload_files) != 1 or os.path.splitext(upload_files[0].filename)[1].lower() != ".py":
            message = {
                'message': 'Selected project expects Python: upload a .py file.'
            }
            return make_response(message, HTTPStatus.UNSUPPORTED_MEDIA_TYPE)
    classname = class_repo.get_class_name_withId(class_id)
    
    student_base = current_app.config['STUDENT_FILES_DIR']
    # Use the SAME folder name as teacher-files (<base_proj>__<YYYYMMDD_HHMMSS>), no "-out"
    teacher_proj_dir = os.path.dirname(project.solutionpath)
    teacher_folder_name = os.path.basename(teacher_proj_dir)
    submission_path = os.path.join(student_base, teacher_folder_name)
    os.makedirs(submission_path, exist_ok=True)


    if upload_files and all(allowed_file(f.filename) for f in upload_files):
        language = (project.Language or "").lower()
        # Per-submission timestamp for filenames
        ts_now = datetime.now()
        ts_stamp = ts_now.strftime("%Y%m%d_%H%M%S")
        dt_string = ts_now.strftime("%Y/%m/%d %H:%M:%S")

        orig_base = os.path.basename(upload_files[0].filename)
        _, orig_ext = os.path.splitext(orig_base)
        safe_project = _sanitize_fs(getattr(project, "Name", str(project.Id)))
        safe_username = _sanitize_fs(username)
        display_base = f"{ts_stamp}__{safe_username}__{safe_project}"

        # Step 1: Save student upload(s)
        outputpath = submission_path
        if language == "java" and len(upload_files) >= 1:
            # Multi-file Java submission: save into a directory and pass the directory to the grader
            path = os.path.join(outputpath, display_base)
            os.makedirs(path, exist_ok=True)
            for f in upload_files:
                dst = os.path.join(path, _safe_upload_filename(f.filename))
                f.save(dst)
        else:
            # Single-file (non-Java or legacy)
            f0 = upload_files[0]
            save_name = f"{display_base}{os.path.splitext(f0.filename)[1].lower()}"
            path = os.path.join(outputpath, save_name)
            f0.save(path)

        # Step 2: Run grade.sh
        testcase_info_json = project_repo.testcases_to_json(project.Id)

        grading_script = "/ta-bot/grading-scripts/tabot.py"
        project_id_arg = str(project.Id)
        class_id_arg   = str(class_id)

        cmd = [
            "python", grading_script,
            username,
            project.Language,
            str(testcase_info_json),
            path,
            "",               
            project_id_arg,   
            class_id_arg     
        ]
        result = subprocess.run(cmd, cwd=outputpath)

        if result.returncode != 0:
            message = {
                'message': 'Error in running grading script!'
            }
            return make_response(message, HTTPStatus.INTERNAL_SERVER_ERROR)
        
        # Step 3: Rename grader outputs to our new scheme:
        # Grader writes username.out / username.out.lint next to the submitted path:
        # - if path is a directory, outputs are inside that directory
        # - if path is a file, outputs are next to that file (outputpath)
        run_output_dir = path if os.path.isdir(path) else outputpath
        out_src = os.path.join(run_output_dir, f"{username}.out")
        lint_src = os.path.join(run_output_dir, f"{username}.out.lint")
        out_base = os.path.join(outputpath, display_base)
        tap_path = out_base + ".out"
        lint_path = out_base + ".out.lint"
        try:
            if os.path.exists(out_src):
                os.replace(out_src, tap_path)
        except Exception:
            pass
        try:
            if os.path.exists(lint_src):
                os.replace(lint_src, lint_path)
        except Exception:
            pass
        status=output_pass_or_fail(tap_path)
        TestCaseResults=test_case_result_finder(tap_path)
        if project.Language == "python":
            error_count = python_error_count(out_base)
        else:
            error_count=0    

        Linting_results = LintErrorLogger(out_base, project.Language)

        submissionId = submission_repo.create_submission(
            user_id,
            tap_path,
            path,
            lint_path,
            dt_string,
            project.Id,
            status,
            error_count,
            TestCaseResults,
            Linting_results
        )
        
        submission_repo.consume_charge(user_id, class_id, project.Id, submissionId)

        message = {
            'message': 'Success',
            'remainder': 10,
            "sid": submissionId,
        }
        
        return make_response(message, HTTPStatus.OK)
    message = { 'message': 'Unsupported file type' }
    return make_response(message, HTTPStatus.UNSUPPORTED_MEDIA_TYPE)