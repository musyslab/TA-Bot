from flask import Blueprint, request, jsonify, abort
from flask_jwt_extended import jwt_required, current_user, get_current_user
from dependency_injector.wiring import inject, Provide
from container import Container

from src.repositories.class_repository import ClassRepository
from src.repositories.models import Classes, Labs, LectureSections, Schools
from src.services import class_service

class_api = Blueprint('class_api', __name__)


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
    selected_school = None

    if school_id and school_id > 0:
        selected_school = Schools.query.filter(Schools.Id == school_id).first()

        if selected_school is None:
            abort(404)

        if not class_service.user_can_access_school(current_user, school_id, class_repo):
            abort(403)

    classes_list = class_service.get_assigned_classes(current_user, class_repo)

    if school_id and school_id > 0:
        classes_list = [
            class_item
            for class_item in classes_list
            if parse_optional_int(getattr(class_item, "SchoolId", None)) == school_id
        ]

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

    if parsed_class_id is None:
        abort(404)

    class_item = class_repo.get_class_by_id(parsed_class_id)

    if class_item is None:
        abort(404)

    if school_id is not None and class_item.SchoolId != school_id:
        abort(403)

    if not class_service.user_can_access_class_item(current_user, class_item, class_repo):
        abort(403)

    return jsonify(serialize_class(class_item))


@class_api.route('/sections', methods=['GET'])
@jwt_required(optional=True)
@inject
def get_class_labs(class_repo: ClassRepository = Provide[Container.class_repo],
                   class_service: class_service = Provide[Container.class_service]):
    user = get_current_user()
    school_id = parse_optional_int(request.args.get("school_id"))

    classes_query = Classes.query.order_by(Classes.Name.asc())

    if school_id and school_id > 0:
        school = Schools.query.filter(Schools.Id == school_id).first()

        if school is None:
            abort(404)

        classes_query = classes_query.filter(Classes.SchoolId == school_id)

    classes_list = classes_query.all()

    if user is not None:
        if school_id and school_id > 0 and not class_service.user_can_access_school(user, school_id, class_repo):
            abort(403)

        accessible_classes = class_service.get_assigned_classes(user, class_repo)
        accessible_class_ids = {
            extract_class_id(class_item)
            for class_item in accessible_classes
        }

        classes_list = [
            cls
            for cls in classes_list
            if cls.Id in accessible_class_ids
        ]

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