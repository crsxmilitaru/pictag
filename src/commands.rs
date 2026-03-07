use crate::models::{ImageFile, MoveOperation, ProcessResult, RenameOperation, TagInfo};
use crate::ollama;
use crate::utils;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Emitter;
use tauri_plugin_dialog::DialogExt;
use time::{macros::format_description, OffsetDateTime};

static STOP_RECOGNITION: AtomicBool = AtomicBool::new(false);

fn validate_path(path: &str) -> Result<std::path::PathBuf, String> {
    let p = Path::new(path);
    if !p.is_absolute() {
        return Err("Path must be absolute".to_string());
    }
    p.canonicalize().map_err(|e| format!("Invalid path: {}", e))
}

fn clean_path_string(path: &Path) -> String {
    let p_str = path.to_string_lossy();
    if p_str.starts_with("\\\\?\\UNC\\") {
        return format!("\\\\{}", &p_str[8..]);
    } else if p_str.starts_with("\\\\?\\") {
        return p_str[4..].to_string();
    }
    p_str.into_owned()
}

fn unique_target_path(target_dir: &Path, base_name: &str) -> PathBuf {
    let mut candidate = target_dir.join(base_name);
    if !candidate.exists() {
        return candidate;
    }
    let stem = Path::new(base_name)
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    let ext = Path::new(base_name)
        .extension()
        .map(|e| e.to_string_lossy().into_owned());
    let mut counter = 1u32;
    loop {
        let name = match &ext {
            Some(e) => format!("{}_{}.{}", stem, counter, e),
            None => format!("{}_{}", stem, counter),
        };
        candidate = target_dir.join(&name);
        if !candidate.exists() {
            return candidate;
        }
        counter += 1;
    }
}

fn move_into_folder(folder_path: &Path, file_name: &str, target_dir: &Path) -> ProcessResult {
    if file_name.contains("..") {
        return ProcessResult::failure(file_name.to_string(), "Invalid file name".to_string());
    }
    let original_path = folder_path.join(file_name);
    let base_name = match original_path.file_name() {
        Some(name) => name.to_string_lossy().into_owned(),
        None => {
            return ProcessResult::failure(file_name.to_string(), "Invalid file name".to_string())
        }
    };
    let target_path = unique_target_path(target_dir, &base_name);
    let new_relative = target_path
        .strip_prefix(folder_path)
        .unwrap_or(&target_path)
        .to_string_lossy()
        .into_owned();
    match std::fs::rename(&original_path, &target_path) {
        Ok(_) => ProcessResult::success(file_name.to_string(), new_relative),
        Err(e) => ProcessResult::failure(file_name.to_string(), format!("Move failed: {}", e)),
    }
}

