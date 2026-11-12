import pytest


@pytest.fixture(autouse=True)
def isolated_network_environment(monkeypatch):
    # Unit tests mock HTTP at the boundary and never require workstation proxies.
    for name in ('ALL_PROXY', 'HTTP_PROXY', 'HTTPS_PROXY', 'all_proxy', 'http_proxy', 'https_proxy'):
        monkeypatch.delenv(name, raising=False)
