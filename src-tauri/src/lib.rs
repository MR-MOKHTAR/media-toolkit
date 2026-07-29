use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::Mutex;

/// Holds the currently running yt-dlp child process so it can be cancelled.
#[derive(Default)]
struct DownloadState {
    child: Mutex<Option<tokio::process::Child>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DownloadResult {
    pub success: bool,
    pub message: String,
    pub file_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DownloadProgress {
    pub status: String,
    pub error: Option<String>,
}

#[derive(Clone, Serialize)]
pub struct ProgressPayload {
    pub percent: f64,
    pub size: String,
    pub speed: String,
    pub eta: String,
}

/// Get the path to the bundled yt-dlp binary
fn get_ytdlp_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;

    // Try to get bundled binary first
    let binary_name = if cfg!(target_os = "windows") {
        "yt-dlp.exe"
    } else {
        "yt-dlp"
    };

    // Look in the app's resource directory (bundled binaries)
    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        let bundled_path = resource_dir.join("binaries").join(binary_name);
        if bundled_path.exists() {
            return Ok(bundled_path);
        }
    }

    // Fallback: try system PATH
    let mut cmd = Command::new(binary_name);
    cmd.arg("--version");

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    if cmd
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
    {
        return Ok(PathBuf::from(binary_name));
    }

    Err(
        "yt-dlp not found. Please ensure yt-dlp is installed or bundled with the application."
            .to_string(),
    )
}

/// Ensure yt-dlp binary has proper permissions (Linux only)
fn ensure_ytdlp_executable(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::fs;
        use std::os::unix::fs::PermissionsExt;

        if let Ok(metadata) = fs::metadata(path) {
            let mode = metadata.permissions().mode();
            // If it already has execute permissions for anyone, we don't need to chmod
            if mode & 0o111 == 0 {
                let perms = fs::Permissions::from_mode(mode | 0o111);
                // We ignore the error here because if we don't have permissions to chmod
                // (e.g. read-only filesystem or owned by root), it will fail.
                // The subsequent spawn() will fail properly if it's truly not executable.
                let _ = fs::set_permissions(path, perms);
            }
        }
    }
    Ok(())
}

/// Open a file or directory in the system file manager
#[tauri::command]
async fn open_path(path: String) -> Result<(), String> {
    let path_obj = Path::new(&path);

    if !path_obj.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    let result = if cfg!(target_os = "macos") {
        Command::new("open").arg(&path).output()
    } else if cfg!(target_os = "linux") {
        Command::new("xdg-open").arg(&path).output()
    } else if cfg!(target_os = "windows") {
        Command::new("explorer").arg(&path).output()
    } else {
        return Err("Unsupported operating system".to_string());
    };

    match result {
        Ok(output) => {
            if output.status.success() {
                Ok(())
            } else {
                Err(String::from_utf8_lossy(&output.stderr).to_string())
            }
        }
        Err(e) => Err(format!("Failed to open path: {}", e)),
    }
}