#[tauri::command]
pub async fn get_models(url: String) -> Result<Vec<String>, String> {
    ollama::get_available_models(&url)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn scan_folder(folder: String, recursive: bool) -> Result<Vec<ImageFile>, String> {
    let folder_path = validate_path(&folder)?;
    let clean_str = clean_path_string(&folder_path);
    utils::scan_for_images(Path::new(&clean_str), recursive).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn pick_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog().file().pick_folder(move |folder| {
        let _ = tx.send(folder.map(|p| p.to_string()));
    });
    let folder = rx.recv().map_err(|e| format!("Dialog error: {}", e))?;
    match folder {
        Some(path) => {
            let folder_path = validate_path(&path)?;
            Ok(Some(clean_path_string(&folder_path)))
        }
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn generate_names(
    window: tauri::Window,
    folder: String,
    model: String,
    ollama_url: String,
    analyze_prompt: String,
    recursive: bool,
) -> Result<Vec<ProcessResult>, String> {
    STOP_RECOGNITION.store(false, Ordering::SeqCst);
    let folder_path = validate_path(&folder)?;
    let clean_str = clean_path_string(&folder_path);
    let entries =
        utils::scan_for_images(Path::new(&clean_str), recursive).map_err(|e| e.to_string())?;

    let capacity = entries.len();
    let mut results = Vec::with_capacity(capacity);

    for image in entries {
        if STOP_RECOGNITION.load(Ordering::SeqCst) {
            break;
        }
        let original_name = image.relative_path.clone();
        window
            .emit("image-processing", &original_name)
            .map_err(|e| format!("Failed to emit event: {}", e))?;

        let image_path = Path::new(&image.path);
        let result =
            match ollama::analyze_image(image_path, &model, &ollama_url, &analyze_prompt).await {
                Ok(description) => {
                    let ext = image_path
                        .extension()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_ascii_lowercase();
                    ProcessResult::success(original_name, format!("{}.{}", description, ext))
                }
                Err(e) => ProcessResult::failure(original_name, format!("Analysis failed: {}", e)),
            };

        window
            .emit("image-processed", &result)
            .map_err(|e| format!("Failed to emit event: {}", e))?;
        results.push(result);
    }

    Ok(results)
}

#[tauri::command]
pub async fn apply_renames(
    folder: String,
    renames: Vec<RenameOperation>,
) -> Result<Vec<ProcessResult>, String> {
    let folder_path = validate_path(&folder)?;
    let mut results = Vec::with_capacity(renames.len());

    for op in renames {
        if op.new_name.contains('/') || op.new_name.contains('\\') || op.new_name.contains("..") {
            results.push(ProcessResult::failure(
                op.original,
                "Invalid characters in new filename".to_string(),
            ));
            continue;
        }
        let original_path = folder_path.join(&op.original);
        let parent_dir = original_path.parent().unwrap_or(&folder_path);
        let mut new_path = parent_dir.join(&op.new_name);

        if new_path.exists() && new_path != original_path {
            let stem = new_path
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned();
            let ext = new_path
                .extension()
                .map(|e| e.to_string_lossy().into_owned());
            let mut counter = 1u32;
            loop {
                let candidate = match &ext {
                    Some(e) => format!("{}_{}.{}", stem, counter, e),
                    None => format!("{}_{}", stem, counter),
                };
                let candidate_path = parent_dir.join(&candidate);
                if !candidate_path.exists() {
                    new_path = candidate_path;
                    break;
                }
                counter += 1;
            }
        }

        let final_name = new_path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        let new_relative = parent_dir
            .strip_prefix(&folder_path)
            .map(|p| p.join(&final_name))
            .unwrap_or_else(|_| Path::new(&final_name).to_path_buf())
            .to_string_lossy()
            .into_owned();
        let result = match std::fs::rename(&original_path, &new_path) {
            Ok(_) => ProcessResult::success(op.original, new_relative),
            Err(e) => ProcessResult::failure(op.original, format!("Rename failed: {}", e)),
        };
        results.push(result);
    }

    Ok(results)
}

#[tauri::command]
pub async fn organize_by_tags(
    folder: String,
    moves: Vec<MoveOperation>,
) -> Result<Vec<ProcessResult>, String> {
    let folder_path = validate_path(&folder)?;
    let mut results = Vec::with_capacity(moves.len());
    let mut created_dirs: Vec<String> = Vec::new();

    for op in moves {
        if op.target_folder.contains('/')
            || op.target_folder.contains('\\')
            || op.target_folder.contains("..")
        {
            results.push(ProcessResult::failure(
                op.file_name,
                "Invalid characters in target folder name".to_string(),
            ));
            continue;
        }
        if !created_dirs.contains(&op.target_folder) {
            let target_dir = folder_path.join(&op.target_folder);
            if !target_dir.exists() {
                if let Err(e) = std::fs::create_dir_all(&target_dir) {
                    results.push(ProcessResult::failure(
                        op.file_name,
                        format!("Failed to create folder: {}", e),
                    ));
                    continue;
                }
            }
            created_dirs.push(op.target_folder.clone());
        }

        let target_dir = folder_path.join(&op.target_folder);
        results.push(move_into_folder(&folder_path, &op.file_name, &target_dir));
    }

    Ok(results)
}

#[tauri::command]
pub async fn organize_all_to_folder(
    folder: String,
    file_names: Vec<String>,
    target_folder: String,
) -> Result<Vec<ProcessResult>, String> {
    let folder_path = validate_path(&folder)?;
    if target_folder.contains('/') || target_folder.contains('\\') || target_folder.contains("..") {
        return Err("Invalid characters in target folder name".to_string());
    }

    let target_dir = folder_path.join(&target_folder);
    if !target_dir.exists() {
        std::fs::create_dir_all(&target_dir)
            .map_err(|e| format!("Failed to create folder: {}", e))?;
    }

    let mut results = Vec::with_capacity(file_names.len());
    for file_name in file_names {
        results.push(move_into_folder(&folder_path, &file_name, &target_dir));
    }

    Ok(results)
}

#[tauri::command]
pub async fn organize_by_date(
    folder: String,
    file_names: Vec<String>,
) -> Result<Vec<ProcessResult>, String> {
    organize_by_time(folder, file_names, "day".to_string()).await
}

#[tauri::command]
pub async fn organize_by_time(
    folder: String,
    file_names: Vec<String>,
    grouping: String,
) -> Result<Vec<ProcessResult>, String> {
    let folder_path = validate_path(&folder)?;
    let mut results = Vec::with_capacity(file_names.len());
    let mut created_dirs: Vec<String> = Vec::new();

    for file_name in file_names {
        if file_name.contains("..") {
            results.push(ProcessResult::failure(
                file_name,
                "Invalid file name".to_string(),
            ));
            continue;
        }
        let original_path = folder_path.join(&file_name);
        let modified = match std::fs::metadata(&original_path).and_then(|m| m.modified()) {
            Ok(value) => value,
            Err(e) => {
                results.push(ProcessResult::failure(
                    file_name,
                    format!("Failed to read metadata: {}", e),
                ));
                continue;
            }
        };
        let modified_date = OffsetDateTime::from(modified);
        let date_folder = match grouping.as_str() {
            "year" => modified_date.format(&format_description!("[year]")),
            "month" => modified_date.format(&format_description!("[year]-[month]")),
            "year_month" => modified_date.format(&format_description!("[year]/[month]")),
            "day" => modified_date.format(&format_description!("[year]-[month]-[day]")),
            _ => return Err("Invalid date grouping".to_string()),
        };
        let date_folder = match date_folder {
            Ok(value) => value,
            Err(e) => {
                results.push(ProcessResult::failure(
                    file_name,
                    format!("Failed to format date: {}", e),
                ));
                continue;
            }
        };
        if !created_dirs.contains(&date_folder) {
            let target_dir = folder_path.join(&date_folder);
            if !target_dir.exists() {
                if let Err(e) = std::fs::create_dir_all(&target_dir) {
                    results.push(ProcessResult::failure(
                        file_name,
                        format!("Failed to create folder: {}", e),
                    ));
                    continue;
                }
            }
            created_dirs.push(date_folder.clone());
        }

        let target_dir = folder_path.join(&date_folder);
        results.push(move_into_folder(&folder_path, &file_name, &target_dir));
    }

    Ok(results)
}

#[tauri::command]
pub fn analyze_tags(file_names: Vec<String>) -> Vec<TagInfo> {
    let mut tag_map: HashMap<String, Vec<String>> = HashMap::with_capacity(file_names.len());

    for file_name in &file_names {
        let base_file = Path::new(file_name)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(file_name);
        let dot_pos = base_file.rfind('.').filter(|&i| i > 0);
        let base_name = dot_pos.map_or(base_file, |i| &base_file[..i]);

        for word in base_name.split(|c: char| matches!(c, ' ' | '\t' | '_' | '-')) {
            if word.len() > 2 {
                tag_map
                    .entry(word.to_ascii_lowercase())
                    .or_default()
                    .push(file_name.clone());
            }
        }
    }

    let mut tags: Vec<TagInfo> = tag_map
        .into_iter()
        .filter_map(|(name, files)| {
            (files.len() >= 2).then(|| TagInfo {
                count: files.len(),
                name,
                files,
            })
        })
        .collect();

    tags.sort_unstable_by(|a, b| b.count.cmp(&a.count));
    tags.truncate(20);
    tags
}
#[tauri::command]
pub fn stop_recognition() {
    STOP_RECOGNITION.store(true, Ordering::SeqCst);
}
