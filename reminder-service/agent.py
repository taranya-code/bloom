"""Bloom Reminder Agent — Google ADK service (Cloud Run service 2).

Receives schedule changes from bloom-core over A2A and pushes proactive
dose-time reminders. Runs independently of the Mastra swarm, demonstrating
cross-framework agent interop (Mastra <-> ADK over A2A).
"""

import os
from datetime import datetime, timedelta, timezone

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.date import DateTrigger
from google.adk.agents import LlmAgent

# gemini-3.6-flash: current GA "workhorse" model (Aug 2026) -- cheapest/fastest in the
# Gemini 3 line and well-suited to this agent's short templated-reminder task. Kept
# env-driven rather than hardcoded so a future model retirement (this project already
# hit that once with gemini-2.5-flash) is a one-line config change, not a code change.
MODEL = os.environ.get("ADK_MODEL", "gemini-3.6-flash")
DEMO_MODE = os.environ.get("DEMO_MODE", "0") == "1"
SLOT_HOURS = {"morning": 8, "afternoon": 13, "evening": 18, "night": 21}

scheduler = BackgroundScheduler()

REMINDER_INSTRUCTION = """
You compose short, warm medication reminders for elderly Indian patients.
Given one medicine (name, purpose, dose, timing, appearance, with/without food),
write a single spoken-style line in the patient's language.
Identify the tablet by APPEARANCE first, then purpose — elderly patients
recognize medicines by look, not brand name. Never add medical advice.
"""

reminder_agent = LlmAgent(
    name="reminder_agent",
    model=MODEL,
    description="Composes vernacular dose-time medication reminders.",
    instruction=REMINDER_INSTRUCTION,
)


def _slots_for(timing_text: str) -> list[str]:
    t = (timing_text or "").lower()
    return [s for s in SLOT_HOURS if s in t] or ["morning"]


def _message_for(med: dict) -> str:
    look = med.get("appearance_hint") or med.get("name", "your medicine")
    food = ""
    if med.get("with_food") is True:
        food = " Take it after food."
    elif med.get("with_food") is False:
        food = " Take it on an empty stomach."
    return (
        f"\u23f0 Medicine time: {look} \u2014 {med.get('dose', '')} "
        f"({med.get('purpose_plain', '')}).{food} \u2014 Bloom"
    )


def deliver(session: str, body: str) -> None:
    """Delivery channel. Console today; WhatsApp/FCM on the roadmap."""
    print(f"[reminder:{session}] {body}", flush=True)


def sync_reminders(session: str, medications: list[dict]) -> int:
    for job in scheduler.get_jobs():
        if job.id.startswith(f"med:{session}:"):
            job.remove()
    count = 0
    for med in medications:
        if not med.get("active", True):
            continue
        for slot in _slots_for(med.get("timing", "")):
            trigger = (
                DateTrigger(run_date=datetime.now(timezone.utc) + timedelta(seconds=45))
                if DEMO_MODE and count == 0
                else CronTrigger(hour=SLOT_HOURS[slot], minute=0)
            )
            scheduler.add_job(
                deliver,
                trigger=trigger,
                id=f"med:{session}:{med['name']}:{slot}",
                args=[session, _message_for(med)],
                replace_existing=True,
            )
            count += 1
    return count
