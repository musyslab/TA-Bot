from abc import ABC, abstractmethod
import os
import requests
import json

def env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().strip('"').strip("'").lower() in ("1", "true", "yes", "y", "on")

class AuthenticationService(ABC):
    """This class is an abstract for our main class PAM AuthenticationService"""

    @abstractmethod
    def login(self, username: str, password: str) -> bool:
        """This is a prototype for our actual method called Login found in the class PAMAuthenticationService"""
        pass

class PAMAuthenticationService(AuthenticationService):
    """This class utalizes the PAM library to authenticate users"""
    def login(self, username, password):
        # when in debug mode, we don't want to authenticate with azure.
        if env_bool("FLASK_DEBUG", False):
            return True

        url = (os.getenv("AUTH_URL") or "").strip()
        if not url:
            raise RuntimeError("AUTH_URL is not set.")

        data = {
            "username": json.dumps(username),
            "password": json.dumps(password),
        }

        response = requests.post(url, json=data, timeout=30)
        response.raise_for_status()
        response_json = response.json()
        return bool(response_json.get("success", False))
