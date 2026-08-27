import os
from http import HTTPStatus
from typing import Any, Dict, Literal, Tuple

import jwt as pyjwt
from dependency_injector.wiring import Provide, inject
from flask import Blueprint, current_app, make_response, request
from flask_jwt_extended import create_access_token, current_user, jwt_required
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from jwt import PyJWKClient

from container import Container
from src.api_utils import get_value_or_empty
from src.constants import STUDENT_ROLE, TEACHER_ROLE
from src.jwt_manager import jwt
from src.repositories.models import ClassAssignments, Classes, Labs, LectureSections, Schools, Users
from src.repositories.class_repository import ClassRepository
from src.repositories.user_repository import UserRepository

auth_api = Blueprint("auth_api", __name__)

OAuthProvider = Literal["google", "microsoft"]
LOCKED_ACCOUNT_MESSAGE = "Your account has been locked! Please contact an administrator!"


def require_env(name: str) -> str:
    value = (os.environ.get(name) or "").strip()
    if not value:
        raise RuntimeError(f"{name} is not set.")
    return value


def env_int(name: str, default: int) -> int:
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be an integer.") from exc


def parse_int(value: Any) -> int:
    try:
        return int(value)
    except Exception:
        return 0


def normalize_email(value: str) -> str:
    return (value or "").strip().lower()


def get_school_by_id(school_id: int):
    if school_id <= 0:
        return None
    return Schools.query.filter(Schools.Id == school_id).first()


def get_school_auth_provider(school: Any) -> str:
    return str(getattr(school, "AuthProvider", "") or "").strip().lower()


def school_requires_lab_and_lecture(school: Any) -> bool:
    return bool(getattr(school, "RequiresLabAndLecture", True))


def microsoft_env_name(school_id: int, setting: str) -> str:
    return f"MICROSOFT_SCHOOL_{school_id}_{setting}"


def get_microsoft_oauth_settings(school_id: int) -> Tuple[str, str]:
    client_id = (os.environ.get(microsoft_env_name(school_id, "CLIENT_ID")) or "").strip()
    tenant_id = (os.environ.get(microsoft_env_name(school_id, "TENANT_ID")) or "").strip()
    return client_id, tenant_id


def is_user_locked(user: Any) -> bool:
    return bool(getattr(user, "IsLocked", False))


def get_user_global_role(user: Any) -> int:
    assignments = user_class_assignments(user)
    roles = [get_assignment_role(assignment) for assignment in assignments]
    return max([STUDENT_ROLE] + roles)


def get_assignment_role(assignment: Any) -> int:
    return parse_int(getattr(assignment, "Role", STUDENT_ROLE))


def user_class_assignments(user: Any):
    if user is None:
        return []

    return ClassAssignments.query.filter(ClassAssignments.UserId == user.Id).all()


def user_has_school_assignment(user_id: int, school_id: int) -> bool:
    return (
        Classes.query
        .join(ClassAssignments, Classes.Id == ClassAssignments.ClassId)
        .filter(
            ClassAssignments.UserId == user_id,
            Classes.SchoolId == school_id,
        )
        .first()
    ) is not None


def build_access_summary(user: Any) -> Dict[str, Any]:
    assignments = user_class_assignments(user)
    assignment_roles = [get_assignment_role(assignment) for assignment in assignments]
    effective_role = max([STUDENT_ROLE] + assignment_roles)

    can_study = any(role == STUDENT_ROLE for role in assignment_roles)
    can_teach = any(role >= TEACHER_ROLE for role in assignment_roles)

    if not assignments:
        can_study = True

    default_dashboard = "admin" if can_teach else "student"

    return {
        "role": effective_role,
        "can_teach": can_teach,
        "can_study": can_study,
        "default_dashboard": default_dashboard,
    }


def build_session_payload(user: Any, access_token: str, message: str = "Success") -> Dict[str, Any]:
    return {
        "message": message,
        "access_token": access_token,
        **build_access_summary(user),
    }


