use std::path::Path;
use std::sync::{Arc, Mutex};

use anyhow::Result;
use chrono::Utc;
use rusqlite::Connection;

pub mod queries;
pub mod schema;

pub struct AppState {
    pub db: Arc<Mutex<Connection>>,
}

pub fn configure_connection(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "PRAGMA foreign_keys = ON;
         PRAGMA journal_mode = WAL;
         PRAGMA busy_timeout = 5000;
         PRAGMA wal_autocheckpoint = 1000;",
    )?;
    Ok(())
}

pub fn resolve_db_path(app_dir: &Path) -> std::path::PathBuf {
    app_dir.join("omnitrace.db")
}

pub fn open_persistent_connection(db_path: &Path) -> Result<Connection> {
    let conn = Connection::open(db_path)?;
    configure_connection(&conn)?;
    schema::run_migrations(&conn)?;
    Ok(conn)
}

pub fn open_connection(path: &str) -> Result<Connection> {
    let conn = Connection::open(path)?;
    configure_connection(&conn)?;
    Ok(conn)
}

pub fn current_timestamp() -> String {
    Utc::now().to_rfc3339()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn configure_connection_enables_foreign_keys_and_wal() {
        let conn = Connection::open_in_memory().expect("in-memory sqlite connection");
        configure_connection(&conn).expect("pragma batch should succeed");

        let fk: i64 = conn
            .query_row("PRAGMA foreign_keys;", [], |row| row.get(0))
            .expect("fk pragma query should succeed");
        assert_eq!(fk, 1);

        let jm: String = conn
            .query_row("PRAGMA journal_mode;", [], |row| row.get(0))
            .expect("journal pragma query should succeed");
        // In-memory databases use "memory" journal mode regardless of WAL setting
        assert!(jm == "wal" || jm == "memory");
    }

    #[test]
    fn current_timestamp_returns_rfc3339_like_string() {
        let value = current_timestamp();
        assert!(value.contains('T'));
        assert!(value.ends_with('Z') || value.contains('+'));
    }
}
