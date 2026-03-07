use serde::{Deserialize, Serialize};

#[derive(Serialize, Clone)]
pub struct ImageFile {
    pub name: String,
    pub path: String,
    pub relative_path: String,
}

#[derive(Serialize, Clone)]
pub struct ProcessResult {
    pub original: String,
    pub new_name: String,
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl ProcessResult {
    pub fn success(original: String, new_name: String) -> Self {
        Self {
            original,
            new_name,
            success: true,
            error: None,
        }
    }

    pub fn failure(original: String, error: String) -> Self {
        Self {
            original,
            new_name: String::new(),
            success: false,
            error: Some(error),
        }
    }
}

#[derive(Deserialize)]
pub struct RenameOperation {
    pub original: String,
    pub new_name: String,
}

#[derive(Deserialize)]
pub struct MoveOperation {
    pub file_name: String,
    pub target_folder: String,
}

#[derive(Serialize)]
pub struct TagInfo {
    pub name: String,
    pub count: usize,
    pub files: Vec<String>,
}
