from typing import Dict, List

from sqlalchemy import desc

from src.constants import STUDENT_ROLE
from src.repositories.database import db
from .models import ClassAssignments, Classes, Labs, LectureSections
from ..models.LabJson import LabJson
from ..models.LectureSectionsJson import LectureSectionsJson


class ClassRepository():

    def get_class_id(self, class_name):
        """[Gets class id given the name]"""
        class_id = Classes.query.filter(Classes.Name == class_name).first().Id

        return class_id

    def get_class_name_withId(self, class_id):
        class_name = Classes.query.filter(Classes.Id == class_id).first().Name
        return class_name

    def get_lecture_id_withName(self, lectureName):
        lecture_id = LectureSections.query.filter(LectureSections.Id == lectureName).first().Id
        return lecture_id

    def get_lab_id_withName(self, labName):
        lab_id = Labs.query.filter(Labs.Id == labName).first().Id
        return lab_id

    def get_classes(self) -> List[Classes]:
        """[Get all the current classes]"""
        classes = Classes.query.order_by(desc(Classes.Name)).all()
        return classes

    def get_class_by_id(self, class_id: int):
        return Classes.query.filter(Classes.Id == class_id).first()

    def get_classes_for_school(self, school_id: int) -> List[Classes]:
        return Classes.query.filter(Classes.SchoolId == school_id).order_by(Classes.Name.asc()).all()

    def create_assignments(
        self,
        class_id: int,
        lab_id: int,
        user_id: int,
        lecture_id: int,
        role: int = STUDENT_ROLE,
    ):
        """[Creates a new entry in the ClassAssignments table]"""
        class_assignment = ClassAssignments(
            ClassId=class_id,
            LabId=lab_id,
            UserId=user_id,
            LectureId=lecture_id,
            Role=role,
        )
        db.session.add(class_assignment)
        db.session.commit()

    def get_assigned_student_classes(self, user_id: int) -> List[Classes]:
        class_ids = [
            assignment.ClassId
            for assignment in ClassAssignments.query.filter(
                ClassAssignments.UserId == user_id,
                ClassAssignments.Role == STUDENT_ROLE,
            ).all()
        ]

        if not class_ids:
            return []

        return Classes.query.filter(Classes.Id.in_(class_ids)).order_by(Classes.Name.asc()).all()

    def user_is_assigned_to_class(self, user_id: int, class_id: int) -> bool:
        return ClassAssignments.query.filter(
            ClassAssignments.UserId == user_id,
            ClassAssignments.ClassId == class_id,
        ).first() is not None

    def get_labs(self) -> Dict[int, List[LabJson]]:
        """[Once given a class, get all the labs for that class]"""
        labs = Labs.query.all()

        labs_dict = {}
        for lab in labs:
            if lab.ClassId in labs_dict:
                labs_dict[lab.ClassId].append(LabJson(lab.Id, lab.Name))
            else:
                labs_dict[lab.ClassId] = [LabJson(lab.Id, lab.Name)]

        for lab_id in labs_dict:
            labs_dict[lab_id].sort(key=lambda x: x.Name)

        return labs_dict

    def get_lecture_sections(self) -> Dict[int, List[LectureSectionsJson]]:
        """[loop through classes, get all the labs for that class]"""
        lecture_sections = LectureSections.query.all()

        labs_dict = {}
        for lecture_section in lecture_sections:
            if lecture_section.ClassId in labs_dict:
                labs_dict[lecture_section.ClassId].append(
                    LectureSectionsJson(lecture_section.Id, lecture_section.Name)
                )
            else:
                labs_dict[lecture_section.ClassId] = [
                    LectureSectionsJson(lecture_section.Id, lecture_section.Name)
                ]

        for lab_id in labs_dict:
            labs_dict[lab_id].sort(key=lambda x: x.Name)

        return labs_dict

    def add_class_assignment(
        self,
        class_id: int,
        lab_id: int,
        user_id: int,
        lecture_id: int,
        role: int = STUDENT_ROLE,
    ):
        """[Creates a new entry in the ClassAssignments table]"""
        class_assignment = ClassAssignments(
            ClassId=class_id,
            LabId=lab_id,
            UserId=user_id,
            LectureId=lecture_id,
            Role=role,
        )
        db.session.add(class_assignment)
        db.session.commit()
        return "ok"