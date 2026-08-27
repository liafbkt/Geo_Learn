use crate::db::Database;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs::{File, OpenOptions};
use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::{DialogExt, FilePath};
use time::{format_description::well_known::Rfc3339, Duration, OffsetDateTime};
use uuid::Uuid;
use zip::write::SimpleFileOptions;

pub const MAX_ARCHIVE_BYTES: usize = 24 * 1024 * 1024;
pub const MAX_ENTRY_BYTES: usize = 8 * 1024 * 1024;
pub const STAGE_TTL_SECONDS: i64 = 5 * 60;
const REQUIRED_ENTRIES: [&str; 4] = [
    "manifest.json",
    "progress.json",
    "sessions.json",
    "settings.json",
];
const SKILLS: [&str; 5] = [
    "locate_region",
    "identify_region",
    "associate_capital",
    "locate_place",
    "identify_place",
];
const STAGES: [&str; 6] = ["new", "learning", "weak", "familiar", "solid", "mastered"];

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BackupError {
    pub code: String,
    pub message: String,
}

impl BackupError {
    fn new(code: &str, message: &str) -> Self {
        Self {
            code: code.to_owned(),
            message: message.to_owned(),
        }
    }

    fn invalid_archive() -> Self {
        Self::new("invalid_archive", "The selected backup archive is invalid.")
    }

    fn invalid_data() -> Self {
        Self::new("invalid_data", "The backup contains invalid learning data.")
    }

    fn import_failed() -> Self {
        Self::new("import_failed", "Unable to import the backup safely.")
    }

    fn export_failed() -> Self {
        Self::new("export_failed", "Unable to write the backup file.")
    }

