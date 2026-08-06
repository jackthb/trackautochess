use crate::nettable_parser::{extract_rows, NettableRow};
use std::{io, path::PathBuf, time::SystemTime};

#[derive(Debug, Clone)]
pub struct NettableTailer {
    path: PathBuf,
    last_modified: Option<SystemTime>,
}

impl NettableTailer {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            last_modified: None,
        }
    }

    pub fn poll(&mut self) -> io::Result<Option<Vec<NettableRow>>> {
        let modified = self.path.metadata()?.modified()?;
        if self.last_modified == Some(modified) {
            return Ok(None);
        }
        self.last_modified = Some(modified);
        Ok(Some(extract_rows(&self.path)?))
    }
}