def set_class_assignment_role(user_id: int, class_id: int, role: int) -> None:
    assignment = ClassAssignments.query.filter(
        ClassAssignments.UserId == user_id,
        ClassAssignments.ClassId == class_id,
    ).first()

    if assignment is not None:
        assignment.Role = role
        ClassAssignments.query.session.commit()

def is_valid_school_selection(school_id: int, class_id: int, lab_id: int, lecture_id: int) -> bool:
    if school_id <= 0 or class_id <= 0:
        return False

    school = Schools.query.filter(Schools.Id == school_id).first()
    school_class = Classes.query.filter(
        Classes.Id == class_id,
        Classes.SchoolId == school_id,
    ).first()

    if school is None or school_class is None:
        return False

    if not school_requires_lab_and_lecture(school):
        return True

    if lab_id <= 0 or lecture_id <= 0:
        return False

    lab = Labs.query.filter(
        Labs.Id == lab_id,
        Labs.ClassId == class_id,
    ).first()
    lecture = LectureSections.query.filter(
        LectureSections.Id == lecture_id,
        LectureSections.ClassId == class_id,
    ).first()

    return lab is not None and lecture is not None

def split_display_name(name: str) -> Tuple[str, str]:
    cleaned = (name or "").strip()
    if not cleaned:
        return "", ""

    # Microsoft tenants commonly format the display-name claim as
    # "Last, First". When given_name/family_name are absent, normalize that
    # format before falling back to the usual "First Last" split.
    if cleaned.count(",") == 1:
        last_name, first_name = (part.strip() for part in cleaned.split(",", 1))
        if first_name and last_name:
            return first_name, last_name

    parts = cleaned.split()
    if len(parts) == 1:
        return parts[0], ""
    return parts[0], " ".join(parts[1:])


def oauth_signup_serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(str(current_app.config["JWT_SECRET_KEY"]))


def create_oauth_signup_token(profile: Dict[str, Any]) -> str:
    salt = os.environ.get("OAUTH_SIGNUP_TOKEN_SALT", "oauth-signup")
    return oauth_signup_serializer().dumps(profile, salt=salt)


def decode_oauth_signup_token(token: str) -> Dict[str, Any]:
    salt = os.environ.get("OAUTH_SIGNUP_TOKEN_SALT", "oauth-signup")
    max_age = env_int("OAUTH_SIGNUP_TOKEN_MAX_AGE_SECONDS", 900)
    return oauth_signup_serializer().loads(token, salt=salt, max_age=max_age)


def verify_google_id_token(id_token: str) -> Dict[str, Any]:
    client_id = require_env("GOOGLE_OAUTH_CLIENT_ID")
    jwks_client = PyJWKClient("https://www.googleapis.com/oauth2/v3/certs")
    signing_key = jwks_client.get_signing_key_from_jwt(id_token)
    claims = pyjwt.decode(
        id_token,
        signing_key.key,
        algorithms=["RS256"],
        audience=client_id,
        issuer=["accounts.google.com", "https://accounts.google.com"],
    )

    if not claims.get("email_verified", False):
        raise ValueError("Google account email is not verified.")

    return claims


def verify_microsoft_id_token(id_token: str, school_id: int) -> Dict[str, Any]:
    client_id, tenant_id = get_microsoft_oauth_settings(school_id)

    if not client_id:
        raise RuntimeError(f"{microsoft_env_name(school_id, 'CLIENT_ID')} is not set.")
    if not tenant_id:
        raise RuntimeError(f"{microsoft_env_name(school_id, 'TENANT_ID')} is not set.")

    jwks_client = PyJWKClient(
        f"https://login.microsoftonline.com/{tenant_id}/discovery/v2.0/keys"
    )
    signing_key = jwks_client.get_signing_key_from_jwt(id_token)

    return pyjwt.decode(
        id_token,
        signing_key.key,
        algorithms=["RS256"],
        audience=client_id,
        issuer=f"https://login.microsoftonline.com/{tenant_id}/v2.0",
    )


