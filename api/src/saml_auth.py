"""
SAML Authentication Blueprint - Handles routes at /auth/saml/* as expected by Azure AD
This is separate from the main auth API to match Azure's configured URLs
"""

from http import HTTPStatus
from flask import Blueprint, request, make_response, redirect
from src.services.authentication_service import SAMLAuthenticationService
from src.repositories.user_repository import UserRepository
from flask_jwt_extended import create_access_token
from dependency_injector.wiring import inject, Provide
from container import Container
import os

# Create SAML blueprint with /auth/saml prefix
saml_auth_api = Blueprint('saml_auth_api', __name__)


def init_saml_req(request):
    """Initialize SAML request object for OneLogin library"""
    # Use environment variables for public-facing URL if configured
    public_url = os.getenv('SAML_PUBLIC_URL', '').strip()

    if public_url:
        # Parse public URL (format: https://pioneer.cs.mu.edu)
        is_https = public_url.startswith('https://')
        http_host = public_url.replace('https://', '').replace('http://', '').rstrip('/')
        server_port = '443' if is_https else '80'

        # For HTTPS, we need to set both REQUEST_SCHEME and HTTPS environment variable
        # that OneLogin library checks
        request_scheme = 'https' if is_https else 'http'
    else:
        # Fall back to proxy headers or request data
        forwarded_proto = request.headers.get('X-Forwarded-Proto', request.scheme)
        http_host = request.headers.get('X-Forwarded-Host', request.host)
        is_https = forwarded_proto == 'https'
        server_port = '443' if is_https else '80'
        request_scheme = forwarded_proto

    return {
        'https': 'on' if is_https else 'off',
        'http_host': http_host,
        'server_port': server_port,
        'script_name': request.path,
        'get_data': request.args.copy(),
        'post_data': request.form.copy(),
        'request_uri': request.url,
        'query_string': request.query_string.decode('utf-8')
    }


@saml_auth_api.route('/login', methods=['GET'])
@inject
def saml_login(saml_service: SAMLAuthenticationService = Provide[Container.saml_service]):
    """Initiate SAML login with Azure AD"""
    req = init_saml_req(request)
    login_url = saml_service.get_login_url(req)
    return redirect(login_url)


@saml_auth_api.route('/acs', methods=['POST'])
@inject
def saml_acs(saml_service: SAMLAuthenticationService = Provide[Container.saml_service],
             user_repo: UserRepository = Provide[Container.user_repo]):
    """SAML Assertion Consumer Service - handles Azure response and redirects to frontend"""
    req = init_saml_req(request)
    result = saml_service.process_saml_response(req)

    if not result['success']:
        # Redirect to login page with error
        error_msg = result.get('error_reason', 'Authentication failed')
        return redirect(f'/login?error={error_msg}')

    username = result['username']
    email = result['email']
    first_name = result['first_name']
    last_name = result['last_name']

    # Check if user exists, create if needed
    if not user_repo.doesUserExist(username):
        # For new SAML users, redirect to landing with new_user flag
        # The NewUserModal component will pick this up
        html_response = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <title>New User Registration</title>
        </head>
        <body>
            <script>
                localStorage.setItem('SAML_NEW_USER', 'true');
                localStorage.setItem('SAML_USERNAME', '{username}');
                localStorage.setItem('SAML_EMAIL', '{email}');
                localStorage.setItem('SAML_FIRST_NAME', '{first_name}');
                localStorage.setItem('SAML_LAST_NAME', '{last_name}');
                window.location.href = '/';
            </script>
            <p>Completing registration...</p>
        </body>
        </html>
        """
        response = make_response(html_response)
        response.headers['Content-Type'] = 'text/html'
        return response

    # Existing user - generate JWT token
    user = user_repo.getUserByName(username)
    access_token = create_access_token(identity=user)

    # Create a simple HTML page that stores the token and redirects
    html_response = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <title>Login Successful</title>
    </head>
    <body>
        <script>
            localStorage.setItem('AUTOTA_AUTH_TOKEN', '{access_token}');
            localStorage.setItem('USER_ROLE', '{user.Role}');
            window.location.href = '/';
        </script>
        <p>Login successful. Redirecting...</p>
    </body>
    </html>
    """

    response = make_response(html_response)
    response.headers['Content-Type'] = 'text/html'
    return response


@saml_auth_api.route('/metadata', methods=['GET'])
@inject
def saml_metadata(saml_service: SAMLAuthenticationService = Provide[Container.saml_service]):
    """Return SAML metadata for Azure configuration"""
    req = init_saml_req(request)
    metadata = saml_service.get_metadata(req)

    resp = make_response(metadata)
    resp.headers['Content-Type'] = 'text/xml'
    return resp


@saml_auth_api.route('/initiate', methods=['GET'])
@inject
def saml_initiate(saml_service: SAMLAuthenticationService = Provide[Container.saml_service]):
    """Alternative endpoint for frontend to initiate SAML login"""
    req = init_saml_req(request)
    login_url = saml_service.get_login_url(req)
    return redirect(login_url)
