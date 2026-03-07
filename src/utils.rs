use crate::models::ImageFile;
use std::path::Path;

const IMAGE_EXTENSIONS: [&str; 6] = ["jpg", "jpeg", "png", "gif", "bmp", "webp"];

pub fn is_image(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| IMAGE_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

pub fn scan_for_images(folder: &Path, recursive: bool) -> std::io::Result<Vec<ImageFile>> {
    let mut images = Vec::new();
    scan_dir(folder, folder, recursive, &mut images)?;
    Ok(images)
}

fn scan_dir(
    dir: &Path,
    root: &Path,
    recursive: bool,
    images: &mut Vec<ImageFile>,
) -> std::io::Result<()> {
    for entry in std::fs::read_dir(dir)?.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if recursive {
                scan_dir(&path, root, true, images)?;
            }
            continue;
        }
        if is_image(&path) {
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            let relative_path = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .into_owned();
            images.push(ImageFile {
                name,
                path: path.to_string_lossy().into_owned(),
                relative_path,
            });
        }
    }
    Ok(())
}
