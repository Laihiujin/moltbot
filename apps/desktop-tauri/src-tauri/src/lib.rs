use serde::Serialize;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::Manager;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

type GatewayChild = Arc<Mutex<Option<CommandChild>>>;
struct GatewayState(GatewayChild);

#[derive(Serialize)]
struct GatewayBootstrap {
    gateway_url: String,
    token: Option<String>,
}

// ──────────────────────────────────────────
// IPC Commands
// ──────────────────────────────────────────

#[tauri::command]
fn check_onboarding_needed() -> bool {
    let path = config_path();
    if !path.exists() {
        return true;
    }
    match std::fs::read_to_string(&path) {
        Ok(s) => !s.contains("\"model\""),
        Err(_) => true,
    }
}

#[tauri::command]
fn write_config(json: String) -> Result<(), String> {
    let path = config_path();
    if let Some(p) = path.parent() {
        std::fs::create_dir_all(p).map_err(|e| e.to_string())?;
    }
    let new_val: serde_json::Value =
        serde_json::from_str(&json).map_err(|e| format!("Invalid JSON: {e}"))?;
    let merged = if path.exists() {
        let existing: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap_or_default())
                .unwrap_or(serde_json::json!({}));
        let mut m = existing;
        json_merge(&mut m, new_val);
        migrate_legacy_auth_token(&mut m);
        m
    } else {
        let mut m = new_val;
        migrate_legacy_auth_token(&mut m);
        m
    };
    std::fs::write(
        &path,
        serde_json::to_string_pretty(&merged).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

/// Called from JS after saving config — navigates window to Control UI
/// by injecting a JS redirect (Tauri v2 doesn't have a window.navigate() API)
#[tauri::command]
fn open_control_ui(window: tauri::WebviewWindow) -> Result<(), String> {
    window
        .eval("window.location.href = 'http://127.0.0.1:18789'")
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn bootstrap_gateway_access(
    app: tauri::AppHandle,
    state: tauri::State<'_, GatewayState>,
) -> Result<GatewayBootstrap, String> {
    ensure_gateway_running(&app, state.inner().0.clone())?;
    Ok(GatewayBootstrap {
        gateway_url: "ws://127.0.0.1:18789".to_string(),
        token: read_gateway_token_from_config(),
    })
}

// ──────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────

fn config_path() -> PathBuf {
    resolve_home_dir().join(".openclaw").join("openclaw.json")
}

fn resolve_home_dir() -> PathBuf {
    if let Ok(user_profile) = std::env::var("USERPROFILE") {
        if !user_profile.trim().is_empty() {
            return PathBuf::from(user_profile);
        }
    }
    if let (Ok(home_drive), Ok(home_path)) = (std::env::var("HOMEDRIVE"), std::env::var("HOMEPATH"))
    {
        let combined = format!("{home_drive}{home_path}");
        if !combined.trim().is_empty() {
            return PathBuf::from(combined);
        }
    }
    if let Ok(home) = std::env::var("HOME") {
        if !home.trim().is_empty() {
            return PathBuf::from(home);
        }
    }
    if let Ok(app_data) = std::env::var("APPDATA") {
        let path = PathBuf::from(app_data);
        if let Some(parent) = path.parent() {
            return parent.to_path_buf();
        }
    }
    PathBuf::from("C:\\Users\\Default")
}

fn json_merge(dst: &mut serde_json::Value, src: serde_json::Value) {
    match (dst, src) {
        (serde_json::Value::Object(d), serde_json::Value::Object(s)) => {
            for (k, v) in s {
                json_merge(d.entry(k).or_insert(serde_json::Value::Null), v);
            }
        }
        (dst, src) => *dst = src,
    }
}

fn read_gateway_token_from_config() -> Option<String> {
    let path = config_path();
    let raw = std::fs::read_to_string(path).ok()?;
    let parsed: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let token = parsed
        .pointer("/gateway/auth/token")
        .or_else(|| parsed.pointer("/auth/token"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())?;
    if token.starts_with("${") && token.ends_with('}') {
        return None;
    }
    Some(token.to_string())
}

fn read_nonempty_plain_token(config: &serde_json::Value, pointer: &str) -> Option<String> {
    let token = config
        .pointer(pointer)
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())?;
    if token.starts_with("${") && token.ends_with('}') {
        return None;
    }
    Some(token.to_string())
}

fn migrate_legacy_auth_token(config: &mut serde_json::Value) {
    if read_nonempty_plain_token(config, "/gateway/auth/token").is_some() {
        return;
    }
    let mode = config
        .pointer("/gateway/auth/mode")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .unwrap_or("token");
    if mode != "token" && !mode.is_empty() {
        return;
    }
    let Some(legacy_token) = read_nonempty_plain_token(config, "/auth/token") else {
        return;
    };
    json_merge(
        config,
        serde_json::json!({
            "gateway": {
                "auth": {
                    "mode": "token",
                    "token": legacy_token
                }
            }
        }),
    );
}

fn maybe_migrate_config_file() -> Result<bool, String> {
    let path = config_path();
    if !path.exists() {
        return Ok(false);
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut parsed: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| format!("Invalid config JSON: {e}"))?;
    let before = parsed.clone();
    migrate_legacy_auth_token(&mut parsed);
    if parsed == before {
        return Ok(false);
    }
    std::fs::write(
        &path,
        serde_json::to_string_pretty(&parsed).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(true)
}

fn ensure_gateway_running(app: &tauri::AppHandle, child_arc: GatewayChild) -> Result<(), String> {
    if child_arc.lock().map_err(|e| e.to_string())?.is_some() {
        return Ok(());
    }
    let bundled_index_js = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("dist")
        .join("index.js");
    let dev_index_js = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../dist")
        .join("index.js");
    let index_js = if bundled_index_js.exists() {
        bundled_index_js
    } else if dev_index_js.exists() {
        dev_index_js
    } else {
        return Err("Gateway index.js not found in app resources".to_string());
    };
    let runtime_dir = index_js
        .parent()
        .and_then(|p| p.parent())
        .ok_or_else(|| "Unable to resolve gateway runtime directory".to_string())?;
    let sidecar = app
        .shell()
        .sidecar("node")
        .map_err(|e| format!("Gateway sidecar unavailable: {e}"))?;
    let (rx, proc) = sidecar
        .current_dir(runtime_dir)
        .args([
            "dist/index.js",
            "gateway",
            "run",
            "--port",
            "18789",
            "--force",
        ])
        .spawn()
        .map_err(|e| format!("Gateway start failed: {e}"))?;
    let pid = proc.pid();
    log::info!(
        "Gateway pid={pid}, cwd={}",
        runtime_dir.to_string_lossy()
    );
    if let Ok(mut guard) = child_arc.lock() {
        *guard = Some(proc);
    }
    let child_for_events = child_arc.clone();
    tauri::async_runtime::spawn(async move {
        let mut rx = rx;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let text = String::from_utf8_lossy(&line).trim().to_string();
                    if !text.is_empty() {
                        log::info!("Gateway[{pid}] stdout: {text}");
                    }
                }
                CommandEvent::Stderr(line) => {
                    let text = String::from_utf8_lossy(&line).trim().to_string();
                    if !text.is_empty() {
                        log::warn!("Gateway[{pid}] stderr: {text}");
                    }
                }
                CommandEvent::Error(err) => {
                    log::error!("Gateway[{pid}] event error: {err}");
                }
                CommandEvent::Terminated(payload) => {
                    log::warn!(
                        "Gateway[{pid}] terminated: code={:?} signal={:?}",
                        payload.code,
                        payload.signal
                    );
                    if let Ok(mut guard) = child_for_events.lock() {
                        let should_clear = guard.as_ref().map(|child| child.pid() == pid).unwrap_or(false);
                        if should_clear {
                            *guard = None;
                        }
                    }
                    break;
                }
                _ => {}
            }
        }
    });
    Ok(())
}

