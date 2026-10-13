#[derive(Clone, Debug)]
pub struct Config {
    pub database_url: String,
    pub jwt_secret: String,
    pub bind_addr: String,
    pub cors_origins: Vec<String>,
}

impl Config {
    pub fn from_env() -> Self {
        let _ = dotenvy::dotenv();
        Self {
            database_url: std::env::var("DATABASE_URL")
                .unwrap_or_else(|_| "postgres://y99:y99@localhost:5432/y99".into()),
            jwt_secret: std::env::var("JWT_SECRET").unwrap_or_else(|_| {
                tracing::warn!("JWT_SECRET not set; using insecure default");
                "dev-insecure-secret-change-me".into()
            }),
            bind_addr: std::env::var("BIND_ADDR").unwrap_or_else(|_| "0.0.0.0:8080".into()),
            cors_origins: std::env::var("CORS_ORIGINS")
                .map(|s| s.split(',').map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect())
                .unwrap_or_default(),
        }
    }
}
