import os
from datetime import datetime
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
from src.jwt_manager import jwt
from src.repositories.models import Classes, Labs, LectureSections, Schools, Users
from src.repositories.class_repository import ClassRepository
from src.repositories.user_repository import UserRepository
from src.services.authentication_service import PAMAuthenticationService

auth_api = Blueprint("auth_api", __name__)

OAuthProvider = Literal["google", "microsoft"]
LOCKED_ACCOUNT_MESSAGE = "Your account has been locked! Please contact an administrator!"


def require_env(name: str) -> str:
    value = (os.environ.get(name) or "").strip()
    if not value:
        raise RuntimeError(f"{name} is not set.")
    return value


def env_bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    return raw.strip().lower() in ("1", "true", "yes", "y", "on")


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


def is_user_locked(user: Any) -> bool:
    return bool(getattr(user, "IsLocked", False))

def is_valid_school_selection(school_id: int, class_id: int, lab_id: int, lecture_id: int) -> bool:
    if school_id <= 0 or class_id <= 0 or lab_id <= 0 or lecture_id <= 0:
        return False

    school = Schools.query.filter(Schools.Id == school_id).first()
    school_class = Classes.query.filter(
        Classes.Id == class_id,
        Classes.SchoolId == school_id,
    ).first()
    lab = Labs.query.filter(
        Labs.Id == lab_id,
        Labs.ClassId == class_id,
    ).first()
    lecture = LectureSections.query.filter(
        LectureSections.Id == lecture_id,
        LectureSections.ClassId == class_id,
    ).first()

    return all([school, school_class, lab, lecture])    

def split_display_name(name: str) -> Tuple[str, str]:
    cleaned = (name or "").strip()
    if not cleaned:
        return "", ""
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


def verify_microsoft_id_token(id_token: str) -> Dict[str, Any]:
    client_id = require_env("MICROSOFT_OAUTH_CLIENT_ID")
    tenant_id = require_env("MICROSOFT_TENANT_ID")

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


def build_oauth_profile(provider: OAuthProvider, claims: Dict[str, Any]) -> Dict[str, Any]:
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
        "external_id": external_id,
        "email": email,
        "username": email,
        "first_name": first_name,
        "last_name": last_name,
        "display_name": display_name or email,
    }


def verify_oauth_token(provider: OAuthProvider, id_token: str) -> Dict[str, Any]:
    if provider == "google":
        claims = verify_google_id_token(id_token)
    elif provider == "microsoft":
        claims = verify_microsoft_id_token(id_token)
    else:
        raise ValueError("Unsupported OAuth provider.")
    return build_oauth_profile(provider, claims)


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


@auth_api.route("/oauth/config", methods=["GET"])
def oauth_config():
    tenant_id = (os.environ.get("MICROSOFT_TENANT_ID") or "").strip()

    return make_response(
        {
            "google_enabled": bool((os.environ.get("GOOGLE_OAUTH_CLIENT_ID") or "").strip()),
            "google_client_id": (os.environ.get("GOOGLE_OAUTH_CLIENT_ID") or "").strip(),
            "microsoft_enabled": bool((os.environ.get("MICROSOFT_OAUTH_CLIENT_ID") or "").strip()),
            "microsoft_client_id": (os.environ.get("MICROSOFT_OAUTH_CLIENT_ID") or "").strip(),
            "microsoft_authority": (
                f"https://login.microsoftonline.com/{tenant_id}" if tenant_id else ""
            ),
        },
        HTTPStatus.OK,
    )


@auth_api.route("/login", methods=["POST"])
@inject
def auth(
    auth_service: PAMAuthenticationService = Provide[Container.auth_service],
    user_repo: UserRepository = Provide[Container.user_repo],
):
    input_json = request.get_json() or {}
    username = get_value_or_empty(input_json, "username")
    password = get_value_or_empty(input_json, "password")

    exists = user_repo.doesUserExist(username)

    if exists:
        existing_user = user_repo.getUserByName(username)
        if is_user_locked(existing_user):
            return make_response(
                {"message": LOCKED_ACCOUNT_MESSAGE},
                HTTPStatus.FORBIDDEN,
            )

    if user_repo.can_user_login(username) >= current_app.config["MAX_FAILED_LOGINS"]:
        user_repo.lock_user_account(username)
        return make_response(
            {"message": LOCKED_ACCOUNT_MESSAGE},
            HTTPStatus.FORBIDDEN,
        )

    try:
        authenticated = auth_service.login(username, password)
    except Exception as exc:
        current_app.logger.exception("Authentication service failure")
        return make_response(
            {"message": f"Authentication service unavailable: {str(exc)}"},
            HTTPStatus.SERVICE_UNAVAILABLE,
        )

    if not authenticated:
        if exists:
            user_repo.send_attempt_data(
                username,
                request.remote_addr,
                datetime.now().strftime("%Y/%m/%d %H:%M:%S"),
            )
        return make_response(
            {"message": "Invalid username and/or password! Please try again!"},
            HTTPStatus.FORBIDDEN,
        )

    if not exists:
        return make_response({"message": "New User"}, HTTPStatus.OK)

    user = user_repo.getUserByName(username)
    role = int(getattr(user, "Role", 0) or 0)

    user_repo.clear_failed_attempts(username)
    access_token = create_access_token(identity=user)

    return make_response(
        {
            "message": "Success",
            "access_token": access_token,
            "role": role,
        },
        HTTPStatus.OK,
    )