// ──────────────────────────────────────────
// Entry point
// ──────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Create gateway child Arc before Builder so on_window_event can own a clone
    let child: GatewayChild = Arc::new(Mutex::new(None));
    let child_for_event = child.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .manage(GatewayState(child))
        .invoke_handler(tauri::generate_handler![
            check_onboarding_needed,
            write_config,
            open_control_ui,
            bootstrap_gateway_access,
        ])
        .setup(|app| {
            match maybe_migrate_config_file() {
                Ok(true) => {
                    log::info!("Migrated legacy auth.token into gateway.auth.token.");
                }
                Ok(false) => {}
                Err(err) => {
                    log::warn!("Legacy auth token migration skipped: {err}");
                }
            }
            log::info!("Desktop config path: {}", config_path().to_string_lossy());
            let needs_onboard = check_onboarding_needed();
            if needs_onboard {
                log::info!("Onboarding config missing; using Control UI fallback page.");
            }

            // Launch gateway sidecar
            if let Err(err) =
                ensure_gateway_running(app.handle(), app.state::<GatewayState>().inner().0.clone())
            {
                log::warn!("Gateway startup skipped: {err}");
            }
            Ok(())
        })
        .on_page_load(move |window, _payload| {
            let Some(token) = read_gateway_token_from_config() else {
                return;
            };
            let safe_token = token.replace('\\', "\\\\").replace('\'', "\\'");
            let js = format!(
                "(() => {{
                  const token = '{safe_token}';
                  const keyA = 'openclaw.control.token.v1:ws://127.0.0.1:18789';
                  const keyB = 'openclaw.control.token.v1:ws://localhost:18789';
                  const apply = () => {{
                    try {{
                      sessionStorage.setItem(keyA, token);
                      sessionStorage.setItem(keyB, token);
                    }} catch (_e) {{}}
                    const app = document.querySelector('openclaw-app');
                    if (!app || typeof app.applySettings !== 'function') return false;
                    try {{
                      const next = {{ ...app.settings, gatewayUrl: 'ws://127.0.0.1:18789', token }};
                      app.applySettings(next);
                      if (typeof app.connect === 'function') {{
                        app.connect();
                      }}
                      return true;
                    }} catch (_e) {{
                      return false;
                    }}
                  }};
                  if (apply()) return;
                  let tries = 0;
                  const t = setInterval(() => {{
                    tries += 1;
                    if (apply() || tries > 24) clearInterval(t);
                  }}, 150);
                }})();"
            );
            let _ = window.eval(&js);
        })
        .on_window_event(move |_win, event| {
            if let tauri::WindowEvent::Destroyed = event {
                // Use the pre-cloned Arc owned by this closure
                if let Ok(mut g) = child_for_event.lock() {
                    if let Some(proc) = g.take() {
                        log::info!("Stopping gateway...");
                        let _ = proc.kill();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error running openclaw");
}
