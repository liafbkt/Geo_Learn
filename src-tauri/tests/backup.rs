use rusqlite::Connection;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use spatial_memory_coach_lib::backup::{
    apply_import_on, inspect_archive_bytes, write_selected_backup, BackupError, BackupStages,
    ImportMode, MAX_ARCHIVE_BYTES, MAX_ENTRY_BYTES, STAGE_TTL_SECONDS,
};
use std::collections::BTreeMap;
use std::io::{Cursor, Write};
use std::path::Path;
use tempfile::tempdir;
use time::{Duration, OffsetDateTime};
use zip::write::SimpleFileOptions;

const EXPORTED_AT: &str = "2026-08-27T12:00:00.000Z";

fn mastery(stage: &str) -> Value {
    json!({
        "learnerId": "learner-1", "packId": "china-provinces", "entityId": "anhui",
        "skill": "locate_region", "stage": stage, "scheduledIntervalMs": 86400000,
        "dueAt": "2026-08-28T12:00:00.000Z", "smoothedResponseMs": 1500.5,
        "updatedAt": "2026-08-27T12:00:00.000Z"
    })
}

fn attempt(attempt_id: &str) -> Value {
    json!({
        "attemptId": attempt_id, "sessionId": "session-1", "learnerId": "learner-1",
        "packId": "china-provinces", "entityId": "anhui", "skill": "locate_region",
        "questionKind": "locate_region", "scheduledReview": false, "delayedRetry": false,
        "answerAttemptCount": 1, "correct": true, "usedHint": false, "responseMs": 2000,
        "completedAt": "2026-08-27T12:00:00.000Z", "mode": "smart",
        "independentCorrect": true
    })
}

fn session(cursor: i64) -> Value {
    json!({
        "session": {
            "sessionId": "session-1", "learnerId": "learner-1",
            "request": { "mode": "smart", "packId": "china-provinces" },
            "baseQuestionCount": 2, "introductions": ["anhui"], "introductionCursor": 1,
            "questions": [
                { "kind": "locate_region", "presentation": "map", "entityId": "anhui" },
                { "kind": "locate_region", "presentation": "map", "entityId": "beijing" }
            ],
            "questionCursor": cursor, "carryoverRetryDebts": [],
            "startedAt": "2026-08-27T11:59:00.000Z", "accumulatedPauseMs": 0
        },
        "savedAt": "2026-08-27T12:00:00.000Z"
    })
}

