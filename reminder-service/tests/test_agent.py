"""Unit tests for the Bloom Reminder Agent's pure scheduling/formatting logic
(agent.py) -- slot detection from free-text timing, the vernacular reminder
message template, and sync_reminders' job bookkeeping against a real (but
unstarted) APScheduler instance. No network or credentials required: the
LlmAgent itself is constructed but never invoked in these tests."""

from agent import _message_for, _slots_for, scheduler, sync_reminders


def test_slots_for_single_match():
    assert _slots_for("morning") == ["morning"]


def test_slots_for_multiple_matches_preserve_declared_order():
    # SLOT_HOURS is declared morning/afternoon/evening/night -- _slots_for iterates
    # that dict, so the returned order should follow it regardless of input order.
    assert _slots_for("night, morning") == ["morning", "night"]


def test_slots_for_no_match_defaults_to_morning():
    assert _slots_for("") == ["morning"]
    assert _slots_for("as needed") == ["morning"]


def test_slots_for_is_case_insensitive():
    assert _slots_for("MORNING") == ["morning"]


def test_message_for_includes_appearance_hint_and_food_instruction():
    msg = _message_for(
        {
            "name": "Amlodipine",
            "dose": "5mg",
            "purpose_plain": "for blood pressure",
            "with_food": False,
            "appearance_hint": "pink oval tablet",
        }
    )
    assert "pink oval tablet" in msg
    assert "empty stomach" in msg
    assert "5mg" in msg


def test_message_for_falls_back_to_name_when_no_appearance_hint():
    msg = _message_for({"name": "Metformin", "dose": "500mg", "purpose_plain": "diabetes"})
    assert "Metformin" in msg
    # with_food is neither True nor False (absent) -> no food instruction appended.
    assert "food" not in msg.lower()


def test_sync_reminders_schedules_one_job_per_slot_for_active_meds():
    session = "test-session-agent"
    medications = [
        {"name": "Med A", "timing": "morning, night", "active": True},
        {"name": "Med B", "timing": "afternoon", "active": True},
        {"name": "Med C", "timing": "morning", "active": False},  # inactive: should be skipped
    ]
    count = sync_reminders(session, medications)
    assert count == 3  # Med A -> 2 slots, Med B -> 1 slot, Med C skipped

    job_ids = [j.id for j in scheduler.get_jobs() if j.id.startswith(f"med:{session}:")]
    assert len(job_ids) == 3
    assert any("Med A" in j and "morning" in j for j in job_ids)
    assert any("Med A" in j and "night" in j for j in job_ids)
    assert any("Med B" in j and "afternoon" in j for j in job_ids)
    assert not any("Med C" in j for j in job_ids)


def test_sync_reminders_replaces_jobs_for_the_same_session_on_resync():
    session = "test-session-resync"
    sync_reminders(session, [{"name": "Old Med", "timing": "morning", "active": True}])
    before = {j.id for j in scheduler.get_jobs() if j.id.startswith(f"med:{session}:")}
    assert any("Old Med" in j for j in before)

    sync_reminders(session, [{"name": "New Med", "timing": "evening", "active": True}])
    after = {j.id for j in scheduler.get_jobs() if j.id.startswith(f"med:{session}:")}
    assert not any("Old Med" in j for j in after), (
        "stale jobs from the old schedule must be removed"
    )
    assert any("New Med" in j for j in after)
