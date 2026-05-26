from flask import Blueprint, request, jsonify, abort
from flask_jwt_extended import jwt_required, current_user, get_current_user
from dependency_injector.wiring import inject, Provide
from container import Container

from src.constants import ADMIN_ROLE, STUDENT_ROLE, TEACHER_ROLE
from src.repositories.class_repository import ClassRepository
from src.repositories.models import ClassAssignments, Classes, Labs, LectureSections, Schools
from src.services import class_service

class_api = Blueprint('class_api', __name__)

ROLE_CONTEXT_ADMIN = "admin"
ROLE_CONTEXT_STUDENT = "student"


def parse_optional_int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def extract_class_id(item) -> int:
    try:
        if isinstance(item, dict):
            return int(item.get("id") or item.get("Id") or 0)
        return int(getattr(item, "id", None) or getattr(item, "Id", None) or 0)
    except (TypeError, ValueError):
        return 0


def get_requested_role_context():
    role_context = str(
        request.args.get("role_context")
        or request.args.get("context")
        or ""
    ).strip().lower()

    if role_context in (ROLE_CONTEXT_ADMIN, "teacher", "teaching"):
        return ROLE_CONTEXT_ADMIN

    if role_context in (ROLE_CONTEXT_STUDENT, "learning"):
        return ROLE_CONTEXT_STUDENT

    return None


def get_user_global_role(user) -> int:
    user_id = parse_optional_int(getattr(user, "Id", None))

    if user_id is None:
        return STUDENT_ROLE

    role_rows = ClassAssignments.query.with_entities(ClassAssignments.Role).filter(
        ClassAssignments.UserId == user_id
    ).all()

    roles = []
    for role_row in role_rows:
        if hasattr(role_row, "Role"):
            role_value = role_row.Role
        elif isinstance(role_row, (tuple, list)):
            role_value = role_row[0]
        else:
            role_value = role_row

        parsed_role = parse_optional_int(role_value)
        roles.append(parsed_role if parsed_role is not None else STUDENT_ROLE)

    return max([STUDENT_ROLE] + roles)


def get_assignment_for_user_and_class(user_id: int, class_id: int):
    return ClassAssignments.query.filter(
        ClassAssignments.UserId == user_id,
        ClassAssignments.ClassId == class_id,
    ).first()


def get_assignment_role(assignment):
    if assignment is None:
        return None

    return parse_optional_int(getattr(assignment, "Role", None))


def parse_tid_user_ids(tid_value):
    cleaned = str(tid_value or "").replace(";", ",").replace("|", ",")
    user_ids = set()

    for part in cleaned.split(","):
        parsed = parse_optional_int(part.strip())
        if parsed is not None:
            user_ids.add(parsed)

    return user_ids


def user_is_listed_teacher_for_class(user, class_item) -> bool:
    if user is None or class_item is None:
        return False

    user_id = parse_optional_int(getattr(user, "Id", None))
    if user_id is None:
        return False

    return user_id in parse_tid_user_ids(getattr(class_item, "Tid", ""))


def user_can_access_class_for_context(user, class_item, role_context, repository, service) -> bool:
    if user is None or class_item is None:
        return False

    assignment = get_assignment_for_user_and_class(int(user.Id), int(class_item.Id))
    assignment_role = get_assignment_role(assignment)
    global_role = get_user_global_role(user)

    if role_context == ROLE_CONTEXT_STUDENT:
        if assignment_role is not None:
            return assignment_role == STUDENT_ROLE

        return global_role == STUDENT_ROLE and service.user_can_access_class_item(user, class_item, repository)

    if role_context == ROLE_CONTEXT_ADMIN:
        if assignment_role is not None:
            return assignment_role >= TEACHER_ROLE

        if user_is_listed_teacher_for_class(user, class_item):
            return True

        if global_role >= ADMIN_ROLE:
            return True

        return global_role >= TEACHER_ROLE and service.user_can_access_class_item(user, class_item, repository)

    return service.user_can_access_class_item(user, class_item, repository)


def filter_classes_for_context(user, classes_list, role_context, repository, service):
    if role_context is None:
        return classes_list

    return [
        class_item
        for class_item in classes_list
        if user_can_access_class_for_context(user, class_item, role_context, repository, service)
    ]


def serialize_class(item, school_names_by_id=None):
    school_names_by_id = school_names_by_id or {}

    if isinstance(item, dict):
        school_id = parse_optional_int(item.get("school_id") or item.get("SchoolId"))
        return {
            "id": extract_class_id(item),
            "name": item.get("name") or item.get("Name") or "",
            "school_id": school_id,
            "school_name": item.get("school_name") or item.get("SchoolName") or school_names_by_id.get(school_id, ""),
        }

    school_id = parse_optional_int(getattr(item, "school_id", None) or getattr(item, "SchoolId", None))
    return {
        "id": extract_class_id(item),
        "name": getattr(item, "name", None) or getattr(item, "Name", "") or "",
        "school_id": school_id,
        "school_name": school_names_by_id.get(school_id, ""),
    }


def serialize_classes(class_items):
    school_ids = {
        parse_optional_int(getattr(class_item, "SchoolId", None))
        for class_item in class_items
        if parse_optional_int(getattr(class_item, "SchoolId", None)) is not None
    }
    school_names_by_id = {}

    if school_ids:
        schools = Schools.query.filter(Schools.Id.in_(school_ids)).all()
        school_names_by_id = {school.Id: school.Name for school in schools}

    return [serialize_class(class_item, school_names_by_id) for class_item in class_items]


