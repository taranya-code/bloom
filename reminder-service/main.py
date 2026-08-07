"""A2A server for the Bloom Reminder Agent (Cloud Run service 2).

Exposes an A2A agent card and the schedule-changed endpoint that bloom-core
(Mastra) calls when a medication schedule is created or modified.
"""

import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from pydantic import BaseModel

from agent import reminder_agent, scheduler, sync_reminders


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    if not scheduler.running:
        scheduler.start()
    yield
    if scheduler.running:
        scheduler.shutdown(wait=False)


app = FastAPI(title="bloom-reminders", version="1.0.0", lifespan=lifespan)


class ScheduleChanged(BaseModel):
    session: str
    medications: list[dict]


@app.get("/.well-known/agent.json")
def agent_card() -> dict:
    """A2A agent card — how bloom-core discovers this agent's capabilities."""
    base = os.environ.get("SERVICE_URL", "http://localhost:8080")
    return {
        "name": "bloom-reminders",
        "description": reminder_agent.description,
        "url": base,
        "version": "1.0.0",
        "capabilities": {"streaming": False, "pushNotifications": True},
        "skills": [
            {
                "id": "schedule-reminders",
                "name": "Schedule medication reminders",
                "description": (
                    "Registers dose-time jobs from a medication schedule and "
                    "pushes proactive reminders."
                ),
                "inputModes": ["application/json"],
                "outputModes": ["application/json"],
            }
        ],
    }


@app.post("/a2a/schedule-changed")
def schedule_changed(payload: ScheduleChanged) -> dict:
    """A2A inbound: bloom-core reports a new/updated medication schedule."""
    count = sync_reminders(payload.session, payload.medications)
    return {"status": "ok", "scheduled": count, "agent": "bloom-reminders"}


@app.get("/health")
def health() -> dict:
    return {"status": "healthy", "jobs": len(scheduler.get_jobs())}