fn valid_documents() -> BTreeMap<String, Vec<u8>> {
    BTreeMap::from([
        (
            "progress.json".to_owned(),
            serde_json::to_vec(
                &json!({"mastery": [mastery("solid")], "attempts": [attempt("attempt-1")]}),
            )
            .unwrap(),
        ),
        (
            "sessions.json".to_owned(),
            serde_json::to_vec(&json!([session(1)])).unwrap(),
        ),
        (
            "settings.json".to_owned(),
            serde_json::to_vec(
                &json!({"audio": {"enabled": true, "packId": "crisp", "volume": 0.7}}),
            )
            .unwrap(),
        ),
    ])
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn manifest(documents: &BTreeMap<String, Vec<u8>>, version: u64) -> Vec<u8> {
    serde_json::to_vec(&json!({
        "format": "geolearn-backup", "version": version, "exportedAt": EXPORTED_AT,
        "learnerId": "learner-1", "packVersions": {"china-provinces": "1.0.0"},
        "checksums": {
            "progress.json": sha256(&documents["progress.json"]),
            "sessions.json": sha256(&documents["sessions.json"]),
            "settings.json": sha256(&documents["settings.json"])
        }
    }))
    .unwrap()
}

fn archive(entries: Vec<(String, Vec<u8>, Option<u32>)>) -> Vec<u8> {
    let mut output = Cursor::new(Vec::new());
    {
        let mut writer = zip::ZipWriter::new(&mut output);
        for (name, bytes, permissions) in entries {
            let options =
                SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
            if permissions == Some(0o120777) {
                writer.add_symlink(name, "target", options).unwrap();
            } else {
                writer.start_file(name, options).unwrap();
                writer.write_all(&bytes).unwrap();
            }
        }
        writer.finish().unwrap();
    }
    output.into_inner()
}

fn valid_archive() -> Vec<u8> {
    let documents = valid_documents();
    let mut entries = vec![("manifest.json".to_owned(), manifest(&documents, 1), None)];
    entries.extend(
        documents
            .into_iter()
            .map(|(name, bytes)| (name, bytes, None)),
    );
    archive(entries)
}

fn assert_code(result: Result<impl std::fmt::Debug, BackupError>, expected: &str) {
    assert_eq!(result.unwrap_err().code, expected);
}

fn connection() -> Connection {
    let connection = Connection::open_in_memory().unwrap();
    connection
        .execute_batch(include_str!("../migrations/0001_initial.sql"))
        .unwrap();
    connection
}

fn seed_current(connection: &Connection) {
    connection
        .execute(
            "INSERT INTO learner VALUES ('learner-1', ?1)",
            [EXPORTED_AT],
        )
        .unwrap();
    connection.execute(
        "INSERT INTO mastery VALUES ('learner-1','china-provinces','anhui','locate_region','weak',1,?1,NULL,?1)",
        [EXPORTED_AT],
    ).unwrap();
    connection.execute(
        "INSERT INTO practice_session VALUES ('session-1','learner-1','china-provinces',?1,2,'[]',0,'[]',0,'[]',?2,0,?2)",
        [r#"{"mode":"smart","packId":"china-provinces"}"#, EXPORTED_AT],
    ).unwrap();
    connection
        .execute(
            "INSERT INTO app_setting VALUES ('app',?1,?2)",
            [
                r#"{"audio":{"enabled":true,"packId":"crisp","volume":0.7}}"#,
                EXPORTED_AT,
            ],
        )
        .unwrap();
}

#[test]
fn valid_archive_is_inspected_without_exposing_a_path() {
    let inspected = inspect_archive_bytes(&valid_archive()).unwrap();
    assert_eq!(inspected.summary.learner_id, "learner-1");
    assert_eq!(inspected.summary.mastery_count, 1);
    assert_eq!(inspected.summary.attempt_count, 1);
    assert_eq!(inspected.summary.session_count, 1);
}

#[test]
fn rejects_missing_extra_duplicate_traversal_and_symlink_entries() {
    let documents = valid_documents();
    let base = vec![("manifest.json".to_owned(), manifest(&documents, 1), None)];
    let missing = archive(base.clone());
    assert_code(inspect_archive_bytes(&missing), "invalid_archive");

    let mut extra_entries = base.clone();
    extra_entries.extend(documents.clone().into_iter().map(|(n, b)| (n, b, None)));
    extra_entries.push(("notes.txt".to_owned(), b"no".to_vec(), None));
    assert_code(
        inspect_archive_bytes(&archive(extra_entries)),
        "invalid_archive",
    );

    let mut duplicate_entries = base.clone();
    duplicate_entries.extend(documents.clone().into_iter().map(|(n, b)| (n, b, None)));
    duplicate_entries.push(("progress.json".to_owned(), b"{}".to_vec(), None));
    assert_code(
        inspect_archive_bytes(&archive(duplicate_entries)),
        "invalid_archive",
    );

    for (name, mode) in [
        ("../progress.json", None),
        ("progress.json", Some(0o120777)),
    ] {
        let mut entries = base.clone();
        entries.extend(
            documents
                .clone()
                .into_iter()
                .filter_map(|(n, b)| (n != "progress.json").then_some((n, b, None))),
        );
        entries.push((name.to_owned(), documents["progress.json"].clone(), mode));
        assert_code(inspect_archive_bytes(&archive(entries)), "invalid_archive");
    }
}

#[test]
fn rejects_oversized_entry_and_archive_before_json_processing() {
    let huge = vec![b' '; MAX_ENTRY_BYTES + 1];
    let entries = vec![
        ("manifest.json".to_owned(), b"{}".to_vec(), None),
        ("progress.json".to_owned(), huge, None),
        ("sessions.json".to_owned(), b"[]".to_vec(), None),
        ("settings.json".to_owned(), b"{}".to_vec(), None),
    ];
    assert_code(
        inspect_archive_bytes(&archive(entries)),
        "archive_too_large",
    );

    let oversized_container = vec![0_u8; MAX_ARCHIVE_BYTES + 1];
    assert_code(
        inspect_archive_bytes(&oversized_container),
        "archive_too_large",
    );
}

#[test]
fn rejects_corrupt_json_unsupported_version_and_checksum_mismatch() {
    let mut corrupt_documents = valid_documents();
    corrupt_documents.insert("settings.json".to_owned(), b"{".to_vec());
    let mut entries = vec![(
        "manifest.json".to_owned(),
        manifest(&corrupt_documents, 1),
        None,
    )];
    entries.extend(corrupt_documents.into_iter().map(|(n, b)| (n, b, None)));
    assert_code(inspect_archive_bytes(&archive(entries)), "invalid_data");

    let documents = valid_documents();
    let mut unsupported = vec![("manifest.json".to_owned(), manifest(&documents, 2), None)];
    unsupported.extend(documents.clone().into_iter().map(|(n, b)| (n, b, None)));
    assert_code(
        inspect_archive_bytes(&archive(unsupported)),
        "unsupported_version",
    );

    let mut bad_manifest: Value = serde_json::from_slice(&manifest(&documents, 1)).unwrap();
    bad_manifest["checksums"]["progress.json"] = Value::String("0".repeat(64));
    let mut mismatched = vec![(
        "manifest.json".to_owned(),
        serde_json::to_vec(&bad_manifest).unwrap(),
        None,
    )];
    mismatched.extend(documents.into_iter().map(|(n, b)| (n, b, None)));
    assert_code(
        inspect_archive_bytes(&archive(mismatched)),
        "checksum_mismatch",
    );
}

#[test]
fn staging_ids_expire_and_are_single_use() {
    let now = OffsetDateTime::from_unix_timestamp(1_800_000_000).unwrap();
    let inspected = inspect_archive_bytes(&valid_archive()).unwrap();
    let mut stages = BackupStages::default();
    let staged = stages.insert(inspected.clone(), now);
    assert!(staged.staging_id.len() >= 32);
    assert!(stages.take(&staged.staging_id, now).is_ok());
    assert_code(stages.take(&staged.staging_id, now), "invalid_stage");

    let expired = stages.insert(inspected, now);
    assert_code(
        stages.take(
            &expired.staging_id,
            now + Duration::seconds(STAGE_TTL_SECONDS + 1),
        ),
        "expired_stage",
    );
}

#[test]
fn cancelled_export_is_successful_and_atomic_write_cleans_temporary_files() {
    assert_eq!(write_selected_backup(None, &valid_archive()).unwrap(), None);

    let directory = tempdir().unwrap();
    let selected = directory.path().join("学习记录");
    let result = write_selected_backup(Some(selected), &valid_archive())
        .unwrap()
        .unwrap();
    assert!(result.ends_with("学习记录.geolearn-backup"));
    assert!(directory.path().join("学习记录.geolearn-backup").is_file());
    let leftovers = std::fs::read_dir(directory.path())
        .unwrap()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_name().to_string_lossy().contains(".tmp-"))
        .count();
    assert_eq!(leftovers, 0);
}

#[test]
fn safety_backup_happens_before_merge_mutation() {
    let mut connection = connection();
    seed_current(&connection);
    let inspected = inspect_archive_bytes(&valid_archive()).unwrap();
    let safety_directory = tempdir().unwrap();
    let safety_path = safety_directory.path().join("safety.geolearn-backup");
    let mut safety_called = false;

    apply_import_on(
        &mut connection,
        &inspected,
        ImportMode::Merge,
        false,
        |bytes| {
            safety_called = true;
            std::fs::write(&safety_path, bytes).map_err(|_| BackupError::safety_backup())
        },
    )
    .unwrap();

    assert!(safety_called);
    let stage: String = connection
        .query_row("SELECT stage FROM mastery", [], |row| row.get(0))
        .unwrap();
    assert_eq!(stage, "solid");
}

fn install_failure(connection: &Connection, table: &str) {
    connection
        .execute_batch(&format!(
            "CREATE TRIGGER fail_import BEFORE INSERT ON {table} BEGIN SELECT RAISE(ABORT, 'fail'); END;"
        ))
        .unwrap();
}

fn assert_seed_unchanged(connection: &Connection) {
    let stage: String = connection
        .query_row("SELECT stage FROM mastery", [], |row| row.get(0))
        .unwrap();
    let settings: String = connection
        .query_row("SELECT value_json FROM app_setting", [], |row| row.get(0))
        .unwrap();
    assert_eq!(stage, "weak");
    assert!(settings.contains("crisp"));
}

#[test]
fn merge_sql_failure_rolls_back_the_whole_import() {
    let mut connection = connection();
    seed_current(&connection);
    install_failure(&connection, "attempt_event");
    let inspected = inspect_archive_bytes(&valid_archive()).unwrap();
    let result = apply_import_on(&mut connection, &inspected, ImportMode::Merge, true, |_| {
        Ok(())
    });
    assert_code(result, "import_failed");
    assert_seed_unchanged(&connection);
}

#[test]
fn replace_sql_failure_restores_all_application_tables() {
    let mut connection = connection();
    seed_current(&connection);
    install_failure(&connection, "mastery");
    let inspected = inspect_archive_bytes(&valid_archive()).unwrap();
    let result = apply_import_on(
        &mut connection,
        &inspected,
        ImportMode::Replace,
        true,
        |_| Ok(()),
    );
    assert_code(result, "import_failed");
    assert_seed_unchanged(&connection);
}

#[test]
fn safety_backup_failure_prevents_any_database_mutation() {
    let mut connection = connection();
    seed_current(&connection);
    let inspected = inspect_archive_bytes(&valid_archive()).unwrap();
    let result = apply_import_on(
        &mut connection,
        &inspected,
        ImportMode::Replace,
        true,
        |_| Err(BackupError::safety_backup()),
    );
    assert_code(result, "safety_backup_failed");
    assert_seed_unchanged(&connection);
}

#[test]
fn error_messages_never_expose_paths_or_sql() {
    let result = write_selected_backup(
        Some(Path::new("Z:/missing/private/location").to_path_buf()),
        b"x",
    )
    .unwrap_err();
    assert_eq!(result.code, "export_failed");
    assert!(!result.message.contains("Z:"));
    assert!(!result.message.to_ascii_uppercase().contains("INSERT"));
}
