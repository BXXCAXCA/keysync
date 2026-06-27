use rusqlite::Connection;

use crate::errors::{KeySyncError, Result};

pub struct StorageService {
    connection: Connection,
}

impl StorageService {
    pub fn open_in_memory_for_bootstrap() -> Result<Self> {
        let connection = Connection::open_in_memory().map_err(|err| KeySyncError::Storage(format!("open sqlite: {err}")))?;
        let service = Self { connection };
        service.migrate()?;
        Ok(service)
    }

    pub fn migrate(&self) -> Result<()> {
        self.connection.execute_batch(include_str!("../../migrations/0001_init.sql")).map_err(|err| KeySyncError::Storage(format!("run migrations: {err}")))?;
        Ok(())
    }
}