/// Reveal a downloaded file in the native file manager and select it.
#[tauri::command]
async fn reveal_in_folder(path: String) -> Result<(), String> {
    let target = PathBuf::from(&path);

    if !target.exists() {
        return Err(format!("File does not exist: {}", path));
    }

    #[cfg(target_os = "macos")]
    {
        let output = Command::new("open")
            .arg("-R")
            .arg(&target)
            .output()
            .map_err(|error| format!("Failed to open Finder: {}", error))?;

        return if output.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).to_string())
        };
    }

    #[cfg(target_os = "windows")]
    {
        let output = Command::new("explorer")
            .arg("/select,")
            .arg(&target)
            .output()
            .map_err(|error| format!("Failed to open Explorer: {}", error))?;

        return if output.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).to_string())
        };
    }

    #[cfg(target_os = "linux")]
    {
        let canonical = target
            .canonicalize()
            .map_err(|error| format!("Failed to resolve file path: {}", error))?;
        let uri = file_uri(&canonical);

        // Most modern Linux file managers implement FileManager1.ShowItems,
        // which opens the parent folder with the requested file selected.
        if let Ok(output) = Command::new("dbus-send")
            .args([
                "--session",
                "--dest=org.freedesktop.FileManager1",
                "--type=method_call",
                "/org/freedesktop/FileManager1",
                "org.freedesktop.FileManager1.ShowItems",
            ])
            .arg(format!("array:string:{}", uri))
            .arg("string:")
            .output()
        {
            if output.status.success() {
                return Ok(());
            }
        }

        // Fallback for minimal desktop environments without FileManager1.
        let parent = canonical
            .parent()
            .ok_or_else(|| "Downloaded file has no parent folder".to_string())?;
        let output = Command::new("xdg-open")
            .arg(parent)
            .output()
            .map_err(|error| format!("Failed to open file manager: {}", error))?;

        return if output.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).to_string())
        };
    }

    #[allow(unreachable_code)]
    Err("Unsupported operating system".to_string())
}

#[cfg(target_os = "linux")]
fn file_uri(path: &Path) -> String {
    let mut uri = String::from("file://");
    for byte in path.to_string_lossy().as_bytes() {
        match *byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'/' | b'-' | b'_' | b'.' | b'~' => {
                uri.push(*byte as char)
            }
            value => uri.push_str(&format!("%{:02X}", value)),
        }
    }
    uri
}

