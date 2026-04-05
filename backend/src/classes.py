from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, current_user
from dependency_injector.wiring import inject, Provide
from container import Container

from src.repositories.class_repository import ClassRepository
from src.repositories.models import Classes, Labs, LectureSections
from src.services import class_service

class_api = Blueprint('class_api', __name__)

def _parse_optional_int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _extract_class_id(item) -> int:
    try:
        if isinstance(item, dict):
            return int(item.get("id") or item.get("Id") or 0)
        return int(getattr(item, "id", None) or getattr(item, "Id", None) or 0)
    except (TypeError, ValueError):
        return 0

@class_api.route('/all', methods=['GET'])
@jwt_required()
@inject
def get_classes_and_ids(class_repo: ClassRepository = Provide[Container.class_repo],
                        class_service: class_service = Provide[Container.class_service]):
    classes_list = []
    school_id = _parse_optional_int(request.args.get("school_id"))
    is_filtered = request.args.get('filter') == "true"
    if is_filtered:
        classes_list = class_service.get_assigned_classes(current_user, class_repo)
    else:
        classes_list = class_service.get_assigned_classes(current_user, class_repo)

    if school_id and school_id > 0:
        allowed_class_ids = {
            cls.Id for cls in Classes.query.filter(Classes.SchoolId == school_id).all()
        }
        classes_list = [
            class_item
            for class_item in classes_list
            if _extract_class_id(class_item) in allowed_class_ids
        ]

    return jsonify(classes_list)

@class_api.route('/sections', methods=['GET'])
def get_class_labs():
    school_id = _parse_optional_int(request.args.get("school_id"))

    classes_query = Classes.query.order_by(Classes.Name.asc())
    if school_id and school_id > 0:
        classes_query = classes_query.filter(Classes.SchoolId == school_id)

    holder = []
    for cls in classes_query.all():
        class_lab = [
            {"name": lab.Name, "id": lab.Id}
            for lab in Labs.query.filter(Labs.ClassId == cls.Id).order_by(Labs.Name.asc()).all()
        ]
        class_lectures = [
            {"name": lecture.Name, "id": lecture.Id}
            for lecture in LectureSections.query.filter(LectureSections.ClassId == cls.Id)
            .order_by(LectureSections.Name.asc())
            .all()
        ]

        holder.append({
            "name": cls.Name,
            "id": cls.Id,
            "labs": class_lab,
            "lectures": class_lectures
        })

    return jsonify(holder)

@class_api.route('/id/<class_id>', methods = ['GET'])
@inject
def get_class_name_from_id(class_id, class_repository: ClassRepository = Provide[Container.class_repo]):
    class_name = [{
        "name": class_repository.get_class_name_withId(class_id)
    }]
    return jsonify(class_name)