def build_oauth_profile(
    provider: OAuthProvider,
    claims: Dict[str, Any],
    school_id: int,
) -> Dict[str, Any]:
    if provider == "google":
        email = normalize_email(str(claims.get("email") or ""))
        first_name = (claims.get("given_name") or "").strip()
        last_name = (claims.get("family_name") or "").strip()
        display_name = (claims.get("name") or "").strip()
        external_id = str(claims.get("sub") or "")
    else:
        email = normalize_email(
            str(
                claims.get("preferred_username")
                or claims.get("email")
                or claims.get("upn")
                or ""
            )
        )
        first_name = (claims.get("given_name") or "").strip()
        last_name = (claims.get("family_name") or "").strip()
        display_name = (claims.get("name") or "").strip()
        external_id = str(claims.get("oid") or claims.get("sub") or "")

    if not display_name:
        display_name = " ".join(part for part in [first_name, last_name] if part).strip()

    if not first_name and not last_name:
        first_name, last_name = split_display_name(display_name)

    if not email:
        raise ValueError("No email address was returned by the identity provider.")

    return {
        "provider": provider,
        "school_id": school_id,
        "external_id": external_id,
        "email": email,
        "username": email,
        "first_name": first_name,
        "last_name": last_name,
        "display_name": display_name or email,
    }


def verify_oauth_token(
    provider: OAuthProvider,
    id_token: str,
    school_id: int,
) -> Dict[str, Any]:
    if provider == "google":
        claims = verify_google_id_token(id_token)
    elif provider == "microsoft":
        claims = verify_microsoft_id_token(id_token, school_id)
    else:
        raise ValueError("Unsupported OAuth provider.")
    return build_oauth_profile(provider, claims, school_id)


@jwt.user_identity_loader
def user_identity_lookup(user):
    return user.Id


@jwt.user_lookup_loader
def user_lookup_callback(_jwt_header, jwt_data):
    identity = jwt_data["sub"]
    user = Users.query.filter_by(Id=identity).one_or_none()
    if user is None or is_user_locked(user):
        return None
    return user


@jwt.user_lookup_error_loader
def user_lookup_error_callback(_jwt_header, _jwt_data):
    return make_response(
        {"message": LOCKED_ACCOUNT_MESSAGE},
        HTTPStatus.FORBIDDEN,
    )


@auth_api.route("/get-role", methods=["GET"])
@jwt_required()
@inject
def get_user_role(user_repo: UserRepository = Provide[Container.user_repo]):
    return user_repo.get_user_status()


@auth_api.route("/access-summary", methods=["GET"])
@jwt_required()
def access_summary():
    return make_response(build_access_summary(current_user), HTTPStatus.OK)


@auth_api.route("/oauth/config", methods=["GET"])
def oauth_config():
    school_id = parse_int(request.args.get("school_id"))
    school = get_school_by_id(school_id)

    if school is None:
        return make_response({"message": "School not found."}, HTTPStatus.NOT_FOUND)

    provider = get_school_auth_provider(school)
    response = {
        "enabled": False,
        "provider": provider,
        "school": {
            "id": school.Id,
            "name": school.Name,
            "requires_lab_and_lecture": school_requires_lab_and_lecture(school),
        },
        "google_client_id": "",
        "microsoft_client_id": "",
        "microsoft_authority": "",
    }

    if provider == "google":
        client_id = (os.environ.get("GOOGLE_OAUTH_CLIENT_ID") or "").strip()
        response["enabled"] = bool(client_id)
        response["google_client_id"] = client_id
    elif provider == "microsoft":
        client_id, tenant_id = get_microsoft_oauth_settings(school.Id)
        response["enabled"] = bool(client_id and tenant_id)
        response["microsoft_client_id"] = client_id
        response["microsoft_authority"] = (
            f"https://login.microsoftonline.com/{tenant_id}" if tenant_id else ""
        )
    else:
        return make_response(
            {"message": "This school has an unsupported authentication provider."},
            HTTPStatus.CONFLICT,
        )

    return make_response(response, HTTPStatus.OK)


