"""GigaChat transport with verified TLS and synchronized OAuth token renewal."""
import math
import os
import ssl
import threading
import time
from uuid import uuid4

import httpx

AUTH_URL = 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth'
CHAT_URL = 'https://api.giga.chat/v1/chat/completions'
_lock = threading.Lock()
_token = ''
_expires_at = 0.0
_identity = None


def get_token(client: httpx.Client, rejected_token: str | None = None) -> str:
    global _token, _expires_at, _identity
    credentials = os.environ['GIGACHAT_CREDENTIALS'].strip()
    scope = os.getenv('GIGACHAT_SCOPE', 'GIGACHAT_API_PERS').strip()
    identity = (credentials, scope)
    with _lock:
        if (_identity == identity and _token and _expires_at > time.time() + 60
                and _token != rejected_token):
            return _token
        response = client.post(AUTH_URL, headers={
            'Authorization': f'Basic {credentials}', 'RqUID': str(uuid4()),
            'Accept': 'application/json',
        }, data={'scope': scope})
        response.raise_for_status()
        payload = response.json()
        token = payload['access_token']
        expires = float(payload['expires_at'])
        # Accept both Unix seconds and milliseconds used in OAuth responses.
        if expires > 100_000_000_000:
            expires /= 1000
        if not isinstance(token, str) or not token.strip() or not math.isfinite(expires) or expires <= time.time():
            raise ValueError('Invalid OAuth response')
        _token, _expires_at, _identity = token, expires, identity
        return token


def complete(body: dict) -> dict:
    context = ssl.create_default_context()
    bundle = os.getenv('GIGACHAT_CA_BUNDLE_FILE', '').strip()
    if bundle:
        context.load_verify_locations(cafile=bundle)
    with httpx.Client(verify=context, timeout=httpx.Timeout(45, connect=10)) as client:
        token = get_token(client)
        response = client.post(CHAT_URL, headers={'Authorization': f'Bearer {token}'}, json=body)
        if response.status_code == 401:
            token = get_token(client, rejected_token=token)
            response = client.post(CHAT_URL, headers={'Authorization': f'Bearer {token}'}, json=body)
        response.raise_for_status()
        return response.json()
