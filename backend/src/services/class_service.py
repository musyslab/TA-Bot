from src.repositories.class_repository import ClassRepository
from src.repositories.models import Classes, Users
from src.constants import STUDENT_ROLE, TEACHER_ROLE, ADMIN_ROLE


class ClassService:
    def get_assigned_classes(self, current_user: Users, class_repo: ClassRepository) -> [Classes]:
        if current_user.Role == STUDENT_ROLE:
            return class_repo.get_assigned_student_classes(current_user.Id)

        if current_user.Role == TEACHER_ROLE:
            classes = class_repo.get_classes()
            return [
                class_item
                for class_item in classes
                if self.teacher_id_is_on_class(current_user.Id, class_item)
            ]

        if current_user.Role == ADMIN_ROLE:
            return class_repo.get_classes()

        return []

    def user_can_access_school(self, current_user: Users, school_id: int, class_repo: ClassRepository) -> bool:
        if current_user.Role == ADMIN_ROLE:
            return True

        if current_user.Role == TEACHER_ROLE:
            classes = class_repo.get_classes_for_school(school_id)
            return any(
                self.teacher_id_is_on_class(current_user.Id, class_item)
                for class_item in classes
            )

        if current_user.Role == STUDENT_ROLE:
            classes = class_repo.get_assigned_student_classes(current_user.Id)
            return any(
                class_item is not None and class_item.SchoolId == school_id
                for class_item in classes
            )

        return False

    def user_can_access_class(self, current_user: Users, class_id: int, class_repo: ClassRepository) -> bool:
        class_item = class_repo.get_class_by_id(class_id)
        return self.user_can_access_class_item(current_user, class_item, class_repo)

    def user_can_access_class_item(self, current_user: Users, class_item: Classes, class_repo: ClassRepository) -> bool:
        if class_item is None:
            return False

        if current_user.Role == ADMIN_ROLE:
            return True

        if current_user.Role == TEACHER_ROLE:
            return self.teacher_id_is_on_class(current_user.Id, class_item)

        if current_user.Role == STUDENT_ROLE:
            return class_repo.user_is_assigned_to_class(current_user.Id, class_item.Id)

        return False

    def teacher_id_is_on_class(self, teacher_id: int, class_item: Classes) -> bool:
        if class_item is None or class_item.Tid is None:
            return False

        teacher_ids = [
            token
            for token in "".join(
                character if character.isdigit() else " "
                for character in str(class_item.Tid)
            ).split()
        ]

        return str(teacher_id) in teacher_ids