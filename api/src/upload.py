from flask.json import jsonify
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
from src.services.timeout_service import on_timeout
from tap.parser import Parser
from dependency_injector.wiring import inject, Provide
from container import Container
from src.constants import ADMIN_ROLE

upload_api = Blueprint('upload_api', __name__)

ext = {"python": [".py", "py"], "java": [".java", "java"], "c": [".c", "c"]}

def allowed_file(filename):
    """[function for checking to see if the file is an allowed file type]

    Args:
        filename ([string]): [a string version of the filename]

    Returns:
        [Boolean]: [returns a bool if the file is allowed or not]
    """
    filetype = filename.rsplit('.', 1)[1].lower()
    for key in ext:
        if filetype in ext[key]:
            return True

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
    users = user_repo.get_all_users_by_cid(class_id)
    list_of_user_info = []
    for user in users:
        list_of_user_info.append({"name": user.Firstname + " " + user.Lastname, "mscsnet": user.Username, "id": user.Id})
    return jsonify(list_of_user_info)

@upload_api.route('/', methods=['POST'])
@jwt_required()
@inject
def file_upload(
    user_repository: UserRepository = Provide[Container.user_repo],
    submission_repo: SubmissionRepository = Provide[Container.submission_repo],
    project_repo: ProjectRepository = Provide[Container.project_repo],
    class_repo: ClassRepository = Provide[Container.class_repo]
):
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
        username = user_repository.get_user_by_id(int(request.form["student_id"]))
        user_id = user_repository.getUserByName(username).Id

    project_id = project_repo.get_current_project_by_class(class_id)
    project = None
    if "project_id" in request.form:
        project = project_repo.get_selected_project(int(request.form["project_id"]))
    else:
        project = project_repo.get_current_project_by_class(class_id)

    if project is None:
        message = {
            'message': 'No active project'
        }
        return make_response(message, HTTPStatus.NOT_ACCEPTABLE)

    # Check to see if student is able to upload or still on timeout
    if current_user.Role != ADMIN_ROLE:
        class_id = request.form['class_id']

    # Accept either legacy single-file field ("file") or new multi-file field ("files")
    upload_files = request.files.getlist('files')
    if not upload_files:
        single = request.files.get('file')
        if single and single.filename:
            upload_files = [single]
    upload_files = [f for f in upload_files if f and f.filename]
    if not upload_files:
        message = {'message': 'No selected file'}
        return make_response(message, HTTPStatus.BAD_REQUEST)

    proj_lang = (project.Language or "").strip().lower()
    if proj_lang == "java":
        bad = [f.filename for f in upload_files if os.path.splitext(f.filename)[1].lower() != ".java"]
        if bad:
            message = {'message': 'Selected project expects Java: upload one or more .java files.'}
            return make_response(message, HTTPStatus.UNSUPPORTED_MEDIA_TYPE)
    elif proj_lang == "python":
        if len(upload_files) != 1 or os.path.splitext(upload_files[0].filename)[1].lower() != ".py":
            message = {
                'message': 'Selected project expects Python: upload a .py file.'
            }
            return make_response(message, HTTPStatus.UNSUPPORTED_MEDIA_TYPE)

    classname = class_repo.get_class_name_withId(class_id)

    student_base = current_app.config['STUDENT_FILES_DIR']

    # student-files/<projecttimestamp__projectname>/<username>/<submissiontimestamp>/...
    teacher_proj_dir = os.path.dirname(project.solutionpath)
    teacher_folder_name = os.path.basename(teacher_proj_dir)
    project_bucket = os.path.join(student_base, teacher_folder_name)

    # Inline replacement for _sanitize_fs(username)
    safe_username = "".join(
        c if (c.isalnum() or c in "-_") else "_"
        for c in (username or "").strip()
    )

    user_bucket = os.path.join(project_bucket, safe_username)
    os.makedirs(user_bucket, exist_ok=True)

    if upload_files and all(allowed_file(f.filename) for f in upload_files):
        language = (project.Language or "").lower()

        # Per-submission timestamp for filenames
        ts_now = datetime.now()
        ts_stamp = ts_now.strftime("%Y%m%d_%H%M%S")
        dt_string = ts_now.strftime("%Y/%m/%d %H:%M:%S")

        # Step 1: Save student upload(s) into a submission directory (language-independent layout)
        outputpath = project_bucket
        submission_dir = os.path.join(user_bucket, ts_stamp)
        os.makedirs(submission_dir, exist_ok=True)

        for f in upload_files:
            # Inline replacement for _safe_upload_filename(f.filename)
            base = os.path.basename(f.filename or "")
            stem, extn = os.path.splitext(base)

            safe_stem = "".join(
                c if (c.isalnum() or c in "-_") else "_"
                for c in (stem or "").strip()
            )
            safe_filename = f"{safe_stem}{extn.lower()}"

            dst = os.path.join(submission_dir, safe_filename)
            f.save(dst)

        # Always pass the submission directory to the grader (single or multi-file)
        path = submission_dir

        # Step 2: Run grade.py
        testcase_info_json = project_repo.testcases_to_json(project.Id)

        grading_script = "/tabot-files/grading-scripts/grade.py"
        project_id_arg = str(project.Id)
        class_id_arg = str(class_id)

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

        # Step 3: Read grader JSON output from:
        # student-files/<project>/<username>/<submissiontimestamp>/testcases.json
        json_out = os.path.join(submission_dir, "testcases.json")
        if not os.path.exists(json_out):
            # Back-compat with older output naming
            alt = os.path.join(submission_dir, f"{username}.json")
            if os.path.exists(alt):
                json_out = alt

        status = False
        TestCaseResults = {"Passed": [], "Failed": []}
        try:
            # Inline replacement for _load_grader_json and _status_and_buckets
            with open(json_out, "r", encoding="utf-8", errors="replace") as f:
                payload = json.load(f) or {}

            passed, failed = [], []
            for r in (payload or {}).get("results", []):
                name = str((r or {}).get("name", "") or "")
                if bool((r or {}).get("passed", False)):
                    passed.append(name)
                else:
                    failed.append(name)

            status = (len(failed) == 0)
            TestCaseResults = {"Passed": passed, "Failed": failed}
        except Exception:
            pass

        submissionId = submission_repo.create_submission(
            user_id=user_id,
            output=json_out,
            codepath=submission_dir,
            time=dt_string,
            project_id=project.Id,
            status=status,
            errorcount=0,
            testcase_results=TestCaseResults,
        )

        submission_repo.consume_charge(user_id, class_id, project.Id, submissionId)

        message = {
            'message': 'Success',
            'remainder': 10,
            "sid": submissionId,
        }

        return make_response(message, HTTPStatus.OK)

    message = {'message': 'Unsupported file type'}
    return make_response(message, HTTPStatus.UNSUPPORTED_MEDIA_TYPE)