"""Integration-style tests for the FastAPI A2A surface (main.py) using FastAPI's
TestClient (starlette's synchronous test transport -- no real network I/O)."""

from fastapi.testclient import TestClient

from main import app


def test_health_endpoint_reports_healthy():
    with TestClient(app) as client:
        res = client.get("/health")
        assert res.status_code == 200
        body = res.json()
        assert body["status"] == "healthy"
        assert "jobs" in body


def test_agent_card_matches_a2a_discovery_shape():
    with TestClient(app) as client:
        res = client.get("/.well-known/agent.json")
        assert res.status_code == 200
        card = res.json()
        assert card["name"] == "bloom-reminders"
        assert "url" in card
        assert card["capabilities"]["pushNotifications"] is True
        assert card["skills"][0]["id"] == "schedule-reminders"


def test_schedule_changed_registers_jobs_and_returns_count():
    with TestClient(app) as client:
        payload = {
            "session": "test-a2a-session",
            "medications": [
                {"name": "Losartan", "timing": "morning", "active": True},
                {"name": "Vitamin D", "timing": "evening", "active": True},
            ],
        }
        res = client.post("/a2a/schedule-changed", json=payload)
        assert res.status_code == 200
        body = res.json()
        assert body["status"] == "ok"
        assert body["agent"] == "bloom-reminders"
        assert body["scheduled"] == 2


def test_schedule_changed_rejects_malformed_payload():
    with TestClient(app) as client:
        # Missing required "medications" field -> FastAPI/pydantic validation error.
        res = client.post("/a2a/schedule-changed", json={"session": "x"})
        assert res.status_code == 422
