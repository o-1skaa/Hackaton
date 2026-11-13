import pytest


@pytest.fixture(autouse=True)
def isolated_network_environment(monkeypatch):
    # Unit tests mock HTTP at the boundary and never require workstation proxies.
    for name in ('ALL_PROXY', 'HTTP_PROXY', 'HTTPS_PROXY', 'all_proxy', 'http_proxy', 'https_proxy'):
        monkeypatch.delenv(name, raising=False)


@pytest.fixture(autouse=True)
def isolated_runtime_snapshots(tmp_path, monkeypatch):
    from app.services import data_sources
    monkeypatch.setattr(data_sources, 'RUNTIME_PATH', tmp_path / 'source_snapshots.json')


@pytest.fixture(autouse=True)
def isolated_shipments(tmp_path, monkeypatch):
    import app.main as main
    monkeypatch.setattr(main, 'DB_PATH', tmp_path / 'shipments.sqlite3')
    monkeypatch.setattr(main, 'SHIPMENTS', {k:dict(v) for k,v in main.SHIPMENTS.items() if k in ['SCT-001','SCT-002','SCT-003','SCT-004']})


@pytest.fixture(autouse=True)
def isolated_operations(monkeypatch):
    import app.main as main
    monkeypatch.setattr(main, 'PRECLEARANCE_CHECKS', {})
    monkeypatch.setattr(main, 'EVENTS', {sid: [] for sid in main.SHIPMENTS})