@auth_api.route("/oauth/login", methods=["POST"])
@inject
def oauth_login(user_repo: UserRepository = Provide[Container.user_repo]):
    input_json = request.get_json() or {}
    provider = str(get_value_or_empty(input_json, "provider")).strip().lower()
    id_token = get_value_or_empty(input_json, "id_token").strip()

    if not provider or not id_token:
        return make_response(
            {"message": "provider and id_token are required."},
            HTTPStatus.NOT_ACCEPTABLE,
        )

    try:
        profile = verify_oauth_token(provider, id_token)
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

        access_token = create_access_token(identity=user)
        return make_response(
            {
                "message": "Success",
                "access_token": access_token,
                "role": int(getattr(user, "Role", 0) or 0),
            },
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
@inject
def create_user(
    auth_service: PAMAuthenticationService = Provide[Container.auth_service],
    user_repo: UserRepository = Provide[Container.user_repo],
    class_repo: ClassRepository = Provide[Container.class_repo],
):
    input_json = request.get_json() or {}
    username = get_value_or_empty(input_json, "username")
    password = get_value_or_empty(input_json, "password")

    if user_repo.doesUserExist(username):
        return make_response({"message": "User already exists"}, HTTPStatus.NOT_ACCEPTABLE)

    if not auth_service.login(username, password):
        return make_response(
            {"message": "Invalid username and/or password! Please try again!"},
            HTTPStatus.FORBIDDEN,
        )

    first_name = get_value_or_empty(input_json, "fname")
    last_name = get_value_or_empty(input_json, "lname")
    student_number = get_value_or_empty(input_json, "id")
    email = normalize_email(get_value_or_empty(input_json, "email"))
    school_id = parse_int(get_value_or_empty(input_json, "school_id"))
    class_id = parse_int(get_value_or_empty(input_json, "class_id"))
    lab_id = parse_int(get_value_or_empty(input_json, "lab_id"))
    lecture_id = parse_int(get_value_or_empty(input_json, "lecture_id"))

    if not (first_name and last_name and student_number and email and school_id and class_id and lab_id and lecture_id):
        return make_response(
            {"message": "Missing required data. All fields are required."},
            HTTPStatus.NOT_ACCEPTABLE,
        )

    if school_id == -1 or class_id == -1 or lab_id == -1 or lecture_id == -1:
        return make_response(
            {"message": "Please fill in valid school, class, lecture, and lab data."},
            HTTPStatus.NOT_ACCEPTABLE,
        )

    if not is_valid_school_selection(school_id, class_id, lab_id, lecture_id):
        return make_response(
            {"message": "The selected school, class, lecture, and lab combination is invalid."},

            HTTPStatus.NOT_ACCEPTABLE,
        )

    user_repo.create_user(username, first_name, last_name, email, student_number)
    user = user_repo.getUserByName(username)
    class_repo.create_assignments(class_id, lab_id, int(user.Id), lecture_id)

    access_token = create_access_token(identity=user)
    return make_response(
        {
            "message": "Success",
            "access_token": access_token,
            "role": 0,
        },
        HTTPStatus.OK,
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

    if not (student_number and school_id and class_id and lab_id and lecture_id):
        return make_response(
            {"message": "Missing required data. School ID, class, lab, and lecture are required."},
            HTTPStatus.NOT_ACCEPTABLE,
        )

    if class_id == -1 or lab_id == -1 or lecture_id == -1:
        return make_response(
            {"message": "Please fill in valid class data."},
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

    class_repo.create_assignments(class_id, lab_id, int(user.Id), lecture_id)

    access_token = create_access_token(identity=user)
    return make_response(
        {
            "message": "Success",
            "access_token": access_token,
            "role": int(getattr(user, "Role", 0) or 0),
        },
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

    user = user_repo.get_user_by_id(user_id)
    class_repo.add_class_assignment(class_id, int(lab_id), int(user.Id), int(lecture_id))

    access_token = create_access_token(identity=user)
    return make_response(
        {
            "message": "Success",
            "access_token": access_token,
            "role": int(getattr(user, "Role", 0) or 0),
        },
        HTTPStatus.OK,
    )