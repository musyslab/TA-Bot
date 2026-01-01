from abc import ABC, abstractmethod
import os
import random
import shutil
import subprocess
from typing import Optional, Dict

from flask import send_file

from sqlalchemy.sql.expression import asc
from .models import Projects, StudentGrades, Submissions, Testcases, Classes
from src.repositories.database import db
from sqlalchemy import desc, and_
from datetime import datetime
from pyston import PystonClient,File
import asyncio
import json



class ProjectRepository():

    def get_current_project(self) -> Optional[Projects]:
        """[Identifies the current project based on the start and end date]
        Returns:
            Project: [this should be the currently assigned project object]
        """
        now = datetime.now()
        project = Projects.query.filter(Projects.End >= now, Projects.Start < now).first()
        return project

    def get_current_project_by_class(self, class_id: int) -> Optional[Projects]:
        """Identifies the current project based on the start and end date.

        Args:
            class_id (int): The ID of the class.

        Returns:
            Optional[Projects]: The currently assigned project object.
        """
        now = datetime.now()
        project = Projects.query.filter(Projects.ClassId==class_id,Projects.End >= now, Projects.Start < now).first()
        #Start and end time format: 2023-05-31 14:33:00
        return project

    def get_all_projects(self) -> Projects:
        """Get all projects from the mySQL database and return a project object sorted by end date.

        Returns:
            Projects: A project object sorted by end date.
        """
        project = Projects.query.order_by(asc(Projects.End)).all()
        return project

    def get_selected_project(self, project_id: int) -> Projects:
        """[summary]
        Args:
            project_id (int): [The Project ID]

        Returns:
            Project: [a project object]
        """
        project= Projects.query.filter(Projects.Id == project_id).first()
        return project


    def get_projects_by_class_id(self,class_id: int) -> int:
        """
        Returns a list of projects associated with a given class ID.

        Args:
        class_id (int): The ID of the class to retrieve projects for.

        Returns:
        A list of project objects associated with the given class ID.
        """
        class_projects = Projects.query.filter(Projects.ClassId==class_id)
        return class_projects
    
    def create_project(self, name: str, start: datetime, end: datetime, language:str, class_id:int, file_path:str, description_path:str, additional_file_path:str):
        project = Projects(Name=name, Start=start, End=end, Language=language,
                            ClassId=class_id, solutionpath=file_path,
                            AsnDescriptionPath=description_path,
                            AdditionalFilePath=additional_file_path)
        db.session.add(project)
        db.session.commit()
        return project.Id
        
    def get_project(self, project_id:int) -> Projects:
        project_data = Projects.query.filter(Projects.Id == project_id).first()
        project ={}
        now=project_data.Start
        start_string = now.strftime("%Y-%m-%dT%H:%M:%S")
        now = project_data.End
        end_string = now.strftime("%Y-%m-%dT%H:%M:%S")
        project_solutionFile = project_data.solutionpath
        #Strip just the file name from the path
        project_solutionFile = project_solutionFile.split("/")[-1]
        project_descriptionfile = project_data.AsnDescriptionPath
        project_descriptionfile = project_descriptionfile.split("/")[-1]
        add_field = getattr(project_data, "AdditionalFilePath", "") or ""
        try:
            add_list = json.loads(add_field) if (add_field or "").startswith('[') else ([add_field] if add_field else [])
        except Exception:
            add_list = []
        project_additionalfiles = [os.path.basename(p) for p in add_list if p]
        project[project_data.Id] = [
            str(project_data.Name),
            str(start_string),
            str(end_string),
            str(project_data.Language),
            str(project_solutionFile),
            str(project_descriptionfile),
            project_additionalfiles,
        ]
        return project

    def edit_project(self, name: str, start: datetime, end: datetime, language:str, project_id:int, path:str, description_path:str, additional_file_path:str):
        project = Projects.query.filter(Projects.Id == project_id).first()
        project.Name = name
        project.Start = start
        project.End = end
        project.Language = language
        project.solutionpath = path
        project.AsnDescriptionPath = description_path
        project.AdditionalFilePath = additional_file_path
        db.session.commit() 
        
    def get_testcases(self, project_id: int) -> Dict[int, list]:
        testcases = Testcases.query.filter(Testcases.ProjectId == project_id).all()
        testcase_info: Dict[int, list] = {}
        for test in testcases:
            testcase_data = []
            testcase_data.append(test.Id)          
            testcase_data.append(test.Name)        
            testcase_data.append(test.Description) 
            testcase_data.append(test.input)       
            testcase_data.append(test.Output)      
            testcase_data.append(test.IsHidden)    
            testcase_info[test.Id] = testcase_data
        return testcase_info

    def add_or_update_testcase(
        self,
        project_id: int,
        testcase_id: int,
        name: str,
        description: str,
        input_data: str,
        output: str,
        is_hidden: bool,
        class_id: int,
    ):
        from flask import current_app

        # Fetch project and determine teacher directory base
        project = Projects.query.filter(Projects.Id == project_id).first()
        teacher_base = current_app.config["TEACHER_FILES_DIR"]
        # Ensure solutionpath points to the teacher project folder
        project_base = project.solutionpath  # e.g., /ta-bot/project-files/teacher-files/Project_XYZ

        # Run grading-script to compute default output if none provided
        grading_script = os.path.join(
            current_app.root_path, "..", "ta-bot", "grading-scripts", "tabot.py"
        )

        add_path = getattr(project, "AdditionalFilePath", "") or ""
        result = subprocess.run(
            [
                "python",
                grading_script,
                "ADMIN",
                str(-1),
                project.Language,
                input_data,
                project_base,
                add_path,
                str(project_id),
                str(class_id),
            ],
            stdout=subprocess.PIPE,
            text=True,
        )

        # Always prefer recomputed output (includes AdditionalFilePath);
        # fall back to provided output only if recompute failed/empty.
        recomputed = (result.stdout or "").strip()
        if recomputed:
            output = recomputed

        # Handle creation or update of the testcase record
        testcase = Testcases.query.filter(Testcases.Id == testcase_id).first()

        if testcase is None:
            testcase = Testcases(
                ProjectId=project_id,
                Name=name,
                Description=description,
                input=input_data,
                Output=output,
                IsHidden=is_hidden,
            )
            db.session.add(testcase)
        else:
            testcase.Name = name
            testcase.Description = description
            testcase.input = input_data
            testcase.Output = output
            testcase.IsHidden = is_hidden

        db.session.commit()

    def remove_testcase(self, testcase_id: int):
        testcase = Testcases.query.filter(Testcases.Id == testcase_id).first()
        db.session.delete(testcase)
        db.session.commit()

    def testcases_to_json(self, project_id: int) -> str:
        testcase_holder: Dict[int, list] = {}
        proj = Projects.query.filter(Projects.Id == project_id).first()
        add_field = getattr(proj, "AdditionalFilePath", "") if proj else ""
        try:
            add_list = json.loads(add_field) if (add_field or "").startswith('[') else ([add_field] if add_field else [])
        except Exception:
            add_list = []
        tests = Testcases.query.filter(Testcases.ProjectId == project_id).all()
        for test in tests:
            testcase_holder[test.Id] = [
                test.Name,
                test.Description,
                test.input,
                test.Output,
                test.IsHidden,
                add_list,
            ]
        json_object = json.dumps(testcase_holder)
        print(json_object, flush=True)
        return json_object

    def wipe_submissions(self, project_id:int):
        submissions = Submissions.query.filter(Submissions.Project == project_id).all()
        for student in student_progress:
            db.session.delete(student)
        db.session.commit()
        for submission in submissions:
            db.session.delete(submission)
        db.session.commit()

    def delete_project(self, project_id:int):
        project = Projects.query.filter(Projects.Id == project_id).first()
        testcases =Testcases.query.filter(Testcases.ProjectId==project_id).all()

        teacher_base = '/ta-bot/project-files/teacher-files'
        teacher_folder = os.path.basename(project.solutionpath)
        teacher_path = os.path.join(teacher_base, teacher_folder)
        if os.path.isdir(teacher_path):
            shutil.rmtree(teacher_path)
        student_base = '/ta-bot/project-files/student-files'
        student_folder = f"{teacher_folder}-out"
        student_path = os.path.join(student_base, student_folder)
        if os.path.isdir(student_path):
            shutil.rmtree(student_path)

        for test in testcases:
            db.session.delete(test)
            db.session.commit()
    
    def get_className_by_projectId(self, project_id):
        project = Projects.query.filter(Projects.Id == project_id).first()
        class_obj = Classes.query.filter(Classes.Id ==project.ClassId).first()
        return class_obj.Name


    def get_class_id_by_name(self, class_name):
        class_id = Classes.query.filter(Classes.Name==class_name).first().Id
        return class_id

    def get_project_path(self, project_id):
        project = Projects.query.filter(Projects.Id==project_id).first()
        return project.solutionpath

    def get_project_desc_path(self, project_id):
        project = Projects.query.filter(Projects.Id==project_id).first()
        return project.AsnDescriptionPath

    def get_project_desc_file(self, project_id):
        project = Projects.query.filter(Projects.Id == project_id).first()
        filepath = project.AsnDescriptionPath
        with open(filepath, 'rb') as file:
            file_contents = file.read()
        return file_contents  # Return the contents of the PDF file

    def get_student_grade(self, project_id, user_id):
        student_progress = StudentGrades.query.filter(and_(StudentGrades.Sid==user_id, StudentGrades.Pid==project_id)).first()
        if student_progress is None:
            return 0
        return student_progress.Grade
        
    def set_student_grade(self, project_id, user_id, grade):
        student_grade = StudentGrades.query.filter(and_(StudentGrades.Sid==user_id, StudentGrades.Pid==project_id)).first()
        if student_grade is not None:
            student_grade.Grade = grade
            db.session.commit()
            return
        studentGrade = StudentGrades(Sid=user_id, Pid=project_id, Grade=grade)
        db.session.add(studentGrade)
        db.session.commit()
        return