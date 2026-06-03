use tauri::{Emitter, Manager};
use tokio::sync::broadcast;

mod oauth;
mod alerts;

use oauth::{OAuthCallback, start_oauth_server};
use alerts::AlertPayload;



pub struct AppState {
    #[allow(dead_code)]
    pub oauth_sender: broadcast::Sender<OAuthCallback>,
    #[allow(dead_code)]
    pub alert_sender: broadcast::Sender<AlertPayload>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Load environment variables from .env file
    dotenv::dotenv().ok();
    
    let (oauth_sender, mut oauth_receiver) = broadcast::channel(32);
    let (alert_sender, mut alert_receiver) = broadcast::channel(32);
    
tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(move |app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            
            let oauth_sender_clone = oauth_sender.clone();
            let alert_sender_clone = alert_sender.clone();
            let app_handle_oauth = app.handle().clone();
            let app_handle_alerts = app.handle().clone();
            
            tauri::async_runtime::spawn(async move {
                if let Err(e) = start_oauth_server(oauth_sender_clone, alert_sender_clone).await {
                    log::error!("OAuth server error: {}", e);
                }
            });
            
            app.manage(AppState {
                oauth_sender,
                alert_sender,
            });
            
            tauri::async_runtime::spawn(async move {
                loop {
                    match oauth_receiver.recv().await {
                        Ok(callback) => {
                            log::info!("Received OAuth callback, emitting to frontend: service={}", callback.service);
                            
                            let payload = serde_json::json!({
                                "type": format!("{}-oauth-callback", callback.service),
                                "token": callback.token,
                                "service": callback.service,
                                "error": callback.error,
                                "refresh_token": callback.refresh_token,
                                "expires_in": callback.expires_in
                            });
                            
                            app_handle_oauth.emit("auth-callback", payload)
                                .map_err(|e| log::error!("Failed to emit auth callback: {}", e))
                                .ok();
                        }
                        Err(e) => {
                            log::error!("OAuth receiver error: {}", e);
                            break;
                        }
                    }
                }
            });

            tauri::async_runtime::spawn(async move {
                loop {
                    match alert_receiver.recv().await {
                        Ok(alert) => {
                            log::info!("Received alert, emitting to frontend: platform={}, type={}", alert.platform, alert.alert_type);
                            
                            app_handle_alerts.emit("integration-alert", alert)
                                .map_err(|e| log::error!("Failed to emit alert: {}", e))
                                .ok();
                        }
                        Err(e) => {
                            log::error!("Alert receiver error: {}", e);
                            break;
                        }
                    }
                }
            });
            
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
