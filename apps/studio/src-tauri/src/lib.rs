use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use tauri::Manager;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
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
    .invoke_handler(tauri::generate_handler![pref_get, pref_set, pref_remove])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