@auth_api.route("/login", methods=["POST"])
def auth():
    return make_response(
        {"message": "Password login is no longer supported. Choose a school and use Google or Microsoft."},
        HTTPStatus.GONE,
    )


@auth_api.route("/oauth/login", methods=["POST"])
@inject
def oauth_login(user_repo: UserRepository = Provide[Container.user_repo]):
    input_json = request.get_json() or {}
    provider = str(get_value_or_empty(input_json, "provider")).strip().lower()
    id_token = get_value_or_empty(input_json, "id_token").strip()
    school_id = parse_int(get_value_or_empty(input_json, "school_id"))

    if not provider or not id_token or school_id <= 0:
        return make_response(
            {"message": "provider, id_token, and school_id are required."},
            HTTPStatus.NOT_ACCEPTABLE,
        )

    school = get_school_by_id(school_id)
    if school is None:
        return make_response({"message": "School not found."}, HTTPStatus.NOT_FOUND)

    school_provider = get_school_auth_provider(school)
    if provider != school_provider:
        return make_response(
            {"message": f"{school.Name} requires {school_provider.title()} login."},
            HTTPStatus.FORBIDDEN,
        )

    try:
        profile = verify_oauth_token(provider, id_token, school_id)
    except Exception as exc:
        return make_response(
            {"message": f"OAuth login failed: {str(exc)}"},
            HTTPStatus.FORBIDDEN,
        )

    username = profile["username"]

    if user_repo.doesUserExist(username):
        user = user_repo.getUserByName(username)
        if is_user_locked(user):
            return make_response(
                {"message": LOCKED_ACCOUNT_MESSAGE},
                HTTPStatus.FORBIDDEN,
            )

        if not user_has_school_assignment(int(user.Id), school_id):
            return make_response(
                {"message": f"Your MAAT account is not assigned to {school.Name}."},
                HTTPStatus.FORBIDDEN,
            )

        access_token = create_access_token(identity=user)
        return make_response(
            build_session_payload(user, access_token),
            HTTPStatus.OK,
        )

    signup_token = create_oauth_signup_token(profile)
    return make_response(
        {
            "message": "New OAuth User",
            "signup_token": signup_token,
            "oauth_profile": {
                "provider": profile["provider"],
                "email": profile["email"],
                "first_name": profile["first_name"],
                "last_name": profile["last_name"],
                "display_name": profile["display_name"],
            },
        },
        HTTPStatus.OK,
    )


@auth_api.route("/create", methods=["POST"])
def create_user():
    return make_response(
        {"message": "Password-based account creation is no longer supported."},
        HTTPStatus.GONE,
    )


