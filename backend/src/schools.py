from flask import Blueprint, jsonify, abort
from flask_jwt_extended import jwt_required, current_user, get_current_user

from src.repositories.models import Schools, Classes, ClassAssignments
from src.constants import STUDENT_ROLE, TEACHER_ROLE, ADMIN_ROLE

school_api = Blueprint("school_api", __name__)


def teacher_id_is_on_class(teacher_id: int, class_item: Classes) -> bool:
    if class_item.Tid is None:
        return False

    teacher_ids = [
        token
        for token in "".join(
            character if character.isdigit() else " "
            for character in str(class_item.Tid)
        ).split()
    ]

    return str(teacher_id) in teacher_ids


def get_accessible_schools_for_user(user):
    if user is None:
        return Schools.query.order_by(Schools.Name.asc()).all()

    if user.Role == ADMIN_ROLE:
        return Schools.query.order_by(Schools.Name.asc()).all()

    if user.Role == TEACHER_ROLE:
        classes = Classes.query.filter(Classes.SchoolId.isnot(None)).order_by(Classes.Name.asc()).all()
        school_ids = {
            class_item.SchoolId
            for class_item in classes
            if teacher_id_is_on_class(user.Id, class_item)
        }

        if not school_ids:
            return []

        return Schools.query.filter(Schools.Id.in_(school_ids)).order_by(Schools.Name.asc()).all()

    if user.Role == STUDENT_ROLE:
        classes = (
            Classes.query
            .join(ClassAssignments, Classes.Id == ClassAssignments.ClassId)
            .filter(ClassAssignments.UserId == user.Id, Classes.SchoolId.isnot(None))
            .all()
        )
        school_ids = {class_item.SchoolId for class_item in classes}

        if not school_ids:
            return []

        return Schools.query.filter(Schools.Id.in_(school_ids)).order_by(Schools.Name.asc()).all()

    return []


def user_can_access_school(user, school_id: int) -> bool:
    if user is None:
        return False

    if user.Role == ADMIN_ROLE:
        return True

    if user.Role == TEACHER_ROLE:
        classes = Classes.query.filter(Classes.SchoolId == school_id).all()
        return any(teacher_id_is_on_class(user.Id, class_item) for class_item in classes)

    if user.Role == STUDENT_ROLE:
        return (
            Classes.query
            .join(ClassAssignments, Classes.Id == ClassAssignments.ClassId)
            .filter(
                ClassAssignments.UserId == user.Id,
                Classes.SchoolId == school_id,
            )
            .first()
        ) is not None

    return False


def serialize_school(school):
    return {
        "id": school.Id,
        "name": school.Name,
    }


@school_api.route("/all", methods=["GET"])
@jwt_required(optional=True)
def get_schools():
    user = get_current_user()
    schools = get_accessible_schools_for_user(user)
    return jsonify([serialize_school(school) for school in schools])


@school_api.route("/id/<school_id>/access", methods=["GET"])
@jwt_required()
def validate_school_access(school_id):
    try:
        parsed_school_id = int(school_id)
    except (TypeError, ValueError):
        abort(404)

    school = Schools.query.filter(Schools.Id == parsed_school_id).first()

    if school is None:
        abort(404)

    if not user_can_access_school(current_user, parsed_school_id):
        abort(403)

    return jsonify(serialize_school(school))