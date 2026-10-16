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
}

impl Config {
    pub fn from_env() -> Self {
        let _ = dotenvy::dotenv();
        Self {
            database_url: std::env::var("DATABASE_URL")
                .unwrap_or_else(|_| "postgres://parley:parley@localhost:5432/parley".into()),
            jwt_secret: std::env::var("JWT_SECRET").unwrap_or_else(|_| {
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
            tenor_api_key: std::env::var("TENOR_API_KEY").ok(),
            giphy_api_key: std::env::var("GIPHY_API_KEY").ok(),
            mail_mode: std::env::var("MAIL_MODE").unwrap_or_else(|_| "log".into()).to_lowercase(),
            smtp_url: std::env::var("SMTP_URL").ok().filter(|s| !s.is_empty()),
            mail_from: std::env::var("MAIL_FROM").unwrap_or_else(|_| "Parley <no-reply@parley.local>".into()),
            app_url: std::env::var("APP_URL").unwrap_or_else(|_| "http://localhost:3000".into()).trim_end_matches('/').to_string(),
            admin_emails: std::env::var("ADMIN_EMAILS").map(|s| s.split(',').map(|x| x.trim().to_lowercase()).filter(|x| !x.is_empty()).collect()).unwrap_or_default(),
        }
    }
}
