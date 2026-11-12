from fastapi.testclient import TestClient
import app.main as main


def test_unbuilt_frontend_explains_start_command(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "FRONTEND_DIST", tmp_path)
    with TestClient(main.app) as client:
        response = client.get("/")
        assert response.status_code == 503
        assert "python start.py" in response.json()["error"]
        assert client.get("/health").status_code == 200
        assert client.get("/api/unknown").status_code == 404


def test_frontend_index_and_api_share_server(tmp_path, monkeypatch):
    (tmp_path / "index.html").write_text('<html lang="ru"><div id="root"></div></html>')
    monkeypatch.setattr(main, "FRONTEND_DIST", tmp_path)
    with TestClient(main.app) as client:
        response = client.get("/")
        assert response.status_code == 200
        assert "text/html" in response.headers["content-type"]
        assert 'id="root"' in response.text
        assert len(client.get("/api/shipments").json()) == 4
