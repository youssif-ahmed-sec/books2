from fastapi.testclient import TestClient

from print_agent.service import app


def test_browser_from_unknown_origin_cannot_print():
    with TestClient(app) as client:
        response = client.post(
            "/api/print", json={"order": {"id": "x"}},
            headers={"Origin": "https://untrusted.example"},
        )
    assert response.status_code == 403


def test_local_development_origin_passes_preflight():
    with TestClient(app) as client:
        response = client.options(
            "/api/print", headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "POST",
            },
        )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"
