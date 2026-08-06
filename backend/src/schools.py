from flask import Blueprint, jsonify, abort
from flask_jwt_extended import jwt_required, current_user, get_current_user

from src.repositories.models import Schools, Classes, ClassAssignments
from src.constants import STUDENT_ROLE, ADMIN_ROLE

school_api = Blueprint("school_api", __name__)
SUPPORTED_AUTH_PROVIDERS = {"google", "microsoft"}


def parse_optional_int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def get_user_id(user):
    if user is None:
        return None

    return parse_optional_int(getattr(user, "Id", None))


def get_user_global_role(user) -> int:
    user_id = get_user_id(user)

    if user_id is None:
        return STUDENT_ROLE

    role_rows = (
        ClassAssignments.query
        .with_entities(ClassAssignments.Role)
        .filter(ClassAssignments.UserId == user_id)
        .all()
    )

    roles = []

    for role_row in role_rows:
        if hasattr(role_row, "Role"):
            role_value = role_row.Role
        elif isinstance(role_row, (tuple, list)):
            role_value = role_row[0]
        else:
            role_value = role_row

        parsed_role = parse_optional_int(role_value)

        if parsed_role is not None:
            roles.append(parsed_role)

    return max([STUDENT_ROLE] + roles)


def get_assigned_school_ids(user_id: int):
    school_rows = (
        Classes.query
        .with_entities(Classes.SchoolId)
        .join(ClassAssignments, Classes.Id == ClassAssignments.ClassId)
        .filter(
            ClassAssignments.UserId == user_id,
            Classes.SchoolId.isnot(None),
        )
        .distinct()
        .all()
    )

    school_ids = set()

    for row in school_rows:
        school_id = row.SchoolId if hasattr(row, "SchoolId") else row[0]
        parsed_school_id = parse_optional_int(school_id)

        if parsed_school_id is not None:
            school_ids.add(parsed_school_id)

    return school_ids


def get_accessible_schools_for_user(user):
    if user is None:
        return Schools.query.order_by(Schools.Name.asc()).all()

    user_id = get_user_id(user)

    if user_id is None:
        return []

    if get_user_global_role(user) >= ADMIN_ROLE:
        return Schools.query.order_by(Schools.Name.asc()).all()

    school_ids = get_assigned_school_ids(user_id)

    if not school_ids:
        return []

    return Schools.query.filter(Schools.Id.in_(school_ids)).order_by(Schools.Name.asc()).all()


def user_can_access_school(user, school_id: int) -> bool:
    if user is None:
        return False

    user_id = get_user_id(user)
    parsed_school_id = parse_optional_int(school_id)

    if user_id is None or parsed_school_id is None:
        return False

    if get_user_global_role(user) >= ADMIN_ROLE:
        return True

    return (
        Classes.query
        .join(ClassAssignments, Classes.Id == ClassAssignments.ClassId)
        .filter(
            ClassAssignments.UserId == user_id,
            Classes.SchoolId == parsed_school_id,
        )
        .first()
    ) is not None


def serialize_school(school):
    return {
        "id": school.Id,
        "name": school.Name,
    }


def serialize_login_school(school):
    return {
        **serialize_school(school),
        "auth_provider": str(school.AuthProvider or "").strip().lower(),
    }


@school_api.route("/login-options", methods=["GET"])
def get_school_login_options():
    schools = Schools.query.order_by(Schools.Name.asc()).all()
    configured_schools = [
        school
        for school in schools
        if str(school.AuthProvider or "").strip().lower() in SUPPORTED_AUTH_PROVIDERS
    ]
    return jsonify([serialize_login_school(school) for school in configured_schools])


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
