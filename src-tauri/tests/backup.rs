use rusqlite::{params, Connection};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use spatial_memory_coach_lib::backup::{
    apply_import_on, inspect_archive_bytes, installed_pack_versions_on,
    write_backup_atomically_with, write_selected_backup, BackupError, BackupStages, ImportMode,
    MAX_ARCHIVE_BYTES, MAX_ENTRY_BYTES, STAGE_TTL_SECONDS,
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

fn manifest_with_pack_version(
    documents: &BTreeMap<String, Vec<u8>>,
    version: u64,
    pack_version: &str,
) -> Vec<u8> {
    serde_json::to_vec(&json!({
        "format": "geolearn-backup", "version": version, "exportedAt": EXPORTED_AT,
        "learnerId": "learner-1", "packVersions": {"china-provinces": pack_version},
        "checksums": {
            "progress.json": sha256(&documents["progress.json"]),
            "sessions.json": sha256(&documents["sessions.json"]),
            "settings.json": sha256(&documents["settings.json"])
        }
    }))
    .unwrap()
}

fn manifest(documents: &BTreeMap<String, Vec<u8>>, version: u64) -> Vec<u8> {
    manifest_with_pack_version(documents, version, "1.0.0")
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

fn archive_with_duplicate_progress_entry(documents: &BTreeMap<String, Vec<u8>>) -> Vec<u8> {
    let mut bytes = archive(vec![
        ("manifest.json".to_owned(), manifest(documents, 1), None),
        (
            "progress.json".to_owned(),
            documents["progress.json"].clone(),
            None,
        ),
        ("progressxjson".to_owned(), b"{}".to_vec(), None),
        (
            "sessions.json".to_owned(),
            documents["sessions.json"].clone(),
            None,
        ),
    ]);
    let placeholder = b"progressxjson";
    let duplicate = b"progress.json";
    let mut replacements = 0;
    for offset in 0..=bytes.len() - placeholder.len() {
        if bytes[offset..offset + placeholder.len()] == placeholder[..] {
            bytes[offset..offset + placeholder.len()].copy_from_slice(duplicate);
            replacements += 1;
        }
    }
    assert_eq!(replacements, 2);
    bytes
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

fn archive_with_documents(documents: BTreeMap<String, Vec<u8>>, pack_version: &str) -> Vec<u8> {
    let mut entries = vec![(
        "manifest.json".to_owned(),
        manifest_with_pack_version(&documents, 1, pack_version),
        None,
    )];
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

fn current_versions() -> BTreeMap<String, String> {
    BTreeMap::from([("china-provinces".to_owned(), "1.0.0".to_owned())])
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

fn seed_attempt(connection: &Connection, response_ms: i64) {
    connection
        .execute(
            "INSERT INTO attempt_event VALUES (
            'attempt-1','session-1','learner-1','china-provinces','anhui','locate_region',
            'locate_region',0,0,1,1,0,?1,?2,'smart',1)",
            params![response_ms, EXPORTED_AT],
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
fn capabilities_do_not_expose_dialog_and_lib_keeps_exactly_three_backup_commands() {
    let capability: Value =
        serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
    let permissions = capability["permissions"].as_array().unwrap();
    assert!(permissions
        .iter()
        .all(|permission| !permission.as_str().unwrap().starts_with("dialog:")));

    let lib = include_str!("../src/lib.rs");
    for command in [
        "backup::choose_and_export_backup",
        "backup::choose_and_inspect_backup",
        "backup::import_staged_backup",
    ] {
        assert_eq!(
            lib.matches(command).count(),
            1,
            "registration for {command}"
        );
    }
    assert_eq!(lib.matches("backup::choose_and_").count(), 2);
    assert_eq!(lib.matches("backup::import_").count(), 1);
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

    assert_code(
        inspect_archive_bytes(&archive_with_duplicate_progress_entry(&documents)),
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
fn rejects_mode_only_fields_and_malformed_question_variants() {
    let base: Value = serde_json::from_slice(&valid_documents()["sessions.json"]).unwrap();
    let mut invalid_documents = Vec::new();

    let mut smart_with_custom_fields = base.clone();
    smart_with_custom_fields[0]["session"]["request"]["questionCount"] = json!(10);
    invalid_documents.push(smart_with_custom_fields);

    for question in [
        json!({"kind":"locate_region","presentation":"map","entityId":"anhui","answer":{"acceptedDisplayValues":["安徽"]}}),
        json!({"kind":"identify_region","presentation":"choice","entityId":"anhui"}),
        json!({"kind":"associate_capital","presentation":"text","entityId":"anhui","answer":{"acceptedDisplayValues":["合肥"]}}),
        json!({"kind":"locate_place","presentation":"map","entityId":"hefei"}),
        json!({"kind":"identify_place","presentation":"map","entityId":"hefei"}),
        json!({"kind":"identify_place","presentation":"text","entityId":"hefei","answer":{"acceptedDisplayValues":[]}}),
    ] {
        let mut document = base.clone();
        document[0]["session"]["questions"][0] = question;
        invalid_documents.push(document);
    }

    for invalid_sessions in invalid_documents {
        let mut documents = valid_documents();
        documents.insert(
            "sessions.json".to_owned(),
            serde_json::to_vec(&invalid_sessions).unwrap(),
        );
        assert_code(
            inspect_archive_bytes(&archive_with_documents(documents, "1.0.0")),
            "invalid_data",
        );
    }
}

#[test]
fn rejects_malformed_retry_debts_cursors_timestamps_and_ids() {
    let base: Value = serde_json::from_slice(&valid_documents()["sessions.json"]).unwrap();
    let mut invalid_documents = Vec::new();

    for debt in [
        json!({"entityId":"anhui","skill":"locate_region","sourceQuestionKind":"unknown","createdAt":EXPORTED_AT,"priority":"immediate"}),
        json!({"entityId":"anhui","skill":"locate_region","sourceQuestionKind":"locate_region","createdAt":"yesterday","priority":"immediate"}),
        json!({"entityId":"anhui","skill":"locate_region","sourceQuestionKind":"locate_region","createdAt":EXPORTED_AT,"priority":"later"}),
    ] {
        let mut document = base.clone();
        document[0]["session"]["carryoverRetryDebts"] = json!([debt]);
        invalid_documents.push(document);
    }

    let mut cursor = base.clone();
    cursor[0]["session"]["questionCursor"] = json!(3);
    invalid_documents.push(cursor);
    let mut timestamp = base.clone();
    timestamp[0]["session"]["startedAt"] = json!("2026-08-27T20:00:00+08:00");
    invalid_documents.push(timestamp);
    let mut invalid_id = base.clone();
    invalid_id[0]["session"]["sessionId"] = json!("../session");
    invalid_documents.push(invalid_id);

    for invalid_sessions in invalid_documents {
        let mut documents = valid_documents();
        documents.insert(
            "sessions.json".to_owned(),
            serde_json::to_vec(&invalid_sessions).unwrap(),
        );
        assert_code(
            inspect_archive_bytes(&archive_with_documents(documents, "1.0.0")),
            "invalid_data",
        );
    }
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
fn atomic_export_replaces_an_existing_target_without_partial_content() {
    let directory = tempdir().unwrap();
    let target = directory.path().join("existing.geolearn-backup");
    std::fs::write(&target, b"old-complete-content").unwrap();

    write_selected_backup(Some(target.clone()), &valid_archive()).unwrap();

    assert_eq!(std::fs::read(&target).unwrap(), valid_archive());
}

#[test]
fn failure_after_temp_fsync_preserves_old_target_and_cleans_temp() {
    let directory = tempdir().unwrap();
    let target = directory.path().join("existing.geolearn-backup");
    std::fs::write(&target, b"old-complete-content").unwrap();

    let result =
        write_backup_atomically_with(
            &target,
            b"new-content",
            || Err(BackupError::safety_backup()),
        );

    assert!(result.is_err());
    assert_eq!(std::fs::read(&target).unwrap(), b"old-complete-content");
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
        &current_versions(),
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

#[test]
fn installed_pack_versions_include_session_only_packs_and_validate_manifests() {
    let connection = connection();
    seed_current(&connection);
    connection
        .execute(
            "INSERT INTO practice_session VALUES (
            'session-only','learner-1','session-pack',?1,0,'[]',0,'[]',0,'[]',?2,0,?2)",
            [r#"{"mode":"smart","packId":"session-pack"}"#, EXPORTED_AT],
        )
        .unwrap();
    let directory = tempdir().unwrap();
    for (pack_id, version) in [("china-provinces", "1.0.0"), ("session-pack", "3.2.1")] {
        let pack = directory.path().join(pack_id);
        std::fs::create_dir_all(&pack).unwrap();
        std::fs::write(
            pack.join("manifest.json"),
            serde_json::to_vec(&json!({"packId": pack_id, "contentVersion": version})).unwrap(),
        )
        .unwrap();
    }

    let versions = installed_pack_versions_on(&connection, directory.path(), "learner-1").unwrap();

    assert_eq!(versions["china-provinces"], "1.0.0");
    assert_eq!(versions["session-pack"], "3.2.1");
}

#[test]
fn safety_backup_uses_current_v1_instead_of_imported_v2_pack_versions() {
    let mut connection = connection();
    seed_current(&connection);
    let imported =
        inspect_archive_bytes(&archive_with_documents(valid_documents(), "2.0.0")).unwrap();
    let current = current_versions();
    let mut observed = None;

    apply_import_on(
        &mut connection,
        &imported,
        ImportMode::Merge,
        false,
        &current,
        |bytes| {
            observed = Some(inspect_archive_bytes(bytes)?.summary.pack_versions);
            Ok(())
        },
    )
    .unwrap();

    assert_eq!(observed.unwrap()["china-provinces"], "1.0.0");
}

#[test]
fn conflicting_attempt_code_rolls_back_mastery_and_sessions() {
    let mut connection = connection();
    seed_current(&connection);
    seed_attempt(&connection, 1_000);
    let inspected = inspect_archive_bytes(&valid_archive()).unwrap();

    let result = apply_import_on(
        &mut connection,
        &inspected,
        ImportMode::Merge,
        true,
        &current_versions(),
        |_| Ok(()),
    );

    assert_code(result, "attempt_conflict");
    assert_seed_unchanged(&connection);
    let response_ms: i64 = connection
        .query_row(
            "SELECT response_ms FROM attempt_event WHERE attempt_id='attempt-1'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(response_ms, 1_000);
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
    let result = apply_import_on(
        &mut connection,
        &inspected,
        ImportMode::Merge,
        true,
        &current_versions(),
        |_| Ok(()),
    );
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
        &current_versions(),
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
        &current_versions(),
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