def serialize_school(school):
    if school is None:
        return None

    return {
        "id": school.Id,
        "name": school.Name,
    }


def serialize_class_sections(classes_list):
    class_ids = [cls.Id for cls in classes_list]

    labs_by_class = {class_id: [] for class_id in class_ids}
    lectures_by_class = {class_id: [] for class_id in class_ids}

    if class_ids:
        labs = Labs.query.filter(Labs.ClassId.in_(class_ids)).order_by(Labs.Name.asc()).all()
        lectures = LectureSections.query.filter(LectureSections.ClassId.in_(class_ids)).order_by(LectureSections.Name.asc()).all()

        for lab in labs:
            labs_by_class.setdefault(lab.ClassId, []).append({"name": lab.Name, "id": lab.Id})

        for lecture in lectures:
            lectures_by_class.setdefault(lecture.ClassId, []).append({"name": lecture.Name, "id": lecture.Id})

    return [
        {
            "name": cls.Name,
            "id": cls.Id,
            "school_id": cls.SchoolId,
            "labs": labs_by_class.get(cls.Id, []),
            "lectures": lectures_by_class.get(cls.Id, []),
        }
        for cls in classes_list
    ]


@class_api.route('/all', methods=['GET'])
@jwt_required()
@inject
def get_classes_and_ids(class_repo: ClassRepository = Provide[Container.class_repo],
                        class_service: class_service = Provide[Container.class_service]):
    school_id = parse_optional_int(request.args.get("school_id"))
    include_school = str(request.args.get("include_school", "")).strip().lower() in ("1", "true", "yes", "y", "on")
    role_context = get_requested_role_context()
    selected_school = None

    if school_id and school_id > 0:
        selected_school = Schools.query.filter(Schools.Id == school_id).first()

        if selected_school is None:
            abort(404)

    classes_list = class_service.get_assigned_classes(current_user, class_repo)
    classes_list = filter_classes_for_context(current_user, classes_list, role_context, class_repo, class_service)

    if school_id and school_id > 0:
        classes_list = [
            class_item
            for class_item in classes_list
            if parse_optional_int(getattr(class_item, "SchoolId", None)) == school_id
        ]

        if role_context is not None and not classes_list:
            abort(403)

        if role_context is None and not class_service.user_can_access_school(current_user, school_id, class_repo):
            abort(403)

    serialized_classes = serialize_classes(classes_list)
    serialized_classes.sort(key=lambda class_item: class_item["name"])

    if include_school:
        return jsonify({
            "school": serialize_school(selected_school),
            "classes": serialized_classes,
        })

    return jsonify(serialized_classes)


@class_api.route('/id/<class_id>/access', methods=['GET'])
@jwt_required()
@inject
def validate_class_access(class_id,
                          class_repo: ClassRepository = Provide[Container.class_repo],
                          class_service: class_service = Provide[Container.class_service]):
    parsed_class_id = parse_optional_int(class_id)
    school_id = parse_optional_int(request.args.get("school_id"))
    role_context = get_requested_role_context()

    if parsed_class_id is None:
        abort(404)

    class_item = class_repo.get_class_by_id(parsed_class_id)

    if class_item is None:
        abort(404)

    if school_id is not None and class_item.SchoolId != school_id:
        abort(403)

    if role_context is not None:
        if not user_can_access_class_for_context(current_user, class_item, role_context, class_repo, class_service):
            abort(403)
    elif not class_service.user_can_access_class_item(current_user, class_item, class_repo):
        abort(403)

    return jsonify(serialize_class(class_item))


@class_api.route('/sections', methods=['GET'])
@jwt_required(optional=True)
@inject
def get_class_labs(class_repo: ClassRepository = Provide[Container.class_repo],
                   class_service: class_service = Provide[Container.class_service]):
    user = get_current_user()
    school_id = parse_optional_int(request.args.get("school_id"))
    role_context = get_requested_role_context()

    classes_query = Classes.query.order_by(Classes.Name.asc())

    if school_id and school_id > 0:
        school = Schools.query.filter(Schools.Id == school_id).first()

        if school is None:
            abort(404)

        classes_query = classes_query.filter(Classes.SchoolId == school_id)

    classes_list = classes_query.all()

    if user is not None:
        accessible_classes = class_service.get_assigned_classes(user, class_repo)
        accessible_classes = filter_classes_for_context(user, accessible_classes, role_context, class_repo, class_service)
        accessible_class_ids = {
            extract_class_id(class_item)
            for class_item in accessible_classes
        }

        classes_list = [
            cls
            for cls in classes_list
            if cls.Id in accessible_class_ids
        ]

        if school_id and school_id > 0 and role_context is not None and not classes_list:
            abort(403)

        if school_id and school_id > 0 and role_context is None and not class_service.user_can_access_school(user, school_id, class_repo):
            abort(403)

    return jsonify(serialize_class_sections(classes_list))


@class_api.route('/id/<class_id>', methods=['GET'])
@jwt_required()
@inject
def get_class_name_from_id(class_id,
                           class_repository: ClassRepository = Provide[Container.class_repo],
                           class_service: class_service = Provide[Container.class_service]):
    parsed_class_id = parse_optional_int(class_id)

    if parsed_class_id is None:
        abort(404)

    class_item = class_repository.get_class_by_id(parsed_class_id)

    if not class_service.user_can_access_class_item(current_user, class_item, class_repository):
        abort(403)

    return jsonify([{
        "name": class_item.Name
    }])
