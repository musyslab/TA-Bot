from typing import List, Optional, Set

from src.constants import ADMIN_ROLE, STUDENT_ROLE, TEACHER_ROLE
from src.repositories.class_repository import ClassRepository
from src.repositories.models import ClassAssignments, Classes, Users


def parse_optional_int(value) -> Optional[int]:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


class ClassService:
    def get_user_id(self, current_user: Users) -> Optional[int]:
        if current_user is None:
            return None

        return parse_optional_int(getattr(current_user, "Id", None))

    def get_assignment_for_user_and_class(self, user_id: int, class_id: int):
        return ClassAssignments.query.filter(
            ClassAssignments.UserId == user_id,
            ClassAssignments.ClassId == class_id,
        ).first()

    def get_assignment_role_for_class(self, user_id: int, class_id: int) -> Optional[int]:
        assignment = self.get_assignment_for_user_and_class(user_id, class_id)

        if assignment is None:
            return None

        return parse_optional_int(getattr(assignment, "Role", None))

    def get_user_class_roles(self, user_id: int) -> List[int]:
        assignments = ClassAssignments.query.filter(
            ClassAssignments.UserId == user_id
        ).all()

        roles: List[int] = []

        for assignment in assignments:
            parsed_role = parse_optional_int(getattr(assignment, "Role", None))
            if parsed_role is not None:
                roles.append(parsed_role)

        return roles

    def get_user_global_role(self, current_user: Users) -> int:
        """
        Roles now live on ClassAssignments.

        This returns the user's highest class-assignment role so existing
        app-level admin checks can continue to work.
        """
        user_id = self.get_user_id(current_user)

        if user_id is None:
            return STUDENT_ROLE

        roles = self.get_user_class_roles(user_id)

        if not roles:
            return STUDENT_ROLE

        return max(roles)

    def get_assigned_class_ids(self, user_id: int) -> Set[int]:
        assignments = ClassAssignments.query.filter(
            ClassAssignments.UserId == user_id
        ).all()

        class_ids: Set[int] = set()

        for assignment in assignments:
            class_id = parse_optional_int(getattr(assignment, "ClassId", None))
            if class_id is not None:
                class_ids.add(class_id)

        return class_ids

    def get_assigned_classes(self, current_user: Users, class_repo: ClassRepository) -> List[Classes]:
        user_id = self.get_user_id(current_user)

        if user_id is None:
            return []

        if self.get_user_global_role(current_user) >= ADMIN_ROLE:
            return class_repo.get_classes()

        assigned_class_ids = self.get_assigned_class_ids(user_id)

        if not assigned_class_ids:
            return []

        return Classes.query.filter(
            Classes.Id.in_(assigned_class_ids)
        ).order_by(Classes.Name.asc()).all()

    def user_can_access_school(self, current_user: Users, school_id: int, class_repo: ClassRepository) -> bool:
        user_id = self.get_user_id(current_user)
        parsed_school_id = parse_optional_int(school_id)

        if user_id is None or parsed_school_id is None:
            return False

        if self.get_user_global_role(current_user) >= ADMIN_ROLE:
            return True

        classes = class_repo.get_classes_for_school(parsed_school_id)

        return any(
            self.user_can_access_class_item(current_user, class_item, class_repo)
            for class_item in classes
        )

    def user_can_access_class(self, current_user: Users, class_id: int, class_repo: ClassRepository) -> bool:
        parsed_class_id = parse_optional_int(class_id)

        if parsed_class_id is None:
            return False

        class_item = class_repo.get_class_by_id(parsed_class_id)
        return self.user_can_access_class_item(current_user, class_item, class_repo)

    def user_can_access_class_item(self, current_user: Users, class_item: Classes, class_repo: ClassRepository) -> bool:
        if class_item is None:
            return False

        user_id = self.get_user_id(current_user)
        class_id = parse_optional_int(getattr(class_item, "Id", None))

        if user_id is None or class_id is None:
            return False

        if self.get_user_global_role(current_user) >= ADMIN_ROLE:
            return True

        assignment = self.get_assignment_for_user_and_class(user_id, class_id)

        return assignment is not None

    def user_can_teach_class_item(self, current_user: Users, class_item: Classes) -> bool:
        if class_item is None:
            return False

        user_id = self.get_user_id(current_user)
        class_id = parse_optional_int(getattr(class_item, "Id", None))

        if user_id is None or class_id is None:
            return False

        if self.get_user_global_role(current_user) >= ADMIN_ROLE:
            return True

        assignment_role = self.get_assignment_role_for_class(user_id, class_id)

        return assignment_role is not None and assignment_role >= TEACHER_ROLE

    def user_can_study_class_item(self, current_user: Users, class_item: Classes) -> bool:
        if class_item is None:
            return False

        user_id = self.get_user_id(current_user)
        class_id = parse_optional_int(getattr(class_item, "Id", None))

        if user_id is None or class_id is None:
            return False

        assignment_role = self.get_assignment_role_for_class(user_id, class_id)

        return assignment_role == STUDENT_ROLE