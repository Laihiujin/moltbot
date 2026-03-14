use serde::Serialize;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::Manager;
use tauri_plugin_shell::process::CommandChild;
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
        m
    } else {
        new_val
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
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| "C:\\Users\\Default".to_string());
    PathBuf::from(home).join(".openclaw").join("openclaw.json")
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
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())?;
    if token.starts_with("${") && token.ends_with('}') {
        return None;
    }
    Some(token.to_string())
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
    let handle = app.clone();
    let idx = index_js.to_string_lossy().to_string();
    tauri::async_runtime::spawn(async move {
        match handle
            .shell()
            .sidecar("gateway")
            .expect("sidecar")
            .args([idx.as_str(), "gateway", "--port", "18789", "--bind", "lan"])
            .spawn()
        {
            Ok((_rx, proc)) => {
                log::info!("Gateway pid={}", proc.pid());
                if let Ok(mut guard) = child_arc.lock() {
                    *guard = Some(proc);
                }
            }
            Err(e) => log::error!("Gateway start failed: {e}"),
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
    let bootstrap_token = read_gateway_token_from_config();

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
            // Decide initial page: onboarding or Control UI
            let needs_onboard = check_onboarding_needed();
            let onboard_html = app
                .path()
                .resource_dir()
                .unwrap_or_default()
                .join("onboard.html");

            if needs_onboard && onboard_html.exists() {
                // Navigate to bundled onboard page using JS eval after a short delay
                if let Some(win) = app.get_webview_window("main") {
                    let path_str = onboard_html.to_string_lossy().replace('\\', "/");
                    let url = format!(
                        "https://asset.localhost/{}",
                        path_str.trim_start_matches('/')
                    );
                    log::info!("Showing onboarding page: {}", url);
                    let _ = win.eval(&format!("window.location.href = '{url}'"));
                }
            }
            // If not needed, bootstrap Control UI with token hash to avoid manual paste.
            if !needs_onboard {
                if let Some(token) = read_gateway_token_from_config() {
                    if let Some(win) = app.get_webview_window("main") {
                        let safe_token = token.replace('\\', "\\\\").replace('\'', "\\'");
                        let _ = win.eval(&format!(
                            "window.location.href = 'http://127.0.0.1:18789/#token=' + encodeURIComponent('{safe_token}')"
                        ));
                    }
                }
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
            let Some(token) = bootstrap_token.clone() else {
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