/// Download audio or video from YouTube URL
#[tauri::command]
async fn download_media(
    app_handle: AppHandle,
    state: tauri::State<'_, DownloadState>,
    url: String,
    output_path: String,
    filename: String,
    download_type: String,
    quality: String,
) -> Result<DownloadResult, String> {
    // Validate URL
    if !url.contains("youtube.com") && !url.contains("youtu.be") {
        return Err("Invalid YouTube URL".to_string());
    }

    // Validate output path exists
    if !Path::new(&output_path).exists() {
        return Err(format!("Output path does not exist: {}", output_path));
    }

    let (output_file, mut cmd_args): (String, Vec<String>) = match download_type.as_str() {
        "audio" => {
            let file = format!("{}/{}.mp3", output_path, filename);
            let args = vec![
                "--newline".to_string(),
                "--no-colors".to_string(),
                "--progress-template".to_string(),
                "download:__YTDLP_PROGRESS__%(progress._percent_str)s|%(progress._total_bytes_str)s|%(progress._speed_str)s|%(progress._eta_str)s".to_string(),
                "-x".to_string(),
                "--audio-format".to_string(),
                "mp3".to_string(),
                "-o".to_string(),
                file.clone(),
            ];
            (file, args)
        }
        "video" => {
            let file = format!("{}/{}.mp4", output_path, filename);
            let format_spec = match quality.as_str() {
                "4k" => "bestvideo[height=2160]+bestaudio/best[height=2160]",
                "1440p" => "bestvideo[height=1440]+bestaudio/best[height=1440]",
                "1080p" => "bestvideo[height=1080]+bestaudio/best[height=1080]",
                "720p" => "bestvideo[height=720]+bestaudio/best[height=720]",
                "480p" => "bestvideo[height=480]+bestaudio/best[height=480]",
                "best" => "bestvideo+bestaudio/best",
                _ => "bestvideo[height=720]+bestaudio/best[height=720]",
            };
            let args = vec![
                "--newline".to_string(),
                "--no-colors".to_string(),
                "--progress-template".to_string(),
                "download:__YTDLP_PROGRESS__%(progress._percent_str)s|%(progress._total_bytes_str)s|%(progress._speed_str)s|%(progress._eta_str)s".to_string(),
                "-f".to_string(),
                format_spec.to_string(),
                "--merge-output-format".to_string(),
                "mp4".to_string(),
                "-o".to_string(),
                file.clone(),
            ];
            (file, args)
        }
        _ => {
            return Err(format!(
                "Invalid download type: {}. Must be 'audio' or 'video'",
                download_type
            ))
        }
    };

    // Add URL as last argument
    cmd_args.push(url);

    // Get the path to yt-dlp binary
    let ytdlp_path = get_ytdlp_path(&app_handle)?;

    // Ensure executable permissions (especially important on Linux)
    ensure_ytdlp_executable(&ytdlp_path)?;

    // Execute yt-dlp command
    let mut std_cmd = std::process::Command::new(&ytdlp_path);
    std_cmd
        .args(&cmd_args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        std_cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let mut child = tokio::process::Command::from(std_cmd)
        .spawn()
        .map_err(|e| format!("Failed to spawn yt-dlp: {}", e))?;

    // Take stdout for progress parsing before handing the child to shared state.
    let stdout = child.stdout.take();

    // Store the running child so `cancel_download` can stop it.
    *state.child.lock().await = Some(child);

    if let Some(stdout) = stdout {
        let mut reader = BufReader::new(stdout).lines();

        while let Ok(Some(line)) = reader.next_line().await {
            if let Some(progress) = line.strip_prefix("__YTDLP_PROGRESS__") {
                let fields: Vec<&str> = progress.splitn(4, '|').collect();
                if fields.len() == 4 {
                    let percent_text = fields[0].trim().trim_end_matches('%').trim();
                    if let Ok(percent) = percent_text.parse::<f64>() {
                        let display_value = |value: &str| {
                            let value = value.trim();
                            if value.is_empty() || value == "N/A" || value == "NA" {
                                "—".to_string()
                            } else {
                                value.to_string()
                            }
                        };

                        let _ = app_handle.emit(
                            "download-progress",
                            ProgressPayload {
                                percent,
                                size: display_value(fields[1]),
                                speed: display_value(fields[2]),
                                eta: display_value(fields[3]),
                            },
                        );
                    }
                }
            }
        }
    }

    // Reclaim the child. If it was taken by `cancel_download`, the download was cancelled.
    let mut child = match state.child.lock().await.take() {
        Some(child) => child,
        None => {
            return Ok(DownloadResult {
                success: false,
                message: "Download cancelled".to_string(),
                file_path: None,
            });
        }
    };

    let status = child
        .wait()
        .await
        .map_err(|e| format!("Failed to wait: {}", e))?;

    if status.success() {
        let message = format!("{}  downloaded successfully!", {
            match download_type.as_str() {
                "audio" => "Audio",
                "video" => "Video",
                _ => "Media",
            }
        });
        Ok(DownloadResult {
            success: true,
            message,
            file_path: Some(output_file),
        })
    } else {
        Err(format!("yt-dlp exited with status: {}", status))
    }
}

/// Cancel the currently running download by killing the yt-dlp process.
#[tauri::command]
async fn cancel_download(state: tauri::State<'_, DownloadState>) -> Result<(), String> {
    let child = state.child.lock().await.take();
    if let Some(mut child) = child {
        let _ = child.kill().await;
        let _ = child.wait().await;
    }
    Ok(())
}

/// Check if yt-dlp is installed (bundled or in system PATH)
#[tauri::command]
fn check_ytdlp_installed(app_handle: AppHandle) -> bool {
    match get_ytdlp_path(&app_handle) {
        Ok(_) => true,
        Err(_) => false,
    }
}

/// Get default downloads path
#[tauri::command]
fn get_default_download_path() -> String {
    if cfg!(target_os = "windows") {
        // Windows: use %USERPROFILE%\Downloads
        if let Ok(userprofile) = std::env::var("USERPROFILE") {
            return format!("{}\\Downloads", userprofile);
        }
    }

    // macOS and Linux: use ~/Downloads
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    format!("{}/Downloads", home)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(DownloadState::default())
        .invoke_handler(tauri::generate_handler![
            download_media,
            cancel_download,
            check_ytdlp_installed,
            get_default_download_path,
            open_path,
            reveal_in_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
