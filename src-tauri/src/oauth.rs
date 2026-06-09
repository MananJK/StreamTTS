use axum::{
    extract::{Query, State},
    http::{StatusCode, HeaderMap, header::ORIGIN},
    response::{Html, IntoResponse},
    routing::{get, post},
    Router,
    Json,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::broadcast;
use tokio::sync::RwLock;
use hmac::{Hmac, Mac};
use sha2::Sha256;

use crate::alerts::{AlertPayload, TwitchEventSubPayload, process_twitch_event, process_youtube_alert};

type HmacSha256 = Hmac<Sha256>;

fn get_youtube_client_id() -> Result<String, String> {
    std::env::var("YOUTUBE_CLIENT_ID")
        .map_err(|_| "YOUTUBE_CLIENT_ID environment variable is required".to_string())
}

fn get_youtube_client_secret() -> Option<String> {
    std::env::var("YOUTUBE_CLIENT_SECRET").ok()
}

fn get_twitch_eventsub_secret() -> String {
    std::env::var("TWITCH_EVENTSUB_SECRET")
        .unwrap_or_else(|_| "streamtts-default-secret".to_string())
}

fn is_youtube_auth_configured() -> bool {
    get_youtube_client_secret().is_some()
}

const REDIRECT_URI: &str = "http://localhost:3000/callback";
const MAX_REQUESTS_PER_MINUTE: u32 = 30;

#[derive(Debug, Clone, Deserialize)]
pub struct OAuthCallback {
    pub token: String,
    pub service: String,
    pub error: Option<String>,
    pub refresh_token: Option<String>,
    pub expires_in: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
pub struct TokenExchangeRequest {
    pub code: String,
    pub state: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RefreshTokenRequest {
    pub refresh_token: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AuthCompleteRequest {
    pub token: String,
    pub service: String,
    pub error: Option<String>,
    pub refresh_token: Option<String>,
    pub expires_in: Option<i64>,
    pub state: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: i64,
    pub token_type: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ErrorResponse {
    pub error: String,
}

#[derive(Clone)]
struct OAuthServerState {
    sender: broadcast::Sender<OAuthCallback>,
    alert_sender: broadcast::Sender<AlertPayload>,
    rate_limiter: Arc<RwLock<RateLimiter>>,
    oauth_states: Arc<RwLock<HashMap<String, (String, u64)>>>,
}

#[derive(Clone)]
struct RateLimiter {
    requests: HashMap<String, Vec<u64>>,
}

impl RateLimiter {
    fn new() -> Self {
        RateLimiter {
            requests: HashMap::new(),
        }
    }

    fn check_and_record(&mut self, client_ip: &str) -> bool {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        
        let window_start = now.saturating_sub(60);
        
        let entry = self.requests.entry(client_ip.to_string()).or_insert_with(Vec::new);
        entry.retain(|&timestamp| timestamp > window_start);
        
        if entry.len() >= MAX_REQUESTS_PER_MINUTE as usize {
            return false;
        }
        
        entry.push(now);
        true
    }
}

const OAUTH_STATE_EXPIRY_SECS: u64 = 600;

fn validate_state(
    state: &str,
    states: &HashMap<String, (String, u64)>
) -> Option<String> {
    let parts: Vec<&str> = state.split('_').collect();
    if parts.len() < 3 {
        return None;
    }

    let service = parts[0];
    let received_nonce = parts[1];
    let timestamp_str = parts[2];
    let timestamp: u64 = timestamp_str.parse().ok()?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    if now.saturating_sub(timestamp) > OAUTH_STATE_EXPIRY_SECS {
        return None;
    }

    let key = format!("{}_{}", service, received_nonce);
    states.get(&key).map(|(s, _t)| s.clone())
}

/// Verify Twitch EventSub message signature
fn verify_twitch_signature(headers: &HeaderMap, body: &str) -> bool {
    let message_id = headers.get("Twitch-Eventsub-Message-Id")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("");
    let timestamp = headers.get("Twitch-Eventsub-Message-Timestamp")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("");
    let signature = headers.get("Twitch-Eventsub-Message-Signature")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("");
    
    if message_id.is_empty() || timestamp.is_empty() || signature.is_empty() {
        return false;
    }
    
    let secret = get_twitch_eventsub_secret();
    let message = format!("{}{}{}", message_id, timestamp, body);
    
    let mut mac = match HmacSha256::new_from_slice(secret.as_bytes()) {
        Ok(mac) => mac,
        Err(_) => return false,
    };
    
    mac.update(message.as_bytes());
    let result = mac.finalize();
    let expected = format!("sha256={}", hex::encode(result.into_bytes()));
    
    // Constant-time comparison
    if expected.len() != signature.len() {
        return false;
    }
    
    expected.bytes().zip(signature.bytes()).fold(0u8, |acc, (a, b)| acc | (a ^ b)) == 0
}

/// Check if origin is allowed
/// Allows known development origins OR requests without Origin header (Tauri local requests)
fn is_allowed_origin(headers: &HeaderMap) -> bool {
    let allowed = [
        "http://localhost:3000",
        "http://localhost:8080",
        "http://localhost:5173",
    ];
    
    if let Some(origin) = headers.get(ORIGIN).and_then(|h| h.to_str().ok()) {
        return allowed.iter().any(|&a| a == origin);
    }
    
    // Check for Tauri-specific header (webview local request)
    // This is a defensive check - Tauri requests typically don't send Origin
    if let Some(host) = headers.get("host").and_then(|h| h.to_str().ok()) {
        if host.starts_with("127.0.0.1:") || host.starts_with("localhost:") {
            return true;
        }
    }
    
    // Reject requests without origin from non-local hosts
    // This prevents CSRF from external sites
    false
}

pub async fn start_oauth_server(
    sender: broadcast::Sender<OAuthCallback>,
    alert_sender: broadcast::Sender<AlertPayload>,
) -> anyhow::Result<()> {
    if !is_youtube_auth_configured() {
        log::warn!("YOUTUBE_CLIENT_SECRET not set. YouTube OAuth will return configuration errors.");
    }
    
    let state = Arc::new(OAuthServerState {
        sender,
        alert_sender,
        rate_limiter: Arc::new(RwLock::new(RateLimiter::new())),
        oauth_states: Arc::new(RwLock::new(HashMap::new())),
    });
    let app = Router::new()
        .route("/callback", get(handle_callback))
        .route("/auth-complete", post(handle_auth_complete))
        .route("/auth-exchange", post(handle_auth_exchange))
        .route("/auth-refresh", post(handle_auth_refresh))
        .route("/twitch-alerts", post(handle_twitch_alerts))
        .route("/youtube-alerts", get(handle_youtube_challenge).post(handle_youtube_alerts))
        .with_state(state);

    let addr = SocketAddr::from(([127, 0, 0, 1], 3000));
    let listener = TcpListener::bind(addr).await?;
    log::info!("OAuth server listening on {}", addr);

    axum::serve(listener, app).await?;
    Ok(())
}

async fn check_rate_limit(state: &Arc<OAuthServerState>, client_ip: &str) -> bool {
    let mut limiter = state.rate_limiter.write().await;
    limiter.check_and_record(client_ip)
}

async fn handle_callback(Query(_params): Query<HashMap<String, String>>) -> Html<&'static str> {
    Html(include_str!("../oauth_callback.html"))
}

async fn handle_auth_complete(
    headers: HeaderMap,
    State(state): State<Arc<OAuthServerState>>,
    Json(payload): Json<AuthCompleteRequest>,
) -> impl IntoResponse {
    if !is_allowed_origin(&headers) {
        log::warn!("Rejected auth-complete from disallowed origin");
        return StatusCode::FORBIDDEN.into_response();
    }

    let client_ip = "local";
    if !check_rate_limit(&state, client_ip).await {
        return (StatusCode::TOO_MANY_REQUESTS, Json(ErrorResponse {
            error: "Rate limit exceeded. Please try again later.".to_string(),
        })).into_response();
    }
    
    if let Some(ref state_param) = payload.state {
        let states = state.oauth_states.read().await;
        if validate_state(state_param, &states).is_none() {
            log::warn!("Invalid OAuth state parameter in auth-complete");
            return (StatusCode::BAD_REQUEST, Json(ErrorResponse {
                error: "Invalid or expired OAuth state".to_string(),
            })).into_response();
        }
    }
    
    log::info!("Received auth complete for service: {}", payload.service);
    
    let callback = OAuthCallback {
        token: payload.token,
        service: payload.service,
        error: payload.error,
        refresh_token: payload.refresh_token,
        expires_in: payload.expires_in,
    };
    
    if let Err(e) = state.sender.send(callback) {
        log::error!("Failed to send OAuth callback: {}", e);
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse {
            error: "Internal server error".to_string(),
        })).into_response();
    }
    
    "OK".into_response()
}

async fn handle_twitch_alerts(
    headers: HeaderMap,
    State(state): State<Arc<OAuthServerState>>,
    body: String,
) -> impl IntoResponse {
    let message_type = headers.get("Twitch-Eventsub-Message-Type")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("");

    match message_type {
        "webhook_callback_verification" => {
            // Verify signature for challenge requests too
            if !verify_twitch_signature(&headers, &body) {
                log::warn!("Twitch EventSub verification request with invalid signature");
                return StatusCode::FORBIDDEN.into_response();
            }
            
            if let Ok(payload) = serde_json::from_str::<serde_json::Value>(&body) {
                let challenge = payload["challenge"].as_str().unwrap_or("");
                log::info!("Twitch EventSub verification challenge received");
                challenge.to_string().into_response()
            } else {
                StatusCode::BAD_REQUEST.into_response()
            }
        }
        "notification" => {
            // Verify Twitch EventSub signature
            if !verify_twitch_signature(&headers, &body) {
                log::warn!("Twitch EventSub notification with invalid signature - rejected");
                return StatusCode::FORBIDDEN.into_response();
            }
            
            if let Ok(payload) = serde_json::from_str::<serde_json::Value>(&body) {
                if let Ok(twitch_payload) = serde_json::from_value::<TwitchEventSubPayload>(payload) {
                    if let Some(alert) = process_twitch_event(twitch_payload) {
                        log::info!("Twitch alert processed: {} - {}", alert.alert_type, alert.user_name);
                        let _ = state.alert_sender.send(alert);
                    }
                }
            }
            StatusCode::OK.into_response()
        }
        _ => StatusCode::OK.into_response(),
    }
}

async fn handle_youtube_challenge(
    Query(params): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    if let Some(challenge) = params.get("hub.challenge") {
        log::info!("YouTube PubSubHubbub verification challenge received");
        challenge.clone().into_response()
    } else {
        StatusCode::BAD_REQUEST.into_response()
    }
}

async fn handle_youtube_alerts(
    State(state): State<Arc<OAuthServerState>>,
    body: String,
) -> impl IntoResponse {
    log::info!("Received YouTube alert notification");
    if let Some(alert) = process_youtube_alert(&body) {
        let _ = state.alert_sender.send(alert);
    }
    StatusCode::OK.into_response()
}

async fn handle_auth_exchange(
    headers: HeaderMap,
    State(state): State<Arc<OAuthServerState>>,
    Json(payload): Json<TokenExchangeRequest>,
) -> impl IntoResponse {
    if !is_allowed_origin(&headers) {
        log::warn!("Rejected auth-exchange from disallowed origin");
        return StatusCode::FORBIDDEN.into_response();
    }
    
    log::info!("Received auth exchange request for YouTube");
    
    let client_secret = match get_youtube_client_secret() {
        Some(secret) => secret,
        None => {
            log::error!("YouTube auth not configured");
            return (StatusCode::SERVICE_UNAVAILABLE, Json(ErrorResponse {
                error: "YouTube authentication is not configured.".to_string(),
            })).into_response();
        }
    };
    
    let client = reqwest::Client::new();
    let client_id = match get_youtube_client_id() {
        Ok(id) => id,
        Err(e) => {
            log::error!("YouTube client ID not configured: {}", e);
            return (StatusCode::SERVICE_UNAVAILABLE, Json(ErrorResponse {
                error: "YouTube client ID is not configured".to_string(),
            })).into_response();
        }
    };
    
    let params = [
        ("code", payload.code.as_str()),
        ("client_id", &client_id),
        ("client_secret", &client_secret),
        ("redirect_uri", REDIRECT_URI),
        ("grant_type", "authorization_code"),
    ];
    
    let response = match client
        .post("https://oauth2.googleapis.com/token")
        .form(&params)
        .send()
        .await
    {
        Ok(resp) => resp,
        Err(e) => {
            log::error!("Failed to send token exchange request: {}", e);
            return (StatusCode::BAD_GATEWAY, Json(ErrorResponse {
                error: "Failed to connect to authentication provider.".to_string(),
            })).into_response();
        }
    };
    
    if !response.status().is_success() {
        log::error!("Token exchange failed with status: {}", response.status());
        return (StatusCode::BAD_REQUEST, Json(ErrorResponse {
            error: "Token exchange failed. Please try again.".to_string(),
        })).into_response();
    }
    
    let token_response: GoogleTokenResponse = match response.json().await {
        Ok(resp) => resp,
        Err(e) => {
            log::error!("Failed to parse token response: {}", e);
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse {
                error: "Failed to process authentication response.".to_string(),
            })).into_response();
        }
    };
    
    log::info!("Successfully exchanged code for tokens");
    
    let callback = OAuthCallback {
        token: token_response.access_token.clone(),
        service: "youtube".to_string(),
        error: None,
        refresh_token: token_response.refresh_token.clone(),
        expires_in: Some(token_response.expires_in),
    };
    
    if let Err(e) = state.sender.send(callback) {
        log::error!("Failed to send OAuth callback: {}", e);
    }
    
    Json(TokenResponse {
        access_token: token_response.access_token,
        refresh_token: token_response.refresh_token,
        expires_in: token_response.expires_in,
        token_type: token_response.token_type,
    }).into_response()
}

