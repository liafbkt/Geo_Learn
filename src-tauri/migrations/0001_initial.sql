PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS learner (
    learner_id TEXT PRIMARY KEY NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS practice_session (
    session_id TEXT PRIMARY KEY NOT NULL,
    learner_id TEXT NOT NULL REFERENCES learner(learner_id) ON DELETE CASCADE,
    pack_id TEXT NOT NULL,
    request_json TEXT NOT NULL,
    base_question_count INTEGER NOT NULL CHECK (base_question_count >= 0),
    introductions_json TEXT NOT NULL,
    introduction_cursor INTEGER NOT NULL CHECK (introduction_cursor >= 0),
    questions_json TEXT NOT NULL,
    question_cursor INTEGER NOT NULL CHECK (question_cursor >= 0),
    retry_debts_json TEXT NOT NULL,
    started_at TEXT NOT NULL,
    accumulated_pause_ms INTEGER NOT NULL CHECK (accumulated_pause_ms >= 0),
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS practice_session_resume_idx
    ON practice_session (learner_id, pack_id, started_at DESC, session_id DESC);

CREATE TABLE IF NOT EXISTS mastery (
    learner_id TEXT NOT NULL REFERENCES learner(learner_id) ON DELETE CASCADE,
    pack_id TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    skill TEXT NOT NULL,
    stage TEXT NOT NULL,
    scheduled_interval_ms INTEGER NOT NULL CHECK (scheduled_interval_ms >= 0),
    due_at TEXT NOT NULL,
    smoothed_response_ms INTEGER,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (learner_id, pack_id, entity_id, skill)
);

CREATE TABLE IF NOT EXISTS attempt_event (
    attempt_id TEXT PRIMARY KEY NOT NULL,
    session_id TEXT NOT NULL REFERENCES practice_session(session_id)
        DEFERRABLE INITIALLY DEFERRED,
    learner_id TEXT NOT NULL REFERENCES learner(learner_id) ON DELETE CASCADE,
    pack_id TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    skill TEXT NOT NULL,
    question_kind TEXT NOT NULL,
    scheduled_review INTEGER NOT NULL CHECK (scheduled_review IN (0, 1)),
    delayed_retry INTEGER NOT NULL CHECK (delayed_retry IN (0, 1)),
    answer_attempt_count INTEGER NOT NULL CHECK (answer_attempt_count IN (1, 2)),
    correct INTEGER NOT NULL CHECK (correct IN (0, 1)),
    used_hint INTEGER NOT NULL CHECK (used_hint IN (0, 1)),
    response_ms INTEGER NOT NULL CHECK (response_ms >= 0),
    completed_at TEXT NOT NULL,
    mode TEXT NOT NULL,
    independent_correct INTEGER NOT NULL CHECK (independent_correct IN (0, 1))
);

CREATE TABLE IF NOT EXISTS app_setting (
    setting_key TEXT PRIMARY KEY NOT NULL,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS content_migration (
    migration_id TEXT PRIMARY KEY NOT NULL,
    pack_id TEXT NOT NULL,
    from_version TEXT NOT NULL,
    to_version TEXT NOT NULL,
    applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_migration (
    version INTEGER PRIMARY KEY NOT NULL,
    applied_at TEXT NOT NULL
);

INSERT OR IGNORE INTO schema_migration (version, applied_at)
VALUES (1, '1970-01-01T00:00:00.000Z');
