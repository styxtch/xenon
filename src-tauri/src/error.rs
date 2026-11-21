use serde::Serialize;
use std::fmt;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", content = "message")]
pub enum AppError {
    Io(String),
    Database(String),
    EngineError(String),
    PasswordRequired,
    IntegrityFailed(String),
    InvalidInput(String),
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AppError::Io(msg) => write!(f, "I/O error: {msg}"),
            AppError::Database(msg) => write!(f, "Database error: {msg}"),
            AppError::EngineError(msg) => write!(f, "Engine error: {msg}"),
            AppError::PasswordRequired => write!(f, "PDF document requires a password"),
            AppError::IntegrityFailed(msg) => write!(f, "Integrity check failed: {msg}"),
            AppError::InvalidInput(msg) => write!(f, "Invalid input: {msg}"),
        }
    }
}

impl std::error::Error for AppError {}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        AppError::Io(err.to_string())
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(err: rusqlite::Error) -> Self {
        AppError::Database(err.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(err: serde_json::Error) -> Self {
        AppError::InvalidInput(err.to_string())
    }
}
