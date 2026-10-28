#[derive(Clone, Debug)]
pub struct Config {
    pub database_url: String,
    pub jwt_secret: String,
    pub bind_addr: String,
    pub cors_origins: Vec<String>,
    /// JSON array of RTCIceServer objects handed to clients.
    pub ice_servers: serde_json::Value,
    /// Where uploaded attachments are stored.
    pub upload_dir: std::path::PathBuf,
    /// Days between asking to delete an account and it being anonymized (signing in before then restores it).
    pub deletion_grace_days: i64,
    /// Admin cases: messages shown either side of a reported one, hours an approved grant lasts, days a case stays usable.
    pub report_context_window: i64,
    pub case_grant_hours: i64,
    pub case_expiry_days: i64,
    /// Console audit entries are kept this long (at least a year; default about seven, longer than case data).
    pub audit_retention_days: i64,
    /// Instance-wide assets (read-only mount is fine): `avatar-decorations/` today. See routes/assets.rs.
    pub assets_dir: std::path::PathBuf,
    /// GIF picker providers; the first one set is used.
    pub tenor_api_key: Option<String>,
    pub giphy_api_key: Option<String>,
    /// Emails that are Parley admins (comma separated); they may approve Discover submissions.
    pub admin_emails: Vec<String>,
    /// smtp | log (default) | off
    pub mail_mode: String,
    pub smtp_url: Option<String>,
    pub mail_from: String,
    /// Public base URL used in emailed links.
    pub app_url: String,
    /// Hosts/IPs the link-preview fetcher may reach even though they are private (dev/e2e only).
    pub embed_allow_hosts: Vec<String>,
    /// Push-service hosts allowed even though they resolve to private addresses or use plain http (tests).
    pub push_allow_hosts: Vec<String>,
    /// Default per-user storage quota for attachments + profile images; 0 = unlimited.
    pub upload_quota_bytes: i64,
    /// Bearer / ?token= required for GET /metrics when set.
    pub metrics_token: Option<String>,
    /// "text" (default) or "json" structured logs.
    pub log_format: String,
    pub sentry_dsn: Option<String>,
    pub sentry_environment: String,
}

/// `VAR`, or the trimmed contents of the file named by `VAR_FILE` (Docker / Kubernetes secrets mount one file
/// per secret). An unreadable `VAR_FILE` is logged and treated as unset.
pub fn env_or_file(var: &str) -> Option<String> {
    if let Ok(v) = std::env::var(var) {
        return Some(v);
    }
    let path = std::env::var(format!("{var}_FILE")).ok()?;
    match std::fs::read_to_string(&path) {
        Ok(v) => Some(v.trim_end_matches(['\n', '\r']).to_string()),
        Err(e) => { tracing::warn!("{var}_FILE={path}: {e}"); None }
    }
}

impl Config {
    pub fn from_env() -> Self {
        let _ = dotenvy::dotenv();
        Self {
            database_url: env_or_file("DATABASE_URL").ok_or(std::env::VarError::NotPresent)
                .unwrap_or_else(|_| "postgres://parley:parley@localhost:5432/parley".into()),
            jwt_secret: env_or_file("JWT_SECRET").ok_or(std::env::VarError::NotPresent).unwrap_or_else(|_| {
                tracing::warn!("JWT_SECRET not set; using insecure default");
                "dev-insecure-secret-change-me".into()
            }),
            bind_addr: std::env::var("BIND_ADDR").unwrap_or_else(|_| "0.0.0.0:8080".into()),
            cors_origins: std::env::var("CORS_ORIGINS")
                .map(|s| s.split(',').map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect())
                .unwrap_or_default(),
            ice_servers: std::env::var("ICE_SERVERS")
                .ok()
                .and_then(|s| serde_json::from_str(&s).map_err(|e| tracing::warn!("ICE_SERVERS is not valid JSON: {e}")).ok())
                .unwrap_or_else(|| serde_json::json!([{ "urls": "stun:stun.l.google.com:19302" }])),
            upload_dir: std::env::var("UPLOAD_DIR").unwrap_or_else(|_| "./uploads".into()).into(),
            deletion_grace_days: std::env::var("ACCOUNT_DELETION_GRACE_DAYS").ok().and_then(|v| v.parse().ok()).unwrap_or(14i64).clamp(0, 365),
            report_context_window: std::env::var("REPORT_CONTEXT_WINDOW").ok().and_then(|v| v.parse().ok()).unwrap_or(20i64).clamp(0, 200),
            case_grant_hours: std::env::var("CASE_GRANT_HOURS").ok().and_then(|v| v.parse().ok()).unwrap_or(72i64).clamp(1, 24 * 90),
            case_expiry_days: std::env::var("CASE_EXPIRY_DAYS").ok().and_then(|v| v.parse().ok()).unwrap_or(30i64).clamp(1, 3650),
            audit_retention_days: std::env::var("AUDIT_RETENTION_DAYS").ok().and_then(|v| v.parse().ok()).unwrap_or(2555i64).clamp(365, 36500),
            assets_dir: std::env::var("ASSETS_DIR").unwrap_or_else(|_| "./assets".into()).into(),
            tenor_api_key: env_or_file("TENOR_API_KEY").ok_or(std::env::VarError::NotPresent).ok(),
            giphy_api_key: env_or_file("GIPHY_API_KEY").ok_or(std::env::VarError::NotPresent).ok(),
            mail_mode: std::env::var("MAIL_MODE").unwrap_or_else(|_| "log".into()).to_lowercase(),
            smtp_url: env_or_file("SMTP_URL").ok_or(std::env::VarError::NotPresent).ok().filter(|s| !s.is_empty()),
            mail_from: std::env::var("MAIL_FROM").unwrap_or_else(|_| "Parley <no-reply@parley.local>".into()),
            app_url: std::env::var("APP_URL").unwrap_or_else(|_| "http://localhost:3000".into()).trim_end_matches('/').to_string(),
            metrics_token: env_or_file("METRICS_TOKEN").ok_or(std::env::VarError::NotPresent).ok(),
            log_format: std::env::var("LOG_FORMAT").unwrap_or_else(|_| "text".into()).to_lowercase(),
            sentry_dsn: env_or_file("SENTRY_DSN").ok_or(std::env::VarError::NotPresent).ok(),
            sentry_environment: std::env::var("SENTRY_ENVIRONMENT").unwrap_or_else(|_| "production".into()),
            upload_quota_bytes: std::env::var("UPLOAD_QUOTA_BYTES").ok().and_then(|v| v.trim().parse().ok()).unwrap_or(1024 * 1024 * 1024),
            embed_allow_hosts: std::env::var("EMBED_ALLOW_HOSTS").map(|s| s.split(',').map(|x| x.trim().to_lowercase()).filter(|x| !x.is_empty()).collect()).unwrap_or_default(),
            push_allow_hosts: std::env::var("PUSH_ALLOW_HOSTS").map(|s| s.split(',').map(|x| x.trim().to_lowercase()).filter(|x| !x.is_empty()).collect()).unwrap_or_default(),
            admin_emails: std::env::var("ADMIN_EMAILS").map(|s| s.split(',').map(|x| x.trim().to_lowercase()).filter(|x| !x.is_empty()).collect()).unwrap_or_default(),
        }
    }
}
