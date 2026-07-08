use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use percent_encoding::percent_decode_str;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::Manager;
use tauri_plugin_fs::FsExt;

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

// Directories that never hold authored project assets — dependency trees, VCS
// metadata, and build/cache output. Skipped by the recursive walk so the asset
// indexer never descends into (or through symlinks in) `node_modules`, which
// would surface a linked package's fixtures as project assets and mint stray
// `.meta` sidecars inside them.
const IGNORED_DIRS: &[&str] = &["node_modules", ".git", "dist", ".re", "target"];

fn walk_files(dir: &Path, base: &Path, out: &mut Vec<String>) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_dir() {
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if IGNORED_DIRS.contains(&name) {
                continue;
            }
            walk_files(&path, base, out)?;
        } else if let Ok(rel) = path.strip_prefix(base) {
            out.push(rel.to_string_lossy().replace('\\', "/"));
        }
    }
    Ok(())
}

// Record the opened project's root AND tighten the runtime scopes to it: the
// asset protocol (large-binary streaming) and the fs watch can now only reach
// this directory, replacing the broad `$HOME/**` static scope. Must be called on
// every boot that opens a project, not just from the dialog — a persisted project
// has no dialog, so the studio calls this before its first read.
#[tauri::command]
fn set_project_root(
    app: tauri::AppHandle,
    state: tauri::State<ProjectRoot>,
    path: String,
) -> Result<(), String> {
    let root = PathBuf::from(&path);
    app.asset_protocol_scope()
        .allow_directory(&root, true)
        .map_err(|e| e.to_string())?;
    app.fs_scope()
        .allow_directory(&root, true)
        .map_err(|e| e.to_string())?;
    *state.0.lock().map_err(|e| e.to_string())? = Some(root);
    log::info!("set_project_root: {path} (asset + fs scope granted)");
    Ok(())
}

// Returns the file's bytes as a raw IPC response (octet-stream), bypassing JSON
// number-array marshalling so large reads don't pay the serialization cost.
#[tauri::command]
fn project_read_file(state: tauri::State<ProjectRoot>, relative: String) -> Result<Response, String> {
    let root = project_root_path(&state)?;
    let bytes = fs::read(resolve_in_root(&root, &relative)?).map_err(|e| e.to_string())?;
    Ok(Response::new(bytes))
}

// Writes a file from a raw IPC request body (the bytes are the ArrayBuffer
// payload, no JSON array). The project-relative location rides in the
// percent-encoded `x-path` header since the body slot is the raw bytes.
#[tauri::command]
fn project_write_file(state: tauri::State<ProjectRoot>, request: Request) -> Result<(), String> {
    let header = request
        .headers()
        .get("x-path")
        .ok_or_else(|| "project_write_file: missing x-path header".to_string())?
        .to_str()
        .map_err(|e| e.to_string())?;
    let relative = percent_decode_str(header)
        .decode_utf8()
        .map_err(|e| e.to_string())?
        .into_owned();
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("project_write_file: request body must be raw bytes".to_string());
    };
    let root = project_root_path(&state)?;
    let path = resolve_in_root(&root, &relative)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(path, bytes).map_err(|e| e.to_string())
}

