use rusqlite::Connection;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

pub struct Database(pub Mutex<Connection>);

impl Database {
    pub fn open(app: &AppHandle) -> Result<Self, String> {
        let directory = app
            .path()
            .app_data_dir()
            .map_err(|_| "Application data directory is unavailable.".to_owned())?;
        std::fs::create_dir_all(&directory)
            .map_err(|_| "Application data directory is unavailable.".to_owned())?;
        let connection = Connection::open(directory.join("progress.sqlite3"))
            .map_err(|_| "Progress database is unavailable.".to_owned())?;
        connection
            .execute_batch(include_str!("../migrations/0001_initial.sql"))
            .map_err(|_| "Progress database migration failed.".to_owned())?;
        Ok(Self(Mutex::new(connection)))
    }
}
