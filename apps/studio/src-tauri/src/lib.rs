use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::Manager;

// The opened project's root directory, set by `set_project_root` and used to
// scope all project file I/O. Held in Tauri-managed state for the app lifetime.
#[derive(Default)]
struct ProjectRoot(Mutex<Option<PathBuf>>);

// Resolve a project-relative path against the root, rejecting traversal. The
// project commands are the one fs entry point, so the guard lives here.
fn resolve_in_root(root: &Path, relative: &str) -> Result<PathBuf, String> {
    if relative.split(['/', '\\']).any(|seg| seg == "..") {
        return Err(format!("project path traversal rejected: {relative}"));
    }
    Ok(root.join(relative))
}

fn project_root_path(state: &tauri::State<ProjectRoot>) -> Result<PathBuf, String> {
    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or_else(|| "no project root set".to_string())
}

fn walk_files(dir: &Path, base: &Path, out: &mut Vec<String>) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_dir() {
            walk_files(&path, base, out)?;
        } else if let Ok(rel) = path.strip_prefix(base) {
            out.push(rel.to_string_lossy().replace('\\', "/"));
        }
    }
    Ok(())
}

#[tauri::command]
fn set_project_root(state: tauri::State<ProjectRoot>, path: String) -> Result<(), String> {
    *state.0.lock().map_err(|e| e.to_string())? = Some(PathBuf::from(path));
    Ok(())
}

#[tauri::command]
fn project_read_file(state: tauri::State<ProjectRoot>, relative: String) -> Result<Vec<u8>, String> {
    let root = project_root_path(&state)?;
    fs::read(resolve_in_root(&root, &relative)?).map_err(|e| e.to_string())
}

#[tauri::command]
fn project_write_file(
    state: tauri::State<ProjectRoot>,
    relative: String,
    contents: Vec<u8>,
) -> Result<(), String> {
    let root = project_root_path(&state)?;
    let path = resolve_in_root(&root, &relative)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(path, contents).map_err(|e| e.to_string())
}

// All files under `relative`, recursively, as project-relative `/`-separated paths.
#[tauri::command]
fn project_read_dir(state: tauri::State<ProjectRoot>, relative: String) -> Result<Vec<String>, String> {
    let root = project_root_path(&state)?;
    let start = resolve_in_root(&root, &relative)?;
    let mut out = Vec::new();
    if start.is_dir() {
        walk_files(&start, &root, &mut out)?;
    }
    Ok(out)
}

// Native preference store: one JSON object persisted at
// `<app config dir>/preferences.json`. Mirrors the browser host's
// localStorage-backed PreferenceStore (packages/editor-platform). App-local
// commands are allowed by default in Tauri 2.x, so no extra capability entry is
// needed beyond the scaffold's `core:default`.

fn prefs_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("preferences.json"))
}

fn read_prefs(app: &tauri::AppHandle) -> Result<HashMap<String, String>, String> {
    match fs::read(prefs_path(app)?) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| e.to_string()),
        Err(_) => Ok(HashMap::new()), // missing/unreadable file → empty store
    }
}

fn write_prefs(app: &tauri::AppHandle, map: &HashMap<String, String>) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(map).map_err(|e| e.to_string())?;
    fs::write(prefs_path(app)?, bytes).map_err(|e| e.to_string())
}

#[tauri::command]
fn pref_get(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    Ok(read_prefs(&app)?.get(&key).cloned())
}

#[tauri::command]
fn pref_set(app: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
    let mut map = read_prefs(&app)?;
    map.insert(key, value);
    write_prefs(&app, &map)
}

#[tauri::command]
fn pref_remove(app: tauri::AppHandle, key: String) -> Result<(), String> {
    let mut map = read_prefs(&app)?;
    map.remove(&key);
    write_prefs(&app, &map)
}

// Build a project's user code with the bundled Bun sidecar: `bun install` to
// resolve the project's `@retro-engine/*` (so the build can enumerate their
// exports), then the bundled build script, which emits an ESM bundle that
// resolves those imports to the studio's live instances at runtime. Returns the
// bundle text; the frontend wraps it in a blob URL and imports it.
#[tauri::command]
async fn project_build(app: tauri::AppHandle, project_dir: String) -> Result<String, String> {
    use tauri::path::BaseDirectory;
    use tauri_plugin_shell::ShellExt;

    let script = app
        .path()
        .resolve("scripts/build-project.js", BaseDirectory::Resource)
        .map_err(|e| e.to_string())?;
    let entry = format!("{project_dir}/src/game.ts");

    let install = app
        .shell()
        .sidecar("bun")
        .map_err(|e| e.to_string())?
        .args(["install"])
        .current_dir(PathBuf::from(project_dir.clone()))
        .output()
        .await
        .map_err(|e| e.to_string())?;
    if !install.status.success() {
        return Err(format!(
            "bun install failed: {}",
            String::from_utf8_lossy(&install.stderr)
        ));
    }

    let build = app
        .shell()
        .sidecar("bun")
        .map_err(|e| e.to_string())?
        .args(vec![
            script.to_string_lossy().to_string(),
            "--entry".to_string(),
            entry,
        ])
        .current_dir(PathBuf::from(project_dir))
        .output()
        .await
        .map_err(|e| e.to_string())?;
    if !build.status.success() {
        return Err(format!(
            "project build failed: {}",
            String::from_utf8_lossy(&build.stderr)
        ));
    }
    Ok(String::from_utf8_lossy(&build.stdout).into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .manage(ProjectRoot::default())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      pref_get,
      pref_set,
      pref_remove,
      project_build,
      set_project_root,
      project_read_file,
      project_write_file,
      project_read_dir
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
