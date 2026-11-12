import json
import time
from uuid import UUID

import httpx
import pytest
from app.services import gigachat

real_get_token = gigachat.get_token


@pytest.fixture
def transport(monkeypatch):
    monkeypatch.setattr(gigachat, 'get_token', real_get_token)
    monkeypatch.setattr(gigachat, '_token', '')
    monkeypatch.setattr(gigachat, '_expires_at', 0)
    monkeypatch.setattr(gigachat, '_identity', None)
    monkeypatch.setenv('GIGACHAT_CREDENTIALS', 'secret')
    monkeypatch.setenv('GIGACHAT_SCOPE', 'GIGACHAT_API_PERS')
    monkeypatch.delenv('GIGACHAT_CA_BUNDLE_FILE', raising=False)


@pytest.mark.parametrize('multiplier', [1, 1000])
def test_oauth_headers_cache_expiry_and_scope_change(transport, monkeypatch, multiplier):
    requests = []
    def handle(request):
        requests.append(request)
        assert request.url == gigachat.AUTH_URL
        assert request.headers['Authorization'] == 'Basic secret'
        assert UUID(request.headers['RqUID']).version == 4
        assert b'scope=GIGACHAT_API_' in request.content
        return httpx.Response(200, json={'access_token':f'token-{len(requests)}',
                            'expires_at':(time.time()+1800)*multiplier})
    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        assert real_get_token(client) == 'token-1'
        assert real_get_token(client) == 'token-1'
        monkeypatch.setattr(gigachat, '_expires_at', time.time()+10)
        assert real_get_token(client) == 'token-2'
        monkeypatch.setenv('GIGACHAT_SCOPE', 'GIGACHAT_API_B2B')
        assert real_get_token(client) == 'token-3'
    assert len(requests) == 3


def test_401_refreshes_once(transport, monkeypatch):
    calls = []
    def post(self, url, **kwargs):
        calls.append(url)
        if url == gigachat.AUTH_URL:
            return httpx.Response(200, request=httpx.Request('POST', url),
                json={'access_token':f'token-{len(calls)}', 'expires_at':(time.time()+1800)*1000})
        assert kwargs['headers']['Authorization'].startswith('Bearer token-')
        return httpx.Response(401 if len(calls) == 2 else 200,
            request=httpx.Request('POST', url), json={'model':'GigaChat-2'})
    monkeypatch.setattr(httpx.Client, 'post', post)
    assert gigachat.complete({'messages':[]}) == {'model':'GigaChat-2'}
    assert calls == [gigachat.AUTH_URL, gigachat.CHAT_URL]*2


def test_auth_failure_and_invalid_tokens_are_not_cached(transport):
    for payload in ({'access_token':'', 'expires_at':time.time()+1800},
                    {'access_token':'secret', 'expires_at':0}):
        with httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, json=payload))) as client:
            with pytest.raises(ValueError):
                real_get_token(client)
            assert not gigachat._token
    with httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(401, text='secret'))) as client:
        with pytest.raises(httpx.HTTPStatusError):
            real_get_token(client)


def test_tls_ca_added_without_disabling_verification(transport, monkeypatch):
    class Context:
        def load_verify_locations(self, **kwargs):
            assert kwargs == {'cafile':'test-ca.pem'}
    context = Context()
    monkeypatch.setenv('GIGACHAT_CA_BUNDLE_FILE', 'test-ca.pem')
    monkeypatch.setattr(gigachat.ssl, 'create_default_context', lambda: context)
    class Client:
        def __init__(self, **kwargs):
            assert kwargs['verify'] is context
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def post(self, url, **kwargs):
            if url == gigachat.AUTH_URL:
                payload = {'access_token':'token','expires_at':time.time()+1800}
            else:
                payload = {'model':'GigaChat-2'}
            return httpx.Response(200, request=httpx.Request('POST',url), json=payload)
    monkeypatch.setattr(gigachat.httpx, 'Client', Client)
    assert gigachat.complete({})['model'] == 'GigaChat-2'
