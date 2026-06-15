"""
This is our main file for our application, from here everything else is called.
"""

from container import Container
from datetime import timedelta
from flask import Flask
from flask_cors import CORS
from src.auth import auth_api
from src.repositories.database import db
from src.upload import upload_api
from src.submission import submission_api
from src.projects import projects_api
from src.ai_suggestions import ai_api
from src.classes import class_api
from src.error import error_api
from src.schools import school_api
from src.classic_view import classic_view_api
from src.jwt_manager import jwt
from src import classes, auth, projects, submission, upload, ai_suggestions, schools
from src.services import timeout_service
import os


def require_env(name: str) -> str:
    value = (os.environ.get(name) or "").strip()
    if not value:
        raise RuntimeError(f"{name} is not set.")
    return value


def optional_env(name: str, default: str = "") -> str:
    value = (os.environ.get(name) or "").strip()
    return value if value else default


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


def csv_env(name: str, default: str = "") -> list[str]:
    raw = optional_env(name, default)
    return [item.strip() for item in raw.split(",") if item.strip()]


def build_database_uri() -> str:
    return (
        f"mysql+pymysql://{require_env('DB_USER')}:{require_env('DB_PASSWORD')}"
        f"@{require_env('DB_HOST')}:{require_env('DB_PORT')}/{require_env('DB_NAME')}"
    )


def create_app():
    app = Flask(__name__)
    container = Container()
    app.container = container

    container.wire(
        modules=[
            classes,
            auth,
            projects,
            submission,
            upload,
            ai_suggestions,
            schools,
            timeout_service,
        ]
    )

    tabot_dir = optional_env("TABOT_DIR", "/tabot-files")
    project_files_dir = os.path.join(tabot_dir, "project-files")

    os.makedirs(project_files_dir, exist_ok=True)

    app.config.update(
        {
            "PROJECT_FILES_DIR": project_files_dir,
            "TEACHER_FILES_DIR": project_files_dir,
            "STUDENT_FILES_DIR": project_files_dir,
            "JWT_SECRET_KEY": require_env("JWT_SECRET_KEY"),
            "MAX_FAILED_LOGINS": env_int("MAX_FAILED_LOGINS", 5),
            "MAX_CONTENT_LENGTH": 16 * 1000 * 1000,
            "JWT_ACCESS_TOKEN_EXPIRES": timedelta(
                hours=env_int("JWT_ACCESS_TOKEN_EXPIRES_HOURS", 1)
            ),
            "SQLALCHEMY_TRACK_MODIFICATIONS": False,
            "SQLALCHEMY_DATABASE_URI": build_database_uri(),
        }
    )

    cors_origins = csv_env("CORS_ORIGINS", "http://localhost:3000")
    CORS(app, supports_credentials=True, origins=cors_origins)

    app.register_blueprint(auth_api, url_prefix="/api/auth")
    app.register_blueprint(upload_api, url_prefix="/api/upload")
    app.register_blueprint(submission_api, url_prefix="/api/submissions")
    app.register_blueprint(projects_api, url_prefix="/api/projects")
    app.register_blueprint(ai_api, url_prefix="/api/ai")
    app.register_blueprint(class_api, url_prefix="/api/class")
    app.register_blueprint(error_api, url_prefix="/api/error")
    app.register_blueprint(school_api, url_prefix="/api/schools")
    app.register_blueprint(classic_view_api, url_prefix="/api/classic-view")

    jwt.init_app(app)
    db.init_app(app)

    return app


if __name__ == "__main__":
    app = create_app()
    app.run(debug=env_bool("FLASK_DEBUG", False), host="0.0.0.0", port=5000)