// Deletes a project file (root-scoped). Used to remove an asset and its `.meta`
// sidecar; a missing file is not an error (idempotent from the studio's view).
#[tauri::command]
fn project_delete_file(state: tauri::State<ProjectRoot>, relative: String) -> Result<(), String> {
    let root = project_root_path(&state)?;
    let path = resolve_in_root(&root, &relative)?;
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

// Renames/moves a project file (both paths root-scoped). Used to rename an asset
// and its `.meta` sidecar together; creates the destination's parent if needed.
#[tauri::command]
fn project_rename_file(
    state: tauri::State<ProjectRoot>,
    from: String,
    to: String,
) -> Result<(), String> {
    let root = project_root_path(&state)?;
    let from_path = resolve_in_root(&root, &from)?;
    let to_path = resolve_in_root(&root, &to)?;
    if let Some(parent) = to_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::rename(from_path, to_path).map_err(|e| e.to_string())
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

// Mirror the webview's console to the dev terminal, so a native session's
// frontend logs (project load, scene load, errors) are observable without
// devtools. App-local command; no capability entry needed.
#[tauri::command]
fn studio_log(message: String) {
    log::info!(target: "webview", "{message}");
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
async fn project_build(
    app: tauri::AppHandle,
    project_dir: String,
    entry: Option<String>,
) -> Result<String, String> {
    use tauri::path::BaseDirectory;
    use tauri_plugin_shell::ShellExt;

    // Bundled resource in a shipped app; in `tauri dev` the resource dir has no
    // copy, so fall back to the script built into src-tauri/scripts by the
    // beforeDevCommand (cwd is src-tauri during dev).
    let script = app
        .path()
        .resolve("scripts/build-project.js", BaseDirectory::Resource)
        .ok()
        .filter(|p| p.exists())
        .or_else(|| std::env::current_dir().ok().map(|d| d.join("scripts/build-project.js")))
        .filter(|p| p.exists())
        .ok_or_else(|| "build script not found (run `bun run build:project-script`)".to_string())?;
    let rel_entry = entry.unwrap_or_else(|| "src/game.ts".to_string());
    if rel_entry.split(['/', '\\']).any(|seg| seg == "..") {
        return Err(format!("project build entry traversal rejected: {rel_entry}"));
    }
    let entry = format!("{project_dir}/{rel_entry}");
    log::info!("project_build: bun install + build {entry} (script {})", script.display());

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
    let bundle = String::from_utf8_lossy(&build.stdout).into_owned();
    log::info!("project_build: ok, {} bytes", bundle.len());
    Ok(bundle)
}

// Export the open project to a deployable static web build. Runs the bundled Bun
// export script (`bun install` for the project's deps, then `runWebExport` via the
// script), which writes `index.html` + `main.js` + `assets.rpak` + `manifest.json`
// into `<project>/dist/web`. Returns the script's JSON summary `{ outDir, outputs }`.
#[tauri::command]
async fn project_export_web(
    app: tauri::AppHandle,
    project_dir: String,
    production: Option<bool>,
) -> Result<String, String> {
    use tauri::path::BaseDirectory;
    use tauri_plugin_shell::ShellExt;

    // Same resolution as `project_build`: the bundled resource in a shipped app,
    // else the script built into src-tauri/scripts by the beforeDevCommand.
    let script = app
        .path()
        .resolve("scripts/build-web-export.js", BaseDirectory::Resource)
        .ok()
        .filter(|p| p.exists())
        .or_else(|| std::env::current_dir().ok().map(|d| d.join("scripts/build-web-export.js")))
        .filter(|p| p.exists())
        .ok_or_else(|| "web export script not found (run `bun run build:web-export-script`)".to_string())?;

    log::info!(
        "project_export_web: bun install + export {project_dir} (script {})",
        script.display()
    );

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

    let mut export_args = vec![
        script.to_string_lossy().to_string(),
        "--project".to_string(),
        project_dir.clone(),
    ];
    if production.unwrap_or(false) {
        export_args.push("--production".to_string());
    }
    let export = app
        .shell()
        .sidecar("bun")
        .map_err(|e| e.to_string())?
        .args(export_args)
        .current_dir(PathBuf::from(project_dir))
        .output()
        .await
        .map_err(|e| e.to_string())?;
    if !export.status.success() {
        return Err(format!(
            "web export failed: {}",
            String::from_utf8_lossy(&export.stderr)
        ));
    }
    let summary = String::from_utf8_lossy(&export.stdout).into_owned();
    log::info!("project_export_web: ok, {summary}");
    Ok(summary)
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
      studio_log,
      pref_get,
      pref_set,
      pref_remove,
      project_build,
      project_export_web,
      set_project_root,
      project_read_file,
      project_write_file,
      project_read_dir,
      project_delete_file,
      project_rename_file
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
