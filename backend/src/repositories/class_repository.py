from typing import List

from sqlalchemy import desc

from .models import Classes


class ClassRepository:

    def get_classes(self) -> List[Classes]:
        return Classes.query.order_by(desc(Classes.Name)).all()

    def get_class_by_id(self, class_id: int):
        return Classes.query.filter(Classes.Id == class_id).first()

    def get_classes_for_school(self, school_id: int) -> List[Classes]:
        return Classes.query.filter(Classes.SchoolId == school_id).order_by(Classes.Name.asc()).all()
