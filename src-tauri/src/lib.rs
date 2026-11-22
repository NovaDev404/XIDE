use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::Emitter;

#[derive(Serialize, Deserialize)]
struct DirEntry {
    name: String,
    path: String,
    is_dir: bool,
}

#[derive(Serialize, Deserialize)]
struct AppSettings {
    last_project_path: Option<String>,
}

// Global process storage
type ProcessMap = Arc<Mutex<Option<tokio::process::Child>>>;
static CURRENT_PROCESS: std::sync::OnceLock<ProcessMap> = std::sync::OnceLock::new();

#[tauri::command]
fn read_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let mut entries: Vec<DirEntry> = fs::read_dir(&path)
        .map_err(|e| e.to_string())?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let name = entry.file_name().to_string_lossy().to_string();
            if name == ".git" {
                return None;
            }
            let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
            Some(DirEntry {
                name,
                path: entry.path().to_string_lossy().to_string(),
                is_dir,
            })
        })
        .collect();

    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(entries)
}

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_file(path: String, contents: String) -> Result<(), String> {
    fs::write(&path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
fn remove_file(path: String) -> Result<(), String> {
    if Path::new(&path).is_dir() {
        fs::remove_dir_all(&path).map_err(|e| e.to_string())
    } else {
        fs::remove_file(&path).map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn rename_file(old_path: String, new_path: String) -> Result<(), String> {
    fs::rename(&old_path, &new_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_dir_all(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[tauri::command]
async fn pick_folder() -> Result<Option<String>, String> {
    let handle = rfd::AsyncFileDialog::new().pick_folder().await;
    Ok(handle.map(|h| h.path().to_string_lossy().to_string()))
}

#[tauri::command]
async fn pick_open_file(directory: Option<String>) -> Result<Option<String>, String> {
    let mut dialog = rfd::AsyncFileDialog::new();
    if let Some(dir) = directory {
        dialog = dialog.set_directory(dir);
    }
    let handle = dialog.pick_file().await;
    Ok(handle.map(|h| h.path().to_string_lossy().to_string()))
}

#[tauri::command]
async fn pick_save_file(
    default_name: String,
    directory: Option<String>,
) -> Result<Option<String>, String> {
    let mut dialog = rfd::AsyncFileDialog::new().set_file_name(&default_name);
    if let Some(dir) = directory {
        dialog = dialog.set_directory(dir);
    }
    let handle = dialog.save_file().await;
    Ok(handle.map(|h| h.path().to_string_lossy().to_string()))
}

#[tauri::command]
async fn check_xtool_installed() -> Result<bool, String> {
    let output = if cfg!(target_os = "windows") {
        tokio::process::Command::new("wsl")
            .args(["bash", "-lic", "xtool --version"])
            .output()
            .await
            .map_err(|e| e.to_string())?
    } else {
        tokio::process::Command::new("xtool")
            .arg("--version")
            .output()
            .await
            .map_err(|e| e.to_string())?
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let combined = format!("{}{}", stdout, stderr);

    // Check if output matches "xtool [version]" pattern
    Ok(combined.starts_with("xtool "))
}

#[tauri::command]
async fn run_xtool_new(project_name: String, parent_dir: String) -> Result<String, String> {
    let project_name_arg = format!("'{}'", project_name);

    let output = if cfg!(target_os = "windows") {
        tokio::process::Command::new("wsl")
            .args(["bash", "-lic", &format!("xtool new {}", project_name_arg)])
            .current_dir(&parent_dir)
            .output()
            .await
            .map_err(|e| e.to_string())?
    } else {
        tokio::process::Command::new("xtool")
            .args(["new", &project_name])
            .current_dir(&parent_dir)
            .output()
            .await
            .map_err(|e| e.to_string())?
    };

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        return Err(format!("xtool new failed: {}", stderr));
    }

    Ok(stdout)
}

#[tauri::command]
fn save_last_project_path(path: String) -> Result<(), String> {
    let settings = AppSettings {
        last_project_path: Some(path),
    };
    let settings_json = serde_json::to_string(&settings).map_err(|e| e.to_string())?;

    if let Some(config_dir) = dirs::config_dir() {
        let config_path = config_dir.join("xide");
        fs::create_dir_all(&config_path).map_err(|e| e.to_string())?;
        let settings_file = config_path.join("settings.json");
        fs::write(settings_file, settings_json).map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
fn load_last_project_path() -> Result<Option<String>, String> {
    if let Some(config_dir) = dirs::config_dir() {
        let config_path = config_dir.join("xide");
        let settings_file = config_path.join("settings.json");

        if settings_file.exists() {
            let content = fs::read_to_string(settings_file).map_err(|e| e.to_string())?;
            let settings: AppSettings = serde_json::from_str(&content).map_err(|e| e.to_string())?;

            // Check if the path still exists
            if let Some(ref path) = settings.last_project_path {
                if Path::new(path).exists() {
                    return Ok(settings.last_project_path);
                }
            }
        }
    }

    Ok(None)
}

#[tauri::command]
async fn start_terminal(project_path: String, app: tauri::AppHandle) -> Result<(), String> {
    // Kill any existing process
    stop_terminal().await?;

    let process_map = CURRENT_PROCESS.get_or_init(|| Arc::new(Mutex::new(None)));

    let (cmd, args) = if cfg!(target_os = "windows") {
        ("wsl", vec!["bash", "-lic", "xtool dev build --ipa"])
    } else {
        ("xtool", vec!["dev", "build", "--ipa"])
    };

    let mut child = tokio::process::Command::new(cmd)
        .args(&args)
        .current_dir(&project_path)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;

    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;

    // Store the process
    *process_map.lock().unwrap() = Some(child);

    // Spawn tasks to read and emit output
    let app_clone = app.clone();
    let stdout_task = tokio::spawn(async move {
        use tokio::io::{AsyncBufReadExt, BufReader};
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();

        while let Ok(Some(line)) = lines.next_line().await {
            let _ = app_clone.emit("terminal-output", serde_json::json!({
                "line": line,
                "type": "stdout"
            }));
        }
    });

    let app_clone = app.clone();
    let stderr_task = tokio::spawn(async move {
        use tokio::io::{AsyncBufReadExt, BufReader};
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();

        while let Ok(Some(line)) = lines.next_line().await {
            let _ = app_clone.emit("terminal-output", serde_json::json!({
                "line": line,
                "type": "stderr"
            }));
        }
    });

    // Handle process completion
    let process_map_clone = process_map.clone();
    tokio::spawn(async move {
        let _ = tokio::join!(stdout_task, stderr_task);
        *process_map_clone.lock().unwrap() = None;
        let _ = app.emit("terminal-exited", ());
    });

    Ok(())
}

#[tauri::command]
async fn stop_terminal() -> Result<(), String> {
    if let Some(process_map) = CURRENT_PROCESS.get() {
        let child = {
            let mut guard = process_map.lock().unwrap();
            guard.take()
        };
        if let Some(mut child) = child {
            child.kill().await.map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            read_dir,
            read_file,
            write_file,
            create_dir_all,
            path_exists,
            pick_folder,
            pick_open_file,
            pick_save_file,
            remove_file,
            rename_file,
            check_xtool_installed,
            run_xtool_new,
            save_last_project_path,
            load_last_project_path,
            start_terminal,
            stop_terminal,
        ])
        .run(tauri::generate_context!())
        .expect("error while running XIDE");
}