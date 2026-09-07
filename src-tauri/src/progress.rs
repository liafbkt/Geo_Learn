use crate::db::Database;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

const DAY_MS: i128 = 86_400_000;
const SKILLS: [&str; 5] = [
    "locate_region",
    "identify_region",
    "associate_capital",
    "locate_place",
    "identify_place",
];
const STAGES: [&str; 6] = ["new", "learning", "weak", "familiar", "solid", "mastered"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressError {
    pub code: String,
    pub message: String,
}

impl ProgressError {
    fn invalid(message: impl Into<String>) -> Self {
        Self {
            code: "invalid_input".to_owned(),
            message: message.into(),
        }
    }

    fn persistence() -> Self {
        Self {
            code: "persistence_failed".to_owned(),
            message: "Unable to persist learning progress.".to_owned(),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MasteryDto {
    learner_id: String,
    pack_id: String,
    entity_id: String,
    skill: String,
    stage: String,
    scheduled_interval_ms: i64,
    due_at: String,
    smoothed_response_ms: Option<f64>,
    updated_at: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttemptEventDto {
    attempt_id: String,
    session_id: String,
    learner_id: String,
    pack_id: String,
    entity_id: String,
    skill: String,
    question_kind: String,
    scheduled_review: bool,
    delayed_retry: bool,
    answer_attempt_count: i64,
    correct: bool,
    used_hint: bool,
    response_ms: i64,
    completed_at: String,
    mode: String,
    independent_correct: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRequestDto {
    mode: String,
    pack_id: String,
    question_count: Option<i64>,
    entity_ids: Option<Vec<String>>,
    skills: Option<Vec<String>>,
    statuses: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnswerSpecDto {
    accepted_display_values: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestionDto {
    kind: String,
    presentation: String,
    entity_id: String,
    capital_id: Option<String>,
    candidate_entity_ids: Option<Vec<String>>,
    answer: Option<AnswerSpecDto>,
    coordinate: Option<[f64; 2]>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetryDebtDto {
    entity_id: String,
    skill: String,
    source_question_kind: String,
    created_at: String,
    priority: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PracticeSessionDto {
    session_id: String,
    learner_id: String,
    request: SessionRequestDto,
    base_question_count: i64,
    introductions: Vec<String>,
    introduction_cursor: i64,
    questions: Vec<QuestionDto>,
    question_cursor: i64,
    carryover_retry_debts: Vec<RetryDebtDto>,
    started_at: String,
    accumulated_pause_ms: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveAttemptInput {
    event: AttemptEventDto,
    session: PracticeSessionDto,
    mastery: MasteryDto,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioSettingsDto {
    enabled: bool,
    pack_id: String,
    volume: f64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AppSettingsDto {
    audio: AudioSettingsDto,
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_alphanumeric() || (index > 0 && matches!(byte, b'.' | b'_' | b':' | b'-'))
        })
}

fn validate_id(value: &str, label: &str) -> Result<(), ProgressError> {
    if valid_id(value) {
        Ok(())
    } else {
        Err(ProgressError::invalid(format!("{label} ID is invalid.")))
    }
}

fn parse_timestamp(value: &str, label: &str) -> Result<OffsetDateTime, ProgressError> {
    if !value.ends_with('Z') {
        return Err(ProgressError::invalid(format!(
            "{label} timestamp must be ISO-8601 UTC."
        )));
    }
    OffsetDateTime::parse(value, &Rfc3339)
        .map_err(|_| ProgressError::invalid(format!("{label} timestamp must be ISO-8601 UTC.")))
}

fn validate_skill(value: &str) -> Result<(), ProgressError> {
    if SKILLS.contains(&value) {
        Ok(())
    } else {
        Err(ProgressError::invalid("Skill is unsupported."))
    }
}

fn validate_mastery(value: &MasteryDto) -> Result<(), ProgressError> {
    validate_id(&value.learner_id, "Learner")?;
    validate_id(&value.pack_id, "Pack")?;
    validate_id(&value.entity_id, "Entity")?;
    validate_skill(&value.skill)?;
    if !STAGES.contains(&value.stage.as_str()) {
        return Err(ProgressError::invalid("Mastery stage is unsupported."));
    }
    if value.scheduled_interval_ms < 0
        || value
            .smoothed_response_ms
            .is_some_and(|ms| !ms.is_finite() || ms < 0.0)
    {
        return Err(ProgressError::invalid("Mastery duration is invalid."));
    }
    parse_timestamp(&value.due_at, "Due")?;
    parse_timestamp(&value.updated_at, "Updated")?;
    Ok(())
}

fn validate_attempt(value: &AttemptEventDto) -> Result<(), ProgressError> {
    validate_id(&value.attempt_id, "Attempt")?;
    validate_id(&value.session_id, "Session")?;
    validate_id(&value.learner_id, "Learner")?;
    validate_id(&value.pack_id, "Pack")?;
    validate_id(&value.entity_id, "Entity")?;
    validate_skill(&value.skill)?;
    validate_skill(&value.question_kind)?;
    if !matches!(value.mode.as_str(), "smart" | "custom" | "placement") {
        return Err(ProgressError::invalid("Practice mode is unsupported."));
    }
    if value.answer_attempt_count != 1 && value.answer_attempt_count != 2 {
        return Err(ProgressError::invalid("Answer attempt count is invalid."));
    }
    if value.response_ms < 0 {
        return Err(ProgressError::invalid("Response duration is invalid."));
    }
    if value.mode == "placement" && value.independent_correct {
        return Err(ProgressError::invalid(
            "Placement attempts cannot be independently correct.",
        ));
    }
    parse_timestamp(&value.completed_at, "Completed")?;
    Ok(())
}

fn validate_question(value: &QuestionDto) -> Result<(), ProgressError> {
    validate_skill(&value.kind)?;
    validate_id(&value.entity_id, "Entity")?;
    if !matches!(value.presentation.as_str(), "map" | "choice" | "text") {
        return Err(ProgressError::invalid(
            "Question presentation is unsupported.",
        ));
    }
    if let Some(capital_id) = &value.capital_id {
        validate_id(capital_id, "Capital")?;
    }
    if let Some(candidate_ids) = &value.candidate_entity_ids {
        if candidate_ids.len() != 4 {
            return Err(ProgressError::invalid(
                "Choice questions require four candidates.",
            ));
        }
        for id in candidate_ids {
            validate_id(id, "Candidate entity")?;
        }
    }
    if value
        .answer
        .as_ref()
        .is_some_and(|answer| answer.accepted_display_values.is_empty())
    {
        return Err(ProgressError::invalid("Text answer values are empty."));
    }
    if value
        .coordinate
        .is_some_and(|coordinate| coordinate.iter().any(|item| !item.is_finite()))
    {
        return Err(ProgressError::invalid("Question coordinate is invalid."));
    }
    Ok(())
}

fn validate_session(value: &PracticeSessionDto) -> Result<(), ProgressError> {
    validate_id(&value.session_id, "Session")?;
    validate_id(&value.learner_id, "Learner")?;
    validate_id(&value.request.pack_id, "Pack")?;
    parse_timestamp(&value.started_at, "Started")?;
    if !matches!(
        value.request.mode.as_str(),
        "smart" | "custom" | "placement"
    ) {
        return Err(ProgressError::invalid("Practice mode is unsupported."));
    }
    if value.request.mode == "custom" {
        let count = value.request.question_count.unwrap_or_default();
        if !(1..=50).contains(&count)
            || value.request.entity_ids.as_ref().is_none_or(Vec::is_empty)
            || value.request.skills.as_ref().is_none_or(Vec::is_empty)
            || value.request.statuses.is_none()
        {
            return Err(ProgressError::invalid("Custom session request is invalid."));
        }
        for entity_id in value.request.entity_ids.as_deref().unwrap_or_default() {
            validate_id(entity_id, "Custom entity")?;
        }
        for skill in value.request.skills.as_deref().unwrap_or_default() {
            validate_skill(skill)?;
        }
        for status in value.request.statuses.as_deref().unwrap_or_default() {
            if !STAGES.contains(&status.as_str()) && status != "fragile" {
                return Err(ProgressError::invalid("Custom status is unsupported."));
            }
        }
    } else if value.request.question_count.is_some()
        || value.request.entity_ids.is_some()
        || value.request.skills.is_some()
        || value.request.statuses.is_some()
    {
        return Err(ProgressError::invalid(
            "Non-custom session request contains custom filters.",
        ));
    }
    if value.base_question_count < 0
        || value.introduction_cursor < 0
        || value.introduction_cursor as usize > value.introductions.len()
        || value.question_cursor < 0
        || value.question_cursor as usize > value.questions.len()
        || value.accumulated_pause_ms < 0
    {
        return Err(ProgressError::invalid(
            "Session cursor or duration is invalid.",
        ));
    }
    for id in &value.introductions {
        validate_id(id, "Introduction entity")?;
    }
    for question in &value.questions {
        validate_question(question)?;
    }
    for debt in &value.carryover_retry_debts {
        validate_id(&debt.entity_id, "Retry entity")?;
        validate_skill(&debt.skill)?;
        validate_skill(&debt.source_question_kind)?;
        parse_timestamp(&debt.created_at, "Retry created")?;
        if debt.priority != "immediate" {
            return Err(ProgressError::invalid("Retry priority is unsupported."));
        }
    }
    Ok(())
}

fn validate_settings(value: &AppSettingsDto) -> Result<(), ProgressError> {
    if !matches!(value.audio.pack_id.as_str(), "crisp" | "soft" | "minimal") {
        return Err(ProgressError::invalid("Audio pack is unsupported."));
    }
    if !value.audio.volume.is_finite() || !(0.0..=1.0).contains(&value.audio.volume) {
        return Err(ProgressError::invalid("Audio volume is invalid."));
    }
    Ok(())
}

fn validate_transaction(input: &SaveAttemptInput) -> Result<(), ProgressError> {
    validate_attempt(&input.event)?;
    validate_mastery(&input.mastery)?;
    validate_session(&input.session)?;
    if input.event.session_id != input.session.session_id
        || input.event.learner_id != input.session.learner_id
        || input.event.pack_id != input.session.request.pack_id
        || input.event.learner_id != input.mastery.learner_id
        || input.event.pack_id != input.mastery.pack_id
        || input.event.entity_id != input.mastery.entity_id
        || input.event.skill != input.mastery.skill
    {
        return Err(ProgressError::invalid(
            "Attempt, mastery, and session scopes do not match.",
        ));
    }
    Ok(())
}

fn json<T: Serialize>(value: &T) -> Result<String, ProgressError> {
    serde_json::to_string(value).map_err(|_| ProgressError::persistence())
}

fn ensure_learner(
    connection: &Connection,
    learner_id: &str,
    created_at: &str,
) -> Result<(), ProgressError> {
    connection
        .execute(
            "INSERT OR IGNORE INTO learner (learner_id, created_at) VALUES (?1, ?2)",
            params![learner_id, created_at],
        )
        .map_err(|_| ProgressError::persistence())?;
    Ok(())
}

fn write_session(
    connection: &Connection,
    session: &PracticeSessionDto,
    updated_at: &str,
) -> Result<(), ProgressError> {
    connection
        .execute(
            "INSERT INTO practice_session (
                session_id, learner_id, pack_id, request_json, base_question_count,
                introductions_json, introduction_cursor, questions_json, question_cursor,
                retry_debts_json, started_at, accumulated_pause_ms, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
             ON CONFLICT(session_id) DO UPDATE SET
                learner_id = excluded.learner_id,
                pack_id = excluded.pack_id,
                request_json = excluded.request_json,
                base_question_count = excluded.base_question_count,
                introductions_json = excluded.introductions_json,
                introduction_cursor = excluded.introduction_cursor,
                questions_json = excluded.questions_json,
                question_cursor = excluded.question_cursor,
                retry_debts_json = excluded.retry_debts_json,
                started_at = excluded.started_at,
                accumulated_pause_ms = excluded.accumulated_pause_ms,
                updated_at = excluded.updated_at",
            params![
                session.session_id,
                session.learner_id,
                session.request.pack_id,
                json(&session.request)?,
                session.base_question_count,
                json(&session.introductions)?,
                session.introduction_cursor,
                json(&session.questions)?,
                session.question_cursor,
                json(&session.carryover_retry_debts)?,
                session.started_at,
                session.accumulated_pause_ms,
                updated_at,
            ],
        )
        .map_err(|_| ProgressError::persistence())?;
    Ok(())
}

pub(crate) fn save_attempt_transaction_on(
    connection: &mut Connection,
    input: &SaveAttemptInput,
) -> Result<(), ProgressError> {
    validate_transaction(input)?;
    let transaction = connection
        .transaction()
        .map_err(|_| ProgressError::persistence())?;
    let duplicate = transaction
        .query_row(
            "SELECT 1 FROM attempt_event WHERE attempt_id = ?1",
            [&input.event.attempt_id],
            |_| Ok(()),
        )
        .optional()
        .map_err(|_| ProgressError::persistence())?
        .is_some();
    if duplicate {
        transaction
            .commit()
            .map_err(|_| ProgressError::persistence())?;
        return Ok(());
    }

    ensure_learner(
        &transaction,
        &input.event.learner_id,
        &input.event.completed_at,
    )?;
    transaction
        .execute(
            "INSERT INTO attempt_event (
                attempt_id, session_id, learner_id, pack_id, entity_id, skill, question_kind,
                scheduled_review, delayed_retry, answer_attempt_count, correct, used_hint,
                response_ms, completed_at, mode, independent_correct
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
            params![
                input.event.attempt_id,
                input.event.session_id,
                input.event.learner_id,
                input.event.pack_id,
                input.event.entity_id,
                input.event.skill,
                input.event.question_kind,
                input.event.scheduled_review,
                input.event.delayed_retry,
                input.event.answer_attempt_count,
                input.event.correct,
                input.event.used_hint,
                input.event.response_ms,
                input.event.completed_at,
                input.event.mode,
                input.event.independent_correct,
            ],
        )
        .map_err(|_| ProgressError::persistence())?;
    transaction
        .execute(
            "INSERT INTO mastery (
                learner_id, pack_id, entity_id, skill, stage, scheduled_interval_ms,
                due_at, smoothed_response_ms, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(learner_id, pack_id, entity_id, skill) DO UPDATE SET
                stage = excluded.stage,
                scheduled_interval_ms = excluded.scheduled_interval_ms,
                due_at = excluded.due_at,
                smoothed_response_ms = excluded.smoothed_response_ms,
                updated_at = excluded.updated_at",
            params![
                input.mastery.learner_id,
                input.mastery.pack_id,
                input.mastery.entity_id,
                input.mastery.skill,
                input.mastery.stage,
                input.mastery.scheduled_interval_ms,
                input.mastery.due_at,
                input.mastery.smoothed_response_ms,
                input.mastery.updated_at,
            ],
        )
        .map_err(|_| ProgressError::persistence())?;
    write_session(&transaction, &input.session, &input.event.completed_at)?;
    transaction
        .commit()
        .map_err(|_| ProgressError::persistence())?;
    Ok(())
}

fn lock_database<'a>(
    database: &'a State<'a, Database>,
) -> Result<std::sync::MutexGuard<'a, Connection>, ProgressError> {
    database.0.lock().map_err(|_| ProgressError::persistence())
}

#[tauri::command]
pub fn load_progress_snapshot(
    database: State<'_, Database>,
    learner_id: String,
    pack_id: String,
) -> Result<Vec<MasteryDto>, ProgressError> {
    validate_id(&learner_id, "Learner")?;
    validate_id(&pack_id, "Pack")?;
    let connection = lock_database(&database)?;
    let mut statement = connection
        .prepare(
            "SELECT learner_id, pack_id, entity_id, skill, stage, scheduled_interval_ms,
                    due_at, smoothed_response_ms, updated_at
             FROM mastery WHERE learner_id = ?1 AND pack_id = ?2
             ORDER BY entity_id, skill",
        )
        .map_err(|_| ProgressError::persistence())?;
    let rows = statement
        .query_map(params![learner_id, pack_id], |row| {
            Ok(MasteryDto {
                learner_id: row.get(0)?,
                pack_id: row.get(1)?,
                entity_id: row.get(2)?,
                skill: row.get(3)?,
                stage: row.get(4)?,
                scheduled_interval_ms: row.get(5)?,
                due_at: row.get(6)?,
                smoothed_response_ms: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })
        .map_err(|_| ProgressError::persistence())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|_| ProgressError::persistence())
}

#[tauri::command]
pub fn save_attempt_transaction(
    database: State<'_, Database>,
    input: SaveAttemptInput,
) -> Result<(), ProgressError> {
    save_attempt_transaction_on(&mut lock_database(&database)?, &input)
}

#[tauri::command]
pub fn save_practice_session(
    database: State<'_, Database>,
    session: PracticeSessionDto,
) -> Result<(), ProgressError> {
    validate_session(&session)?;
    let mut connection = lock_database(&database)?;
    let transaction = connection
        .transaction()
        .map_err(|_| ProgressError::persistence())?;
    ensure_learner(&transaction, &session.learner_id, &session.started_at)?;
    write_session(&transaction, &session, &session.started_at)?;
    transaction
        .commit()
        .map_err(|_| ProgressError::persistence())
}

fn read_sessions(
    connection: &Connection,
    learner_id: &str,
    pack_id: &str,
) -> Result<Vec<PracticeSessionDto>, ProgressError> {
    let mut statement = connection
        .prepare(
            "SELECT session_id, learner_id, request_json, base_question_count,
                    introductions_json, introduction_cursor, questions_json, question_cursor,
                    retry_debts_json, started_at, accumulated_pause_ms
             FROM practice_session WHERE learner_id = ?1 AND pack_id = ?2",
        )
        .map_err(|_| ProgressError::persistence())?;
    let rows = statement
        .query_map(params![learner_id, pack_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, i64>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, String>(9)?,
                row.get::<_, i64>(10)?,
            ))
        })
        .map_err(|_| ProgressError::persistence())?;
    let mut sessions = Vec::new();
    for row in rows {
        let (
            session_id,
            learner_id,
            request_json,
            base_question_count,
            introductions_json,
            introduction_cursor,
            questions_json,
            question_cursor,
            retry_debts_json,
            started_at,
            accumulated_pause_ms,
        ) = row.map_err(|_| ProgressError::persistence())?;
        sessions.push(PracticeSessionDto {
            session_id,
            learner_id,
            request: serde_json::from_str(&request_json)
                .map_err(|_| ProgressError::persistence())?,
            base_question_count,
            introductions: serde_json::from_str(&introductions_json)
                .map_err(|_| ProgressError::persistence())?,
            introduction_cursor,
            questions: serde_json::from_str(&questions_json)
                .map_err(|_| ProgressError::persistence())?,
            question_cursor,
            carryover_retry_debts: serde_json::from_str(&retry_debts_json)
                .map_err(|_| ProgressError::persistence())?,
            started_at,
            accumulated_pause_ms,
        });
    }
    Ok(sessions)
}

#[tauri::command]
pub fn load_resumable_session(
    database: State<'_, Database>,
    learner_id: String,
    pack_id: String,
    now: String,
) -> Result<Option<PracticeSessionDto>, ProgressError> {
    validate_id(&learner_id, "Learner")?;
    validate_id(&pack_id, "Pack")?;
    let now_ms = parse_timestamp(&now, "Current")?.unix_timestamp_nanos() / 1_000_000;
    let connection = lock_database(&database)?;
    let mut eligible = read_sessions(&connection, &learner_id, &pack_id)?
        .into_iter()
        .filter_map(|session| {
            if session.question_cursor as usize >= session.questions.len() {
                return None;
            }
            let started_ms = parse_timestamp(&session.started_at, "Started")
                .ok()?
                .unix_timestamp_nanos()
                / 1_000_000;
            let adjusted_ms = started_ms + i128::from(session.accumulated_pause_ms);
            if now_ms < adjusted_ms || now_ms - adjusted_ms > DAY_MS {
                None
            } else {
                Some((adjusted_ms, session))
            }
        })
        .collect::<Vec<_>>();
    eligible.sort_by(|left, right| {
        right
            .0
            .cmp(&left.0)
            .then_with(|| right.1.session_id.cmp(&left.1.session_id))
    });
    Ok(eligible.into_iter().next().map(|(_, session)| session))
}

#[tauri::command]
pub fn load_attempt_history(
    database: State<'_, Database>,
    learner_id: String,
    pack_id: String,
) -> Result<Vec<AttemptEventDto>, ProgressError> {
    validate_id(&learner_id, "Learner")?;
    validate_id(&pack_id, "Pack")?;
    let connection = lock_database(&database)?;
    let mut statement = connection
        .prepare(
            "SELECT attempt_id, session_id, learner_id, pack_id, entity_id, skill,
                    question_kind, scheduled_review, delayed_retry, answer_attempt_count,
                    correct, used_hint, response_ms, completed_at, mode, independent_correct
             FROM attempt_event
             WHERE learner_id = ?1 AND pack_id = ?2
             ORDER BY completed_at ASC, attempt_id ASC",
        )
        .map_err(|_| ProgressError::persistence())?;
    let rows = statement
        .query_map(params![learner_id, pack_id], |row| {
            Ok(AttemptEventDto {
                attempt_id: row.get(0)?,
                session_id: row.get(1)?,
                learner_id: row.get(2)?,
                pack_id: row.get(3)?,
                entity_id: row.get(4)?,
                skill: row.get(5)?,
                question_kind: row.get(6)?,
                scheduled_review: row.get::<_, i64>(7)? != 0,
                delayed_retry: row.get::<_, i64>(8)? != 0,
                answer_attempt_count: row.get(9)?,
                correct: row.get::<_, i64>(10)? != 0,
                used_hint: row.get::<_, i64>(11)? != 0,
                response_ms: row.get(12)?,
                completed_at: row.get(13)?,
                mode: row.get(14)?,
                independent_correct: row.get::<_, i64>(15)? != 0,
            })
        })
        .map_err(|_| ProgressError::persistence())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|_| ProgressError::persistence())
}

#[tauri::command]
pub fn load_retry_debts(
    database: State<'_, Database>,
    learner_id: String,
    pack_id: String,
) -> Result<Vec<RetryDebtDto>, ProgressError> {
    validate_id(&learner_id, "Learner")?;
    validate_id(&pack_id, "Pack")?;
    let connection = lock_database(&database)?;
    let value: Option<String> = connection
        .query_row(
            "SELECT retry_debts_json FROM practice_session
             WHERE learner_id = ?1 AND pack_id = ?2
             ORDER BY started_at DESC, session_id DESC LIMIT 1",
            params![learner_id, pack_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|_| ProgressError::persistence())?;
    match value {
        Some(value) => serde_json::from_str(&value).map_err(|_| ProgressError::persistence()),
        None => Ok(Vec::new()),
    }
}

fn default_settings() -> AppSettingsDto {
    AppSettingsDto {
        audio: AudioSettingsDto {
            enabled: true,
            pack_id: "crisp".to_owned(),
            volume: 0.7,
        },
    }
}

#[tauri::command]
pub fn load_settings(database: State<'_, Database>) -> Result<AppSettingsDto, ProgressError> {
    let connection = lock_database(&database)?;
    let value: Option<String> = connection
        .query_row(
            "SELECT value_json FROM app_setting WHERE setting_key = 'app'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|_| ProgressError::persistence())?;
    match value {
        Some(value) => {
            let settings =
                serde_json::from_str(&value).map_err(|_| ProgressError::persistence())?;
            validate_settings(&settings)?;
            Ok(settings)
        }
        None => Ok(default_settings()),
    }
}

#[tauri::command]
pub fn save_settings(
    database: State<'_, Database>,
    settings: AppSettingsDto,
) -> Result<(), ProgressError> {
    validate_settings(&settings)?;
    let value = json(&settings)?;
    lock_database(&database)?
        .execute(
            "INSERT INTO app_setting (setting_key, value_json, updated_at)
             VALUES ('app', ?1, '1970-01-01T00:00:00.000Z')
             ON CONFLICT(setting_key) DO UPDATE SET value_json = excluded.value_json",
            [value],
        )
        .map_err(|_| ProgressError::persistence())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{save_attempt_transaction_on, validate_session, SaveAttemptInput};
    use rusqlite::Connection;

    fn connection() -> Connection {
        let connection = Connection::open_in_memory().expect("open in-memory database");
        connection
            .execute_batch(include_str!("../migrations/0001_initial.sql"))
            .expect("apply initial migration");
        connection
    }

    fn input_value(attempt_id: &str, stage: &str, question_cursor: i64) -> serde_json::Value {
        serde_json::json!({
            "event": {
                "attemptId": attempt_id,
                "sessionId": "session-1",
                "learnerId": "learner-1",
                "packId": "china-provinces",
                "entityId": "anhui",
                "skill": "locate_region",
                "questionKind": "locate_region",
                "scheduledReview": false,
                "delayedRetry": false,
                "answerAttemptCount": 1,
                "correct": true,
                "usedHint": false,
                "responseMs": 2000,
                "completedAt": "2026-08-26T12:01:00.000Z",
                "mode": "smart",
                "independentCorrect": true
            },
            "mastery": {
                "learnerId": "learner-1",
                "packId": "china-provinces",
                "entityId": "anhui",
                "skill": "locate_region",
                "stage": stage,
                "scheduledIntervalMs": 86400000,
                "dueAt": "2026-08-27T12:00:00.000Z",
                "smoothedResponseMs": 1294.6,
                "updatedAt": "2026-08-26T12:01:00.000Z"
            },
            "session": {
                "sessionId": "session-1",
                "learnerId": "learner-1",
                "request": { "mode": "smart", "packId": "china-provinces" },
                "baseQuestionCount": 2,
                "introductions": ["anhui", "beijing"],
                "introductionCursor": 1,
                "questions": [
                    { "kind": "locate_region", "presentation": "map", "entityId": "anhui" },
                    { "kind": "locate_region", "presentation": "map", "entityId": "beijing" }
                ],
                "questionCursor": question_cursor,
                "carryoverRetryDebts": [],
                "startedAt": "2026-08-26T12:00:00.000Z",
                "accumulatedPauseMs": 0
            }
        })
    }

    fn input(attempt_id: &str, stage: &str, question_cursor: i64) -> SaveAttemptInput {
        serde_json::from_value(input_value(attempt_id, stage, question_cursor))
            .expect("deserialize transaction fixture")
    }

    #[test]
    fn transaction_inserts_attempt_upserts_mastery_and_advances_session() {
        let mut connection = connection();

        save_attempt_transaction_on(&mut connection, &input("attempt-1", "learning", 1))
            .expect("save complete attempt transaction");

        let attempt_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM attempt_event", [], |row| row.get(0))
            .expect("count attempts");
        let mastery_stage: String = connection
            .query_row("SELECT stage FROM mastery", [], |row| row.get(0))
            .expect("load mastery stage");
        let smoothed_response_ms: f64 = connection
            .query_row("SELECT smoothed_response_ms FROM mastery", [], |row| {
                row.get(0)
            })
            .expect("load fractional EMA");
        let cursor: i64 = connection
            .query_row(
                "SELECT question_cursor FROM practice_session WHERE session_id = 'session-1'",
                [],
                |row| row.get(0),
            )
            .expect("load session cursor");

        assert_eq!(attempt_count, 1);
        assert_eq!(mastery_stage, "learning");
        assert_eq!(smoothed_response_ms, 1294.6);
        assert_eq!(cursor, 1);
    }

    #[test]
    fn final_step_failure_rolls_back_attempt_and_mastery() {
        let mut connection = connection();
        connection
            .execute_batch(
                "CREATE TRIGGER fail_practice_session_write
                 BEFORE INSERT ON practice_session
                 BEGIN
                   SELECT RAISE(ABORT, 'forced final-step session failure');
                 END;",
            )
            .expect("install real SQLite final-step failure trigger");

        let result =
            save_attempt_transaction_on(&mut connection, &input("attempt-1", "learning", 1));

        assert!(result.is_err());
        for table in ["attempt_event", "mastery", "practice_session"] {
            let count: i64 = connection
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .expect("count rolled-back rows");
            assert_eq!(count, 0, "{table} must be rolled back");
        }
    }

    #[test]
    fn duplicate_attempt_does_not_overwrite_mastery_or_advance_session() {
        let mut connection = connection();
        save_attempt_transaction_on(&mut connection, &input("attempt-1", "learning", 1))
            .expect("save original attempt");

        save_attempt_transaction_on(&mut connection, &input("attempt-1", "mastered", 2))
            .expect("duplicate is successful no-op");

        let attempt_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM attempt_event", [], |row| row.get(0))
            .expect("count attempts");
        let (stage, cursor): (String, i64) = connection
            .query_row(
                "SELECT mastery.stage, practice_session.question_cursor
                 FROM mastery JOIN practice_session USING (learner_id, pack_id)",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("load persisted state");

        assert_eq!(attempt_count, 1);
        assert_eq!(stage, "learning");
        assert_eq!(cursor, 1);
    }

    #[test]
    fn custom_request_validates_every_present_filter_value() {
        let invalid_requests = [
            serde_json::json!({
                "mode": "custom",
                "packId": "china-provinces",
                "questionCount": 10,
                "entityIds": ["../bad"],
                "skills": ["locate_region"],
                "statuses": ["learning"]
            }),
            serde_json::json!({
                "mode": "custom",
                "packId": "china-provinces",
                "questionCount": 10,
                "entityIds": ["anhui"],
                "skills": ["unknown"],
                "statuses": ["learning"]
            }),
            serde_json::json!({
                "mode": "custom",
                "packId": "china-provinces",
                "questionCount": 10,
                "entityIds": ["anhui"],
                "skills": ["locate_region"],
                "statuses": ["legendary"]
            }),
            serde_json::json!({
                "mode": "smart",
                "packId": "china-provinces",
                "skills": ["locate_region"]
            }),
        ];

        for request in invalid_requests {
            let mut value = input_value("attempt-1", "learning", 1);
            value["session"]["request"] = request;
            let input: SaveAttemptInput =
                serde_json::from_value(value).expect("deserialize invalid request fixture");
            assert!(validate_session(&input.session).is_err());
        }
    }
}
