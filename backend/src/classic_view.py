"""
classic_view.py  -  Flask Blueprint  (shallow-connection approach)

Place in:  backend/src/routes/classic_view.py
Register in app factory:
    from src.routes.classic_view import classic_view_api
    app.register_blueprint(classic_view_api, url_prefix='/classic-view')

This blueprint is the ONLY contract between classic TABOT and new TABOT.
It does not create Submission/User/Project rows or touch the new-TABOT
data model in any way. It only stores a parsed-results blob against a
token and serves it back.

Two endpoints:
  POST /classic-view/create   - mailbot calls this with raw TAP text.
                                 Protected by a shared secret (or localhost).
  GET  /classic-view/<token>  - public, no auth; returns the stored payload.
"""

import json
import os
import secrets
import tempfile
from datetime import datetime, timedelta, timezone
from http import HTTPStatus

from flask import Blueprint, jsonify, make_response, request

# Reuse the EXISTING TAP -> JSON converter from the new-TABOT submission code.
# This is the same function the new pipeline uses, so classic results render
# identically to native submissions. No custom parser is maintained here.
from src.routes.submission import convert_tap_to_json

classic_view_api = Blueprint("classic_view_api", __name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _db():
    from src.repositories.database import db
    return db


def _model():
    from src.repositories.models import ClassicSubmissionView
    return ClassicSubmissionView


def _utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _tap_to_results_json(tap_text: str) -> str:
    """
    Convert raw TAP text into the JSON shape DiffView consumes by delegating
    to the existing convert_tap_to_json. That function expects a file PATH,
    so we write the TAP to a temp file, convert, then clean up.

    role / current_level / hasLVLSYSEnabled are passed as a plain student
    view with the level system disabled - classic TABOT has no level gating.
    """
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".tap", delete=False, encoding="utf-8"
        ) as f:
            f.write(tap_text)
            tmp_path = f.name

        return convert_tap_to_json(
            tmp_path,
            role=0,                 # STUDENT_ROLE-equivalent; no elevated info
            current_level=0,
            hasLVLSYSEnabled=False,
        )
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


def _check_mailbot_secret() -> bool:
    """
    Compare the X-Mailbot-Secret header against the MAILBOT_SECRET env var.
    If the env var is not set, only loopback callers are allowed.
    """
    secret = os.environ.get("MAILBOT_SECRET", "")
    if secret:
        return request.headers.get("X-Mailbot-Secret", "") == secret
    return request.remote_addr in ("127.0.0.1", "::1", "localhost")


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@classic_view_api.route("/create", methods=["POST"])
def create_classic_view():
    """
    Called by mailbot.sh (via curl) after grading completes.

    Request JSON:
      {
        "tap_text":        "<full TAP .out file contents>",
        "student_name":    "Angel Mora",
        "assignment_label":"COSC 3250 Spring 2024 HW #03",
        "expires_hours":   168          // optional, default 168 (7 days)
      }

    Response JSON:
      { "token": "...", "url": "https://tabot.example.com/classic/<token>" }
    """
    if not _check_mailbot_secret():
        return make_response({"error": "Forbidden"}, HTTPStatus.FORBIDDEN)

    body = request.get_json(silent=True) or {}
    tap_text = str(body.get("tap_text", ""))
    student_name = str(body.get("student_name", ""))
    assignment_label = str(body.get("assignment_label", ""))
    expires_hours = int(body.get("expires_hours", 168))

    if not tap_text:
        return make_response({"error": "tap_text is required"}, HTTPStatus.BAD_REQUEST)

    try:
        results_json = _tap_to_results_json(tap_text)
    except Exception as exc:
        return make_response(
            {"error": f"Could not parse TAP: {exc}"},
            HTTPStatus.BAD_REQUEST,
        )

    token = secrets.token_urlsafe(32)
    now = _utc_now()
    expires_at = now + timedelta(hours=expires_hours) if expires_hours > 0 else None

    db = _db()
    Model = _model()
    row = Model(
        Token=token,
        ResultsJson=results_json,
        StudentName=student_name,
        AssignmentLabel=assignment_label,
        ExpiresAt=expires_at,
        CreatedAt=now,
    )
    db.session.add(row)
    db.session.commit()

    base_url = os.environ.get("TABOT_BASE_URL", "").rstrip("/")
    url = f"{base_url}/classic/{token}" if base_url else f"/classic/{token}"

    return jsonify({"token": token, "url": url})


@classic_view_api.route("/<token>", methods=["GET"])
def get_classic_view(token: str):
    """
    Public endpoint - no JWT required.
    Returns the stored results JSON so the React page can render it.
    """
    Model = _model()
    row = Model.query.filter(Model.Token == token).first()

    if row is None:
        return make_response({"error": "Not found"}, HTTPStatus.NOT_FOUND)

    if row.ExpiresAt is not None and row.ExpiresAt < _utc_now():
        return make_response({"error": "This link has expired"}, HTTPStatus.GONE)

    try:
        results = json.loads(row.ResultsJson)
    except Exception:
        results = {"results": []}

    return jsonify({
        "studentName": row.StudentName or "",
        "assignmentLabel": row.AssignmentLabel or "",
        "createdAt": row.CreatedAt.isoformat() if row.CreatedAt else "",
        "expiresAt": row.ExpiresAt.isoformat() if row.ExpiresAt else None,
        "results": results,
    })