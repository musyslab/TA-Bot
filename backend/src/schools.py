from flask import Blueprint, jsonify

from src.repositories.models import Schools

school_api = Blueprint("school_api", __name__)


@school_api.route("/all", methods=["GET"])
def get_schools():
    schools = Schools.query.order_by(Schools.Name.asc()).all()
    return jsonify(
        [
            {
                "id": school.Id,
                "name": school.Name,
            }
            for school in schools
        ]
    )