@auth_api.route("/oauth/create", methods=["POST"])
@inject
def create_oauth_user(
    user_repo: UserRepository = Provide[Container.user_repo],
    class_repo: ClassRepository = Provide[Container.class_repo],
):
    input_json = request.get_json() or {}
    signup_token = get_value_or_empty(input_json, "signup_token").strip()
    student_number = get_value_or_empty(input_json, "id")
    school_id = parse_int(get_value_or_empty(input_json, "school_id"))
    class_id = parse_int(get_value_or_empty(input_json, "class_id"))
    lab_id = parse_int(get_value_or_empty(input_json, "lab_id"))
    lecture_id = parse_int(get_value_or_empty(input_json, "lecture_id"))

    if not signup_token:
        return make_response(
            {"message": "signup_token is required."},
            HTTPStatus.NOT_ACCEPTABLE,
        )

    school = get_school_by_id(school_id)
    if school is None:
        return make_response({"message": "School not found."}, HTTPStatus.NOT_FOUND)

    requires_lab_and_lecture = school_requires_lab_and_lecture(school)

    if not (student_number and school_id > 0 and class_id > 0):
        return make_response(
            {"message": "Missing required data. School ID and class are required."},
            HTTPStatus.NOT_ACCEPTABLE,
        )

    if requires_lab_and_lecture and (lab_id <= 0 or lecture_id <= 0):
        return make_response(
            {"message": "Please choose a valid lecture and lab."},
            HTTPStatus.NOT_ACCEPTABLE,
        )

    if not is_valid_school_selection(school_id, class_id, lab_id, lecture_id):
        selection_message = (
            "The selected school, class, lecture, and lab combination is invalid."
            if requires_lab_and_lecture
            else "The selected school and class combination is invalid."
        )
        return make_response(
            {"message": selection_message},
            HTTPStatus.NOT_ACCEPTABLE,
        )

    try:
        profile = decode_oauth_signup_token(signup_token)
    except SignatureExpired:
        return make_response(
            {"message": "Your sign-up session expired. Please sign in again."},
            HTTPStatus.FORBIDDEN,
        )
    except BadSignature:
        return make_response(
            {"message": "Invalid sign-up session. Please sign in again."},
            HTTPStatus.FORBIDDEN,
        )

    token_school_id = parse_int(profile.get("school_id"))
    token_provider = str(profile.get("provider") or "").strip().lower()

    if token_school_id != school_id:
        return make_response(
            {"message": "The selected school does not match the school used to sign in."},
            HTTPStatus.FORBIDDEN,
        )

    if token_provider != get_school_auth_provider(school):
        return make_response(
            {"message": "The login provider does not match the selected school."},
            HTTPStatus.FORBIDDEN,
        )

    username = normalize_email(str(profile.get("username") or profile.get("email") or ""))
    email = normalize_email(str(profile.get("email") or ""))
    first_name = str(profile.get("first_name") or "").strip()
    last_name = str(profile.get("last_name") or "").strip()

    if not username or not email:
        return make_response(
            {"message": "OAuth profile did not contain a usable email address."},
            HTTPStatus.NOT_ACCEPTABLE,
        )

    if user_repo.doesUserExist(username):
        user = user_repo.getUserByName(username)
        if is_user_locked(user):
            return make_response(
                {"message": LOCKED_ACCOUNT_MESSAGE},
                HTTPStatus.FORBIDDEN,
            )
    else:
        user_repo.create_user(username, first_name, last_name, email, student_number)
        user = user_repo.getUserByName(username)

    assignment_lab_id = lab_id if requires_lab_and_lecture else None
    assignment_lecture_id = lecture_id if requires_lab_and_lecture else None
    class_repo.add_class_assignment(
        class_id,
        assignment_lab_id,
        int(user.Id),
        assignment_lecture_id,
    )
    set_class_assignment_role(int(user.Id), class_id, STUDENT_ROLE)

    access_token = create_access_token(identity=user)
    return make_response(
        build_session_payload(user, access_token),
        HTTPStatus.OK,
    )


@auth_api.route("/create_newclass", methods=["POST"])
@jwt_required()
@inject
def add_class(
    user_repo: UserRepository = Provide[Container.user_repo],
    class_repo: ClassRepository = Provide[Container.class_repo],
):
    input_json = request.get_json() or {}
    class_name = get_value_or_empty(input_json, "classid")
    lab_name = get_value_or_empty(input_json, "labid")
    lecture_name = get_value_or_empty(input_json, "lectureid")
    class_id = class_repo.get_class_id(class_name)
    lab_id = class_repo.get_lab_id_withName(lab_name)
    lecture_id = class_repo.get_lecture_id_withName(lecture_name)
    user_id = current_user.Id

    user = user_repo.get_user(user_id)

    if user is None:
        return make_response({"message": "User not found"}, HTTPStatus.NOT_FOUND)

    class_repo.add_class_assignment(class_id, int(lab_id), int(user.Id), int(lecture_id))
    set_class_assignment_role(int(user.Id), int(class_id), get_user_global_role(user))

    access_token = create_access_token(identity=user)
    return make_response(
        build_session_payload(user, access_token),
        HTTPStatus.OK,
    )
