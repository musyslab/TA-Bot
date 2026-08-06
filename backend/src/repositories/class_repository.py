from typing import List, Optional

from sqlalchemy import desc

from .models import ClassAssignments, Classes

class ClassRepository:

    def get_classes(self) -> List[Classes]:
        return Classes.query.order_by(desc(Classes.Name)).all()

    def get_class_by_id(self, class_id: int):
        return Classes.query.filter(Classes.Id == class_id).first()

    def get_classes_for_school(self, school_id: int) -> List[Classes]:
        return Classes.query.filter(Classes.SchoolId == school_id).order_by(Classes.Name.asc()).all()

    def add_class_assignment(
        self,
        class_id: int,
        lab_id: Optional[int],
        user_id: int,
        lecture_id: Optional[int],
    ) -> ClassAssignments:
        assignment = ClassAssignments.query.filter(
            ClassAssignments.UserId == user_id,
            ClassAssignments.ClassId == class_id,
        ).first()

        if assignment is None:
            assignment = ClassAssignments(
                UserId=user_id,
                ClassId=class_id,
                LabId=lab_id,
                LectureId=lecture_id,
            )
            ClassAssignments.query.session.add(assignment)
        else:
            assignment.LabId = lab_id
            assignment.LectureId = lecture_id

        ClassAssignments.query.session.commit()
        return assignment