async fn handle_auth_refresh(
    headers: HeaderMap,
    State(state): State<Arc<OAuthServerState>>,
    Json(payload): Json<RefreshTokenRequest>,
) -> impl IntoResponse {
    if !is_allowed_origin(&headers) {
        log::warn!("Rejected auth-refresh from disallowed origin");
        return StatusCode::FORBIDDEN.into_response();
    }
    
    log::info!("Received token refresh request for YouTube");
    
    let client_secret = match get_youtube_client_secret() {
        Some(secret) => secret,
        None => {
            return (StatusCode::SERVICE_UNAVAILABLE, Json(ErrorResponse {
                error: "YouTube authentication is not configured.".to_string(),
            })).into_response();
        }
    };
    
    let client = reqwest::Client::new();
    let client_id = match get_youtube_client_id() {
        Ok(id) => id,
        Err(e) => {
            log::error!("YouTube client ID not configured: {}", e);
            return (StatusCode::SERVICE_UNAVAILABLE, Json(ErrorResponse {
                error: "YouTube client ID is not configured".to_string(),
            })).into_response();
        }
    };
    
    let params = [
        ("refresh_token", payload.refresh_token.as_str()),
        ("client_id", &client_id),
        ("client_secret", &client_secret),
        ("grant_type", "refresh_token"),
    ];
    
    let response = match client
        .post("https://oauth2.googleapis.com/token")
        .form(&params)
        .send()
        .await
    {
        Ok(resp) => resp,
        Err(_) => {
            return (StatusCode::BAD_GATEWAY, Json(ErrorResponse {
                error: "Failed to connect to authentication provider.".to_string(),
            })).into_response();
        }
    };
    
    if !response.status().is_success() {
        return (StatusCode::BAD_REQUEST, Json(ErrorResponse {
            error: "Token refresh failed. Please log in again.".to_string(),
        })).into_response();
    }
    
    let token_response: GoogleTokenResponse = match response.json().await {
        Ok(resp) => resp,
        Err(_) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse {
                error: "Failed to process refresh response.".to_string(),
            })).into_response();
        }
    };
    
    log::info!("Successfully refreshed access token");
    
    let callback = OAuthCallback {
        token: token_response.access_token.clone(),
        service: "youtube".to_string(),
        error: None,
        refresh_token: token_response.refresh_token.clone(),
        expires_in: Some(token_response.expires_in),
    };

    if let Err(e) = state.sender.send(callback) {
        log::error!("Failed to send OAuth callback for refresh: {}", e);
    }

    Json(TokenResponse {
        access_token: token_response.access_token,
        refresh_token: token_response.refresh_token,
        expires_in: token_response.expires_in,
        token_type: token_response.token_type,
    }).into_response()
}

#[derive(Debug, Clone, Deserialize)]
struct GoogleTokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: i64,
    token_type: String,
}
