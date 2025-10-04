from abc import ABC, abstractmethod
import pam
import os
import requests
import json
from onelogin.saml2.auth import OneLogin_Saml2_Auth
from onelogin.saml2.settings import OneLogin_Saml2_Settings


class AuthenticationService(ABC):
    """This class is an abstract for our main class PAM AuthenticationService"""

    @abstractmethod
    def login(self, username: str, password: str) -> bool:
        """This is a prototype for our actual method called Login found in the class PAMAuthenticationService"""
        pass
    @abstractmethod
    def placeholder(self, username: str, password: str) -> bool:
        """this class exists so pylint isnt annoyed"""
        pass


class PAMAuthenticationService(AuthenticationService):
    """This class utalizes the PAM library to authenticate users"""
    def login(self, username, password):
        # when in debug mode, we don't want to authenticate with azure.
        if os.getenv('FLASK_DEBUG', False):
          return True


        url =  os.getenv('AUTH_URL')
        data = {'username': json.dumps(username),
                 'password': json.dumps(password)}

        response = requests.post(url, json = data)
        response_json = response.json()
        return response_json['success']
    def placeholder(self, username: str, password: str) -> bool:
        """this class exists so pylint isnt annoyed"""
        pass


class SAMLAuthenticationService:
    """SAML authentication service for Azure AD integration"""

    def __init__(self, settings_path: str = None):
        """Initialize with path to SAML settings JSON file"""
        if settings_path is None:
            settings_path = os.path.join(
                os.path.dirname(__file__),
                'saml_settings.json'
            )
        self.settings_path = settings_path

    def _load_settings(self):
        """Load SAML settings from JSON file"""
        with open(self.settings_path, 'r') as f:
            settings = json.load(f)

        # Override URLs with environment variable if set
        public_url = os.getenv('SAML_PUBLIC_URL', '').strip()
        print(f"[SAML Settings] SAML_PUBLIC_URL from env: '{public_url}'")

        if public_url:
            # Update the SP URLs to use the public URL
            settings['sp']['assertionConsumerService']['url'] = f"{public_url}/api/auth/saml/acs"
            settings['sp']['singleLogoutService']['url'] = f"{public_url}/api/auth/saml/sls"
            settings['sp']['entityId'] = f"{public_url}/tabot"
            print(f"[SAML Settings] Updated ACS URL to: {settings['sp']['assertionConsumerService']['url']}")
        else:
            print(f"[SAML Settings] No public URL set, using settings from file")
            print(f"[SAML Settings] ACS URL from file: {settings['sp']['assertionConsumerService']['url']}")

        return settings

    def get_login_url(self, req: dict) -> str:
        """Generate SAML SSO login URL"""
        settings = self._load_settings()
        auth = OneLogin_Saml2_Auth(req, settings)
        return auth.login()

    def process_saml_response(self, req: dict) -> dict:
        """
        Process SAML response from IdP
        Returns dict with keys: success, username, email, first_name, last_name, errors
        """
        settings = self._load_settings()
        auth = OneLogin_Saml2_Auth(req, settings)

        auth.process_response()
        errors = auth.get_errors()

        if errors:
            return {
                'success': False,
                'errors': errors,
                'error_reason': auth.get_last_error_reason()
            }

        if not auth.is_authenticated():
            return {
                'success': False,
                'errors': ['Not authenticated']
            }

        # Extract user attributes from SAML response
        attributes = auth.get_attributes()
        nameid = auth.get_nameid()

        # Azure AD typically provides these attributes
        # Adjust based on your Azure AD configuration
        email = attributes.get('http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress', [nameid])[0]
        first_name = attributes.get('http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname', [''])[0]
        last_name = attributes.get('http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname', [''])[0]
        username = attributes.get('http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name', [email.split('@')[0]])[0]

        return {
            'success': True,
            'username': username,
            'email': email,
            'first_name': first_name,
            'last_name': last_name,
            'attributes': attributes
        }

    def get_metadata(self, req: dict) -> str:
        """Generate SP metadata XML for IdP configuration"""
        settings = self._load_settings()
        auth = OneLogin_Saml2_Auth(req, settings)
        saml_settings = auth.get_settings()
        metadata = saml_settings.get_sp_metadata()
        errors = saml_settings.validate_metadata(metadata)

        if errors:
            raise Exception(f"Invalid SP metadata: {', '.join(errors)}")

        return metadata