    pub fn safety_backup() -> Self {
        Self::new(
            "safety_backup_failed",
            "Unable to create the pre-import safety backup.",
        )
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ArchiveManifest {
    format: String,
    version: u64,
    exported_at: String,
    learner_id: String,
    pack_versions: BTreeMap<String, String>,
    checksums: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MasteryRecord {
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
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AttemptRecord {
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
#[serde(deny_unknown_fields)]
struct ProgressDocument {
    mastery: Vec<MasteryRecord>,
    attempts: Vec<AttemptRecord>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SessionRecord {
    session: Value,
    saved_at: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AudioSettings {
    enabled: bool,
    pack_id: String,
    volume: f64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct AppSettings {
    audio: AudioSettings,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BackupSummary {
    pub exported_at: String,
    pub learner_id: String,
    pub pack_versions: BTreeMap<String, String>,
    pub mastery_count: usize,
    pub attempt_count: usize,
    pub session_count: usize,
    pub includes_settings: bool,
}

#[derive(Debug, Clone)]
pub struct InspectedBackup {
    pub summary: BackupSummary,
    manifest: ArchiveManifest,
    progress: ProgressDocument,
    sessions: Vec<SessionRecord>,
    settings: AppSettings,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StagedBackupSummary {
    pub staging_id: String,
    #[serde(flatten)]
    pub summary: BackupSummary,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ImportMode {
    Merge,
    Replace,
}

#[derive(Debug)]
struct StageEntry {
    expires_at: OffsetDateTime,
    backup: InspectedBackup,
}

#[derive(Debug, Default)]
pub struct BackupStages {
    entries: HashMap<String, StageEntry>,
}

impl BackupStages {
    pub fn insert(&mut self, backup: InspectedBackup, now: OffsetDateTime) -> StagedBackupSummary {
        self.entries.retain(|_, entry| entry.expires_at >= now);
        let staging_id = Uuid::new_v4().simple().to_string();
        self.entries.insert(
            staging_id.clone(),
            StageEntry {
                expires_at: now + Duration::seconds(STAGE_TTL_SECONDS),
                backup: backup.clone(),
            },
        );
        StagedBackupSummary {
            staging_id,
            summary: backup.summary,
        }
    }

    pub fn take(
        &mut self,
        staging_id: &str,
        now: OffsetDateTime,
    ) -> Result<InspectedBackup, BackupError> {
        let entry = self.entries.remove(staging_id).ok_or_else(|| {
            BackupError::new("invalid_stage", "The staged backup is unavailable.")
        })?;
        if entry.expires_at < now {
            return Err(BackupError::new(
                "expired_stage",
                "The staged backup has expired.",
            ));
        }
        Ok(entry.backup)
    }
}

fn parse_timestamp(value: &str) -> Result<OffsetDateTime, BackupError> {
    if !value.ends_with('Z') {
        return Err(BackupError::invalid_data());
    }
    OffsetDateTime::parse(value, &Rfc3339).map_err(|_| BackupError::invalid_data())
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_alphanumeric() || (index > 0 && matches!(byte, b'.' | b'_' | b':' | b'-'))
        })
}

fn validate_mastery(value: &MasteryRecord, learner_id: &str) -> Result<(), BackupError> {
    if value.learner_id != learner_id
        || !valid_id(&value.learner_id)
        || !valid_id(&value.pack_id)
        || !valid_id(&value.entity_id)
        || !SKILLS.contains(&value.skill.as_str())
        || !STAGES.contains(&value.stage.as_str())
        || value.scheduled_interval_ms < 0
        || value
            .smoothed_response_ms
            .is_some_and(|item| !item.is_finite() || item < 0.0)
    {
        return Err(BackupError::invalid_data());
    }
    parse_timestamp(&value.due_at)?;
    parse_timestamp(&value.updated_at)?;
    Ok(())
}

fn validate_attempt(value: &AttemptRecord, learner_id: &str) -> Result<(), BackupError> {
    if value.learner_id != learner_id
        || !valid_id(&value.attempt_id)
        || !valid_id(&value.session_id)
        || !valid_id(&value.learner_id)
        || !valid_id(&value.pack_id)
        || !valid_id(&value.entity_id)
        || !SKILLS.contains(&value.skill.as_str())
        || !SKILLS.contains(&value.question_kind.as_str())
        || !matches!(value.answer_attempt_count, 1 | 2)
        || value.response_ms < 0
        || !matches!(value.mode.as_str(), "smart" | "custom" | "placement")
        || (value.mode == "placement" && value.independent_correct)
    {
        return Err(BackupError::invalid_data());
    }
    parse_timestamp(&value.completed_at)?;
    Ok(())
}

fn required_string<'a>(value: &'a Value, key: &str) -> Result<&'a str, BackupError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|item| !item.is_empty())
        .ok_or_else(BackupError::invalid_data)
}

fn required_nonnegative(value: &Value, key: &str) -> Result<i64, BackupError> {
    value
        .get(key)
        .and_then(Value::as_i64)
        .filter(|item| *item >= 0)
        .ok_or_else(BackupError::invalid_data)
}

fn validate_session(value: &SessionRecord, learner_id: &str) -> Result<(), BackupError> {
    parse_timestamp(&value.saved_at)?;
    let session = value
        .session
        .as_object()
        .ok_or_else(BackupError::invalid_data)?;
    let session_value = Value::Object(session.clone());
    let session_id = required_string(&session_value, "sessionId")?;
    let session_learner = required_string(&session_value, "learnerId")?;
    let request = session_value
        .get("request")
        .and_then(Value::as_object)
        .ok_or_else(BackupError::invalid_data)?;
    let pack_id = request
        .get("packId")
        .and_then(Value::as_str)
        .ok_or_else(BackupError::invalid_data)?;
    let mode = request
        .get("mode")
        .and_then(Value::as_str)
        .ok_or_else(BackupError::invalid_data)?;
    let introductions = session_value
        .get("introductions")
        .and_then(Value::as_array)
        .ok_or_else(BackupError::invalid_data)?;
    let questions = session_value
        .get("questions")
        .and_then(Value::as_array)
        .ok_or_else(BackupError::invalid_data)?;
    let debts = session_value
        .get("carryoverRetryDebts")
        .and_then(Value::as_array)
        .ok_or_else(BackupError::invalid_data)?;
    let introduction_cursor = required_nonnegative(&session_value, "introductionCursor")?;
    let question_cursor = required_nonnegative(&session_value, "questionCursor")?;
    if session_learner != learner_id
        || !valid_id(session_id)
        || !valid_id(session_learner)
        || !valid_id(pack_id)
        || !matches!(mode, "smart" | "custom" | "placement")
        || required_nonnegative(&session_value, "baseQuestionCount").is_err()
        || required_nonnegative(&session_value, "accumulatedPauseMs").is_err()
        || introduction_cursor as usize > introductions.len()
        || question_cursor as usize > questions.len()
        || introductions
            .iter()
            .any(|item| item.as_str().is_none_or(|id| !valid_id(id)))
        || questions.iter().any(|item| {
            item.get("kind")
                .and_then(Value::as_str)
                .is_none_or(|kind| !SKILLS.contains(&kind))
                || item
                    .get("entityId")
                    .and_then(Value::as_str)
                    .is_none_or(|id| !valid_id(id))
        })
        || debts.iter().any(|item| {
            item.get("entityId")
                .and_then(Value::as_str)
                .is_none_or(|id| !valid_id(id))
                || item
                    .get("skill")
                    .and_then(Value::as_str)
                    .is_none_or(|skill| !SKILLS.contains(&skill))
        })
    {
        return Err(BackupError::invalid_data());
    }
    parse_timestamp(required_string(&session_value, "startedAt")?)?;
    Ok(())
}

fn validate_settings(value: &AppSettings) -> Result<(), BackupError> {
    let _enabled = value.audio.enabled;
    if !matches!(value.audio.pack_id.as_str(), "crisp" | "soft" | "minimal")
        || !value.audio.volume.is_finite()
        || !(0.0..=1.0).contains(&value.audio.volume)
    {
        return Err(BackupError::invalid_data());
    }
    Ok(())
}

fn validate_documents(
    manifest: &ArchiveManifest,
    progress: &ProgressDocument,
    sessions: &[SessionRecord],
    settings: &AppSettings,
) -> Result<(), BackupError> {
    if manifest.format != "geolearn-backup" || !valid_id(&manifest.learner_id) {
        return Err(BackupError::invalid_data());
    }
    parse_timestamp(&manifest.exported_at)?;
    if manifest
        .pack_versions
        .iter()
        .any(|(id, version)| !valid_id(id) || version.is_empty())
    {
        return Err(BackupError::invalid_data());
    }
    for record in &progress.mastery {
        validate_mastery(record, &manifest.learner_id)?;
    }
    let mut attempts = BTreeMap::new();
    for record in &progress.attempts {
        validate_attempt(record, &manifest.learner_id)?;
        let encoded = serde_json::to_vec(record).map_err(|_| BackupError::invalid_data())?;
        if attempts
            .insert(record.attempt_id.as_str(), encoded.clone())
            .is_some_and(|existing| existing != encoded)
        {
            return Err(BackupError::invalid_data());
        }
    }
    for record in sessions {
        validate_session(record, &manifest.learner_id)?;
    }
    validate_settings(settings)
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn normalize_progress(progress: &mut ProgressDocument) -> Result<(), BackupError> {
    let mut attempts = BTreeMap::new();
    for record in std::mem::take(&mut progress.attempts) {
        attempts.entry(record.attempt_id.clone()).or_insert(record);
    }
    progress.attempts = attempts.into_values().collect();

    let mut mastery = BTreeMap::<(String, String, String, String), MasteryRecord>::new();
    for candidate in std::mem::take(&mut progress.mastery) {
        let key = (
            candidate.learner_id.clone(),
            candidate.pack_id.clone(),
            candidate.entity_id.clone(),
            candidate.skill.clone(),
        );
        if let Some(current) = mastery.get(&key) {
            let candidate_count = independent_count(
                &progress.attempts,
                &candidate.learner_id,
                &candidate.pack_id,
                &candidate.entity_id,
                &candidate.skill,
            );
            let current_count = independent_count(
                &progress.attempts,
                &current.learner_id,
                &current.pack_id,
                &current.entity_id,
                &current.skill,
            );
            let replace = candidate.updated_at.as_str() > current.updated_at.as_str()
                || (candidate.updated_at == current.updated_at && candidate_count > current_count)
                || (candidate.updated_at == current.updated_at
                    && candidate_count == current_count
                    && canonical_json(&candidate)? < canonical_json(current)?);
            if replace {
                mastery.insert(key, candidate);
            }
        } else {
            mastery.insert(key, candidate);
        }
    }
    progress.mastery = mastery.into_values().collect();
    Ok(())
}

fn normalize_sessions(sessions: &mut Vec<SessionRecord>) -> Result<(), BackupError> {
    let mut output = BTreeMap::<String, SessionRecord>::new();
    for candidate in std::mem::take(sessions) {
        let id = required_string(&candidate.session, "sessionId")?.to_owned();
        if let Some(current) = output.get(&id) {
            let candidate_question = required_nonnegative(&candidate.session, "questionCursor")?;
            let current_question = required_nonnegative(&current.session, "questionCursor")?;
            let candidate_introduction =
                required_nonnegative(&candidate.session, "introductionCursor")?;
            let current_introduction =
                required_nonnegative(&current.session, "introductionCursor")?;
            let replace = candidate_question > current_question
                || (candidate_question == current_question
                    && candidate_introduction > current_introduction)
                || (candidate_question == current_question
                    && candidate_introduction == current_introduction
                    && candidate.saved_at.as_str() > current.saved_at.as_str())
                || (candidate_question == current_question
                    && candidate_introduction == current_introduction
                    && candidate.saved_at == current.saved_at
                    && canonical_json(&candidate)? < canonical_json(current)?);
            if replace {
                output.insert(id, candidate);
            }
        } else {
            output.insert(id, candidate);
        }
    }
    *sessions = output.into_values().collect();
    Ok(())
}

pub fn inspect_archive_bytes(bytes: &[u8]) -> Result<InspectedBackup, BackupError> {
    if bytes.len() > MAX_ARCHIVE_BYTES {
        return Err(BackupError::new(
            "archive_too_large",
            "The selected backup is too large.",
        ));
    }
    let reader = Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(reader).map_err(|_| BackupError::invalid_archive())?;
    if archive.len() != REQUIRED_ENTRIES.len() {
        return Err(BackupError::invalid_archive());
    }
    let mut documents = BTreeMap::new();
    let mut total_size = 0_u64;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|_| BackupError::invalid_archive())?;
        let name = entry.name().to_owned();
        let symlink = entry
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000);
        if !entry.is_file()
            || symlink
            || !REQUIRED_ENTRIES.contains(&name.as_str())
            || documents.contains_key(&name)
        {
            return Err(BackupError::invalid_archive());
        }
        if entry.size() > MAX_ENTRY_BYTES as u64 || entry.compressed_size() > MAX_ENTRY_BYTES as u64
        {
            return Err(BackupError::new(
                "archive_too_large",
                "The selected backup is too large.",
            ));
        }
        total_size = total_size.saturating_add(entry.size());
        if total_size > MAX_ARCHIVE_BYTES as u64 {
            return Err(BackupError::new(
                "archive_too_large",
                "The selected backup is too large.",
            ));
        }
        let mut content = Vec::with_capacity(entry.size() as usize);
        entry
            .by_ref()
            .take(MAX_ENTRY_BYTES as u64 + 1)
            .read_to_end(&mut content)
            .map_err(|_| BackupError::invalid_archive())?;
        if content.len() > MAX_ENTRY_BYTES {
            return Err(BackupError::new(
                "archive_too_large",
                "The selected backup is too large.",
            ));
        }
        documents.insert(name, content);
    }
    if documents.len() != REQUIRED_ENTRIES.len() {
        return Err(BackupError::invalid_archive());
    }
    let manifest: ArchiveManifest = serde_json::from_slice(
        documents
            .get("manifest.json")
            .ok_or_else(BackupError::invalid_archive)?,
    )
    .map_err(|_| BackupError::invalid_data())?;
    if manifest.version != 1 {
        return Err(BackupError::new(
            "unsupported_version",
            "This backup version is not supported.",
        ));
    }
    let checksum_names = BTreeSet::from([
        "progress.json".to_owned(),
        "sessions.json".to_owned(),
        "settings.json".to_owned(),
    ]);
    if manifest.checksums.keys().cloned().collect::<BTreeSet<_>>() != checksum_names {
        return Err(BackupError::invalid_data());
    }
    for name in ["progress.json", "sessions.json", "settings.json"] {
        let content = documents
            .get(name)
            .ok_or_else(BackupError::invalid_archive)?;
        if manifest.checksums.get(name).is_none_or(|hash| {
            hash.len() != 64
                || !hash.bytes().all(|byte| byte.is_ascii_hexdigit())
                || hash.to_ascii_lowercase() != sha256(content)
        }) {
            return Err(BackupError::new(
                "checksum_mismatch",
                "The backup integrity check failed.",
            ));
        }
    }
    let mut progress: ProgressDocument = serde_json::from_slice(&documents["progress.json"])
        .map_err(|_| BackupError::invalid_data())?;
    let mut sessions: Vec<SessionRecord> = serde_json::from_slice(&documents["sessions.json"])
        .map_err(|_| BackupError::invalid_data())?;
    let settings: AppSettings = serde_json::from_slice(&documents["settings.json"])
        .map_err(|_| BackupError::invalid_data())?;
    validate_documents(&manifest, &progress, &sessions, &settings)?;
    normalize_progress(&mut progress)?;
    normalize_sessions(&mut sessions)?;
    let summary = BackupSummary {
        exported_at: manifest.exported_at.clone(),
        learner_id: manifest.learner_id.clone(),
        pack_versions: manifest.pack_versions.clone(),
        mastery_count: progress.mastery.len(),
        attempt_count: progress.attempts.len(),
        session_count: sessions.len(),
        includes_settings: true,
    };
    Ok(InspectedBackup {
        summary,
        manifest,
        progress,
        sessions,
        settings,
    })
}

fn zip_documents(
    exported_at: &str,
    learner_id: &str,
    pack_versions: &BTreeMap<String, String>,
    progress: &ProgressDocument,
    sessions: &[SessionRecord],
    settings: &AppSettings,
) -> Result<Vec<u8>, BackupError> {
    let progress_bytes = serde_json::to_vec(progress).map_err(|_| BackupError::export_failed())?;
    let sessions_bytes = serde_json::to_vec(sessions).map_err(|_| BackupError::export_failed())?;
    let settings_bytes = serde_json::to_vec(settings).map_err(|_| BackupError::export_failed())?;
    let checksums = BTreeMap::from([
        ("progress.json".to_owned(), sha256(&progress_bytes)),
        ("sessions.json".to_owned(), sha256(&sessions_bytes)),
        ("settings.json".to_owned(), sha256(&settings_bytes)),
    ]);
    let manifest = ArchiveManifest {
        format: "geolearn-backup".to_owned(),
        version: 1,
        exported_at: exported_at.to_owned(),
        learner_id: learner_id.to_owned(),
        pack_versions: pack_versions.clone(),
        checksums,
    };
    let entries = [
        (
            "manifest.json",
            serde_json::to_vec(&manifest).map_err(|_| BackupError::export_failed())?,
        ),
        ("progress.json", progress_bytes),
        ("sessions.json", sessions_bytes),
        ("settings.json", settings_bytes),
    ];
    let cursor = Cursor::new(Vec::new());
    let mut writer = zip::ZipWriter::new(cursor);
    for (name, content) in entries {
        writer
            .start_file(
                name,
                SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated),
            )
            .map_err(|_| BackupError::export_failed())?;
        writer
            .write_all(&content)
            .map_err(|_| BackupError::export_failed())?;
    }
    writer
        .finish()
        .map(Cursor::into_inner)
        .map_err(|_| BackupError::export_failed())
}

fn read_progress(
    connection: &Connection,
    learner_id: &str,
) -> Result<ProgressDocument, BackupError> {
    let mut mastery_statement = connection
        .prepare(
            "SELECT learner_id, pack_id, entity_id, skill, stage, scheduled_interval_ms,
                    due_at, smoothed_response_ms, updated_at
             FROM mastery WHERE learner_id = ?1
             ORDER BY learner_id, pack_id, entity_id, skill",
        )
        .map_err(|_| BackupError::export_failed())?;
    let mastery = mastery_statement
        .query_map([learner_id], |row| {
            Ok(MasteryRecord {
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
        .map_err(|_| BackupError::export_failed())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| BackupError::export_failed())?;
    let mut attempt_statement = connection
        .prepare(
            "SELECT attempt_id, session_id, learner_id, pack_id, entity_id, skill,
                    question_kind, scheduled_review, delayed_retry, answer_attempt_count,
                    correct, used_hint, response_ms, completed_at, mode, independent_correct
             FROM attempt_event WHERE learner_id = ?1 ORDER BY attempt_id",
        )
        .map_err(|_| BackupError::export_failed())?;
    let attempts = attempt_statement
        .query_map([learner_id], attempt_from_row)
        .map_err(|_| BackupError::export_failed())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| BackupError::export_failed())?;
    Ok(ProgressDocument { mastery, attempts })
}

fn attempt_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AttemptRecord> {
    Ok(AttemptRecord {
        attempt_id: row.get(0)?,
        session_id: row.get(1)?,
        learner_id: row.get(2)?,
        pack_id: row.get(3)?,
        entity_id: row.get(4)?,
        skill: row.get(5)?,
        question_kind: row.get(6)?,
        scheduled_review: row.get(7)?,
        delayed_retry: row.get(8)?,
        answer_attempt_count: row.get(9)?,
        correct: row.get(10)?,
        used_hint: row.get(11)?,
        response_ms: row.get(12)?,
        completed_at: row.get(13)?,
        mode: row.get(14)?,
        independent_correct: row.get(15)?,
    })
}

fn read_sessions(
    connection: &Connection,
    learner_id: &str,
) -> Result<Vec<SessionRecord>, BackupError> {
    let mut statement = connection
        .prepare(
            "SELECT session_id, learner_id, request_json, base_question_count,
                    introductions_json, introduction_cursor, questions_json, question_cursor,
                    retry_debts_json, started_at, accumulated_pause_ms, updated_at
             FROM practice_session WHERE learner_id = ?1 ORDER BY session_id",
        )
        .map_err(|_| BackupError::export_failed())?;
    let rows = statement
        .query_map([learner_id], |row| {
            let request: Value = serde_json::from_str(&row.get::<_, String>(2)?)
                .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
            let introductions: Value = serde_json::from_str(&row.get::<_, String>(4)?)
                .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
            let questions: Value = serde_json::from_str(&row.get::<_, String>(6)?)
                .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
            let debts: Value = serde_json::from_str(&row.get::<_, String>(8)?)
                .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
            Ok(SessionRecord {
                session: json!({
                    "sessionId": row.get::<_, String>(0)?,
                    "learnerId": row.get::<_, String>(1)?,
                    "request": request,
                    "baseQuestionCount": row.get::<_, i64>(3)?,
                    "introductions": introductions,
                    "introductionCursor": row.get::<_, i64>(5)?,
                    "questions": questions,
                    "questionCursor": row.get::<_, i64>(7)?,
                    "carryoverRetryDebts": debts,
                    "startedAt": row.get::<_, String>(9)?,
                    "accumulatedPauseMs": row.get::<_, i64>(10)?
                }),
                saved_at: row.get(11)?,
            })
        })
        .map_err(|_| BackupError::export_failed())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|_| BackupError::export_failed())
}

fn read_settings(connection: &Connection) -> Result<AppSettings, BackupError> {
    let encoded = connection
        .query_row(
            "SELECT value_json FROM app_setting WHERE setting_key = 'app'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|_| BackupError::export_failed())?;
    match encoded {
        Some(value) => serde_json::from_str(&value).map_err(|_| BackupError::export_failed()),
        None => Ok(AppSettings {
            audio: AudioSettings {
                enabled: true,
                pack_id: "crisp".to_owned(),
                volume: 0.7,
            },
        }),
    }
}

fn archive_from_connection(
    connection: &Connection,
    learner_id: &str,
    pack_versions: &BTreeMap<String, String>,
    exported_at: &str,
) -> Result<Vec<u8>, BackupError> {
    let progress = read_progress(connection, learner_id)?;
    let sessions = read_sessions(connection, learner_id)?;
    let settings = read_settings(connection)?;
    zip_documents(
        exported_at,
        learner_id,
        pack_versions,
        &progress,
        &sessions,
        &settings,
    )
}

fn target_path(mut selected: PathBuf) -> Result<PathBuf, BackupError> {
    if selected.file_name().is_none() {
        return Err(BackupError::export_failed());
    }
    if selected.extension().and_then(|value| value.to_str()) != Some("geolearn-backup") {
        selected.set_extension("geolearn-backup");
    }
    Ok(selected)
}

pub fn write_selected_backup(
    selected: Option<PathBuf>,
    bytes: &[u8],
) -> Result<Option<String>, BackupError> {
    let Some(selected) = selected else {
        return Ok(None);
    };
    let target = target_path(selected)?;
    let directory = target.parent().ok_or_else(BackupError::export_failed)?;
    let name = target
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(BackupError::export_failed)?
        .to_owned();
    let temporary = directory.join(format!(".{name}.tmp-{}", Uuid::new_v4().simple()));
    let result = (|| -> Result<(), BackupError> {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|_| BackupError::export_failed())?;
        file.write_all(bytes)
            .and_then(|_| file.flush())
            .and_then(|_| file.sync_all())
            .map_err(|_| BackupError::export_failed())?;
        std::fs::rename(&temporary, &target).map_err(|_| BackupError::export_failed())?;
        if let Ok(directory_file) = File::open(directory) {
            let _ = directory_file.sync_all();
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result.map(|()| Some(name))
}

fn canonical_json<T: Serialize>(value: &T) -> Result<String, BackupError> {
    serde_json::to_string(value).map_err(|_| BackupError::invalid_data())
}

fn mastery_key(record: &MasteryRecord) -> (&str, &str, &str, &str) {
    (
        &record.learner_id,
        &record.pack_id,
        &record.entity_id,
        &record.skill,
    )
}

fn independent_count(
    attempts: &[AttemptRecord],
    learner: &str,
    pack: &str,
    entity: &str,
    skill: &str,
) -> usize {
    attempts
        .iter()
        .filter(|record| {
            record.learner_id == learner
                && record.pack_id == pack
                && record.entity_id == entity
                && record.skill == skill
                && record.correct
                && record.independent_correct
        })
        .map(|record| record.attempt_id.as_str())
        .collect::<BTreeSet<_>>()
        .len()
}

fn insert_learner(
    transaction: &Transaction<'_>,
    learner_id: &str,
    created_at: &str,
) -> Result<(), BackupError> {
    transaction
        .execute(
            "INSERT OR IGNORE INTO learner (learner_id, created_at) VALUES (?1, ?2)",
            params![learner_id, created_at],
        )
        .map_err(|_| BackupError::import_failed())?;
    Ok(())
}

fn write_mastery(transaction: &Transaction<'_>, record: &MasteryRecord) -> Result<(), BackupError> {
    transaction
        .execute(
            "INSERT INTO mastery (learner_id, pack_id, entity_id, skill, stage,
                scheduled_interval_ms, due_at, smoothed_response_ms, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)
             ON CONFLICT(learner_id,pack_id,entity_id,skill) DO UPDATE SET
                stage=excluded.stage, scheduled_interval_ms=excluded.scheduled_interval_ms,
                due_at=excluded.due_at, smoothed_response_ms=excluded.smoothed_response_ms,
                updated_at=excluded.updated_at",
            params![
                record.learner_id,
                record.pack_id,
                record.entity_id,
                record.skill,
                record.stage,
                record.scheduled_interval_ms,
                record.due_at,
                record.smoothed_response_ms,
                record.updated_at
            ],
        )
        .map_err(|_| BackupError::import_failed())?;
    Ok(())
}

fn load_mastery(
    transaction: &Transaction<'_>,
    record: &MasteryRecord,
) -> Result<Option<MasteryRecord>, BackupError> {
    transaction
        .query_row(
            "SELECT learner_id,pack_id,entity_id,skill,stage,scheduled_interval_ms,
                    due_at,smoothed_response_ms,updated_at
             FROM mastery WHERE learner_id=?1 AND pack_id=?2 AND entity_id=?3 AND skill=?4",
            params![
                record.learner_id,
                record.pack_id,
                record.entity_id,
                record.skill
            ],
            |row| {
                Ok(MasteryRecord {
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
            },
        )
        .optional()
        .map_err(|_| BackupError::import_failed())
}

fn write_session(transaction: &Transaction<'_>, record: &SessionRecord) -> Result<(), BackupError> {
    let session = &record.session;
    transaction
        .execute(
            "INSERT INTO practice_session (
                session_id,learner_id,pack_id,request_json,base_question_count,
                introductions_json,introduction_cursor,questions_json,question_cursor,
                retry_debts_json,started_at,accumulated_pause_ms,updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)
             ON CONFLICT(session_id) DO UPDATE SET
                learner_id=excluded.learner_id,pack_id=excluded.pack_id,
                request_json=excluded.request_json,base_question_count=excluded.base_question_count,
                introductions_json=excluded.introductions_json,
                introduction_cursor=excluded.introduction_cursor,questions_json=excluded.questions_json,
                question_cursor=excluded.question_cursor,retry_debts_json=excluded.retry_debts_json,
                started_at=excluded.started_at,accumulated_pause_ms=excluded.accumulated_pause_ms,
                updated_at=excluded.updated_at",
            params![
                required_string(session, "sessionId")?,
                required_string(session, "learnerId")?,
                required_string(&session["request"], "packId")?,
                canonical_json(&session["request"])?,
                required_nonnegative(session, "baseQuestionCount")?,
                canonical_json(&session["introductions"])?,
                required_nonnegative(session, "introductionCursor")?,
                canonical_json(&session["questions"])?,
                required_nonnegative(session, "questionCursor")?,
                canonical_json(&session["carryoverRetryDebts"])?,
                required_string(session, "startedAt")?,
                required_nonnegative(session, "accumulatedPauseMs")?,
                record.saved_at,
            ],
        )
        .map_err(|_| BackupError::import_failed())?;
    Ok(())
}

fn session_should_replace(
    transaction: &Transaction<'_>,
    record: &SessionRecord,
) -> Result<bool, BackupError> {
    let id = required_string(&record.session, "sessionId")?;
    let current = transaction
        .query_row(
            "SELECT learner_id,question_cursor,introduction_cursor,updated_at
             FROM practice_session WHERE session_id=?1",
            [id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        )
        .optional()
        .map_err(|_| BackupError::import_failed())?;
    let Some((learner_id, question_cursor, introduction_cursor, saved_at)) = current else {
        return Ok(true);
    };
    if learner_id != required_string(&record.session, "learnerId")? {
        return Err(BackupError::invalid_data());
    }
    let imported_question = required_nonnegative(&record.session, "questionCursor")?;
    let imported_introduction = required_nonnegative(&record.session, "introductionCursor")?;
    Ok(imported_question > question_cursor
        || (imported_question == question_cursor && imported_introduction > introduction_cursor)
        || (imported_question == question_cursor
            && imported_introduction == introduction_cursor
            && record.saved_at.as_str() > saved_at.as_str()))
}

fn write_attempt(transaction: &Transaction<'_>, record: &AttemptRecord) -> Result<(), BackupError> {
    let existing = transaction
        .query_row(
            "SELECT attempt_id,session_id,learner_id,pack_id,entity_id,skill,question_kind,
                scheduled_review,delayed_retry,answer_attempt_count,correct,used_hint,response_ms,
                completed_at,mode,independent_correct FROM attempt_event WHERE attempt_id=?1",
            [&record.attempt_id],
            attempt_from_row,
        )
        .optional()
        .map_err(|_| BackupError::import_failed())?;
    if let Some(existing) = existing {
        if canonical_json(&existing)? != canonical_json(record)? {
            return Err(BackupError::new(
                "attempt_conflict",
                "The backup contains conflicting attempts.",
            ));
        }
        return Ok(());
    }
    transaction
        .execute(
            "INSERT INTO attempt_event (
                attempt_id,session_id,learner_id,pack_id,entity_id,skill,question_kind,
                scheduled_review,delayed_retry,answer_attempt_count,correct,used_hint,response_ms,
                completed_at,mode,independent_correct)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)",
            params![
                record.attempt_id,
                record.session_id,
                record.learner_id,
                record.pack_id,
                record.entity_id,
                record.skill,
                record.question_kind,
                record.scheduled_review,
                record.delayed_retry,
                record.answer_attempt_count,
                record.correct,
                record.used_hint,
                record.response_ms,
                record.completed_at,
                record.mode,
                record.independent_correct,
            ],
        )
        .map_err(|_| BackupError::import_failed())?;
    Ok(())
}

fn current_independent_count(
    transaction: &Transaction<'_>,
    record: &MasteryRecord,
) -> Result<usize, BackupError> {
    transaction
        .query_row(
            "SELECT COUNT(DISTINCT attempt_id) FROM attempt_event
             WHERE learner_id=?1 AND pack_id=?2 AND entity_id=?3 AND skill=?4
               AND correct=1 AND independent_correct=1",
            params![
                record.learner_id,
                record.pack_id,
                record.entity_id,
                record.skill
            ],
            |row| row.get::<_, i64>(0),
        )
        .map(|count| count as usize)
        .map_err(|_| BackupError::import_failed())
}

fn write_settings(
    transaction: &Transaction<'_>,
    settings: &AppSettings,
    updated_at: &str,
) -> Result<(), BackupError> {
    transaction
        .execute(
            "INSERT INTO app_setting (setting_key,value_json,updated_at) VALUES ('app',?1,?2)
             ON CONFLICT(setting_key) DO UPDATE SET value_json=excluded.value_json,
                updated_at=excluded.updated_at",
            params![canonical_json(settings)?, updated_at],
        )
        .map_err(|_| BackupError::import_failed())?;
    Ok(())
}

pub fn apply_import_on<F>(
    connection: &mut Connection,
    backup: &InspectedBackup,
    mode: ImportMode,
    include_settings: bool,
    safety_backup: F,
) -> Result<(), BackupError>
where
    F: FnOnce(&[u8]) -> Result<(), BackupError>,
{
    validate_documents(
        &backup.manifest,
        &backup.progress,
        &backup.sessions,
        &backup.settings,
    )?;
    let safety_exported_at = OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|_| BackupError::safety_backup())?;
    let safety_bytes = archive_from_connection(
        connection,
        &backup.manifest.learner_id,
        &backup.manifest.pack_versions,
        &safety_exported_at,
    )
    .map_err(|_| BackupError::safety_backup())?;
    safety_backup(&safety_bytes).map_err(|_| BackupError::safety_backup())?;

    let transaction = connection
        .transaction()
        .map_err(|_| BackupError::import_failed())?;
    if matches!(mode, ImportMode::Replace) {
        for statement in ["attempt_event", "mastery", "practice_session"] {
            transaction
                .execute(
                    &format!("DELETE FROM {statement} WHERE learner_id=?1"),
                    [&backup.manifest.learner_id],
                )
                .map_err(|_| BackupError::import_failed())?;
        }
        transaction
            .execute(
                "DELETE FROM learner WHERE learner_id=?1",
                [&backup.manifest.learner_id],
            )
            .map_err(|_| BackupError::import_failed())?;
        transaction
            .execute("DELETE FROM app_setting", [])
            .map_err(|_| BackupError::import_failed())?;
    }
    insert_learner(
        &transaction,
        &backup.manifest.learner_id,
        &backup.manifest.exported_at,
    )?;

    for record in &backup.sessions {
        if matches!(mode, ImportMode::Replace) || session_should_replace(&transaction, record)? {
            write_session(&transaction, record)?;
        }
    }
    for record in &backup.progress.mastery {
        let should_write = if matches!(mode, ImportMode::Replace) {
            true
        } else if let Some(current) = load_mastery(&transaction, record)? {
            let imported_count = independent_count(
                &backup.progress.attempts,
                &record.learner_id,
                &record.pack_id,
                &record.entity_id,
                &record.skill,
            );
            let current_count = current_independent_count(&transaction, record)?;
            record.updated_at.as_str() > current.updated_at.as_str()
                || (record.updated_at == current.updated_at && imported_count > current_count)
                || (record.updated_at == current.updated_at
                    && imported_count == current_count
                    && canonical_json(record)? < canonical_json(&current)?)
        } else {
            true
        };
        if should_write {
            write_mastery(&transaction, record)?;
        }
    }
    for record in &backup.progress.attempts {
        write_attempt(&transaction, record)?;
    }
    if matches!(mode, ImportMode::Replace) || include_settings {
        write_settings(&transaction, &backup.settings, &backup.manifest.exported_at)?;
    }
    transaction
        .commit()
        .map_err(|_| BackupError::import_failed())
}

fn file_path(value: FilePath) -> Result<PathBuf, BackupError> {
    match value {
        FilePath::Path(path) => Ok(path),
        FilePath::Url(_) => Err(BackupError::invalid_archive()),
    }
}

fn format_now(now: OffsetDateTime) -> Result<String, BackupError> {
    now.format(&Rfc3339)
        .map_err(|_| BackupError::export_failed())
}

fn pack_versions_for(connection: &Connection, learner_id: &str) -> BTreeMap<String, String> {
    let Ok(mut statement) = connection
        .prepare("SELECT DISTINCT pack_id FROM mastery WHERE learner_id=?1 ORDER BY pack_id")
    else {
        return BTreeMap::new();
    };
    let Ok(rows) = statement.query_map([learner_id], |row| row.get::<_, String>(0)) else {
        return BTreeMap::new();
    };
    rows.filter_map(Result::ok)
        .map(|id| (id, "unknown".to_owned()))
        .collect()
}

#[tauri::command]
pub fn choose_and_export_backup(
    app: AppHandle,
    database: State<'_, Database>,
    learner_id: String,
) -> Result<Option<String>, BackupError> {
    if !valid_id(&learner_id) {
        return Err(BackupError::invalid_data());
    }
    let selected = app
        .dialog()
        .file()
        .add_filter("GeoLearn backup", &["geolearn-backup"])
        .set_file_name("geolearn-backup.geolearn-backup")
        .blocking_save_file()
        .map(file_path)
        .transpose()?;
    let connection = database
        .0
        .lock()
        .map_err(|_| BackupError::export_failed())?;
    let now = format_now(OffsetDateTime::now_utc())?;
    let versions = pack_versions_for(&connection, &learner_id);
    let bytes = archive_from_connection(&connection, &learner_id, &versions, &now)?;
    write_selected_backup(selected, &bytes)
}

fn read_selected_backup(path: &Path) -> Result<InspectedBackup, BackupError> {
    if path.extension().and_then(|value| value.to_str()) != Some("geolearn-backup") {
        return Err(BackupError::new(
            "invalid_extension",
            "Select a .geolearn-backup file.",
        ));
    }
    let metadata = std::fs::metadata(path).map_err(|_| BackupError::invalid_archive())?;
    if !metadata.is_file() || metadata.len() > MAX_ARCHIVE_BYTES as u64 {
        return Err(BackupError::new(
            "archive_too_large",
            "The selected backup is too large.",
        ));
    }
    let mut file = File::open(path).map_err(|_| BackupError::invalid_archive())?;
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(MAX_ARCHIVE_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| BackupError::invalid_archive())?;
    inspect_archive_bytes(&bytes)
}

#[tauri::command]
pub fn choose_and_inspect_backup(
    app: AppHandle,
    stages: State<'_, Mutex<BackupStages>>,
) -> Result<Option<StagedBackupSummary>, BackupError> {
    let selected = app
        .dialog()
        .file()
        .add_filter("GeoLearn backup", &["geolearn-backup"])
        .blocking_pick_file();
    let Some(selected) = selected else {
        return Ok(None);
    };
    let inspected = read_selected_backup(&file_path(selected)?)?;
    let staged = stages
        .lock()
        .map_err(|_| BackupError::new("stage_failed", "Unable to stage the backup."))?
        .insert(inspected, OffsetDateTime::now_utc());
    Ok(Some(staged))
}

fn write_safety_backup(app: &AppHandle, bytes: &[u8]) -> Result<(), BackupError> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|_| BackupError::safety_backup())?
        .join("backups");
    std::fs::create_dir_all(&directory).map_err(|_| BackupError::safety_backup())?;
    let target = directory.join(format!(
        "safety-{}.geolearn-backup",
        Uuid::new_v4().simple()
    ));
    write_selected_backup(Some(target), bytes)
        .map(|_| ())
        .map_err(|_| BackupError::safety_backup())
}

#[tauri::command]
pub fn import_staged_backup(
    app: AppHandle,
    database: State<'_, Database>,
    stages: State<'_, Mutex<BackupStages>>,
    staging_id: String,
    mode: ImportMode,
    include_settings: bool,
) -> Result<(), BackupError> {
    let backup = stages
        .lock()
        .map_err(|_| BackupError::new("stage_failed", "Unable to stage the backup."))?
        .take(&staging_id, OffsetDateTime::now_utc())?;
    let mut connection = database
        .0
        .lock()
        .map_err(|_| BackupError::import_failed())?;
    apply_import_on(&mut connection, &backup, mode, include_settings, |bytes| {
        write_safety_backup(&app, bytes)
    })
}
