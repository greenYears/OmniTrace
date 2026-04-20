use anyhow::Result;
use chrono::Utc;
use rusqlite::Connection;

pub mod queries;
pub mod schema;

pub fn configure_connection(conn: &Connection) -> Result<()> {
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    Ok(())
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
    fn configure_connection_enables_foreign_keys() {
        let conn = Connection::open_in_memory().expect("in-memory sqlite connection");
        configure_connection(&conn).expect("foreign key pragma should succeed");

        let enabled: i64 = conn
            .query_row("PRAGMA foreign_keys;", [], |row| row.get(0))
            .expect("pragma query should succeed");

        assert_eq!(enabled, 1);
    }

    #[test]
    fn current_timestamp_returns_rfc3339_like_string() {
        let value = current_timestamp();
        assert!(value.contains('T'));
        assert!(value.ends_with('Z') || value.contains('+'));
    }
}
