//! Token-bucket rate limiting, in memory, per bucket and key (client IP or user id).
//!
//! Limits are `count/seconds` strings from the environment (defaults below): `RL_REGISTER`,
//! `RL_LOGIN`, `RL_LOGIN_FAIL`, `RL_MESSAGES`, `RL_UPLOADS`, `RL_GIFS`, `RL_MAIL`, `RL_OAUTH` (MCP client registration
//! and tokens, per IP: AI services call from a few shared addresses for all their users). A bucket refills
//! continuously (count tokens per window) so bursts up to `count` are allowed. Exhausted buckets
//! answer 429 with a `Retry-After` header and a JSON error.

use crate::auth::verify_token;
use axum::{
    body::Body,
    extract::Request,
    http::{header, HeaderMap, HeaderValue, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use dashmap::DashMap;
use serde_json::json;
use std::{sync::LazyLock, time::Instant};

#[derive(Clone, Copy, Debug)]
pub struct Limit {
    pub count: f64,
    pub secs: f64,
}

/// Buckets an admin may override from Instance Settings.
pub const BUCKETS: [&str; 8] = ["register", "login", "login_fail", "messages", "uploads", "gifs", "mail", "oauth"];

impl Limit {
    /// `count/seconds`, both positive.
    pub fn parse(raw: &str) -> Option<Limit> {
        raw.split_once('/').and_then(|(c, s)| Some(Limit { count: c.trim().parse().ok()?, secs: s.trim().parse().ok()? })).filter(|l| l.count > 0.0 && l.secs > 0.0)
    }
    fn from_env(var: &str, default: &str) -> Limit {
        let raw = std::env::var(var).unwrap_or_else(|_| default.to_string());
        let parsed = raw.split_once('/').and_then(|(c, s)| Some(Limit { count: c.trim().parse().ok()?, secs: s.trim().parse().ok()? }));
        match parsed {
            Some(l) if l.count > 0.0 && l.secs > 0.0 => l,
            _ => {
                tracing::warn!("{var}={raw:?} is not count/seconds; using {default}");
                let (c, s) = default.split_once('/').unwrap();
                Limit { count: c.parse().unwrap(), secs: s.parse().unwrap() }
            }
        }
    }
}

pub struct Limits {
    pub register: Limit,
    pub login: Limit,
    pub login_fail: Limit,
    pub messages: Limit,
    pub uploads: Limit,
    pub gifs: Limit,
    pub mail: Limit,
    pub oauth: Limit,
}

struct Bucket {
    tokens: f64,
    updated: Instant,
}

pub struct RateLimiter {
    pub limits: Limits,
    /// Instance Settings overrides by bucket name; empty = environment defaults.
    overrides: std::sync::RwLock<std::collections::HashMap<String, Limit>>,
    buckets: DashMap<(&'static str, String), Bucket>,
}

pub static LIMITER: LazyLock<RateLimiter> = LazyLock::new(|| RateLimiter {
    limits: Limits {
        register: Limit::from_env("RL_REGISTER", "20/60"),
        login: Limit::from_env("RL_LOGIN", "30/60"),
        login_fail: Limit::from_env("RL_LOGIN_FAIL", "5/60"),
        messages: Limit::from_env("RL_MESSAGES", "10/5"),
        uploads: Limit::from_env("RL_UPLOADS", "30/60"),
        gifs: Limit::from_env("RL_GIFS", "60/60"),
        mail: Limit::from_env("RL_MAIL", "3/600"),
        oauth: Limit::from_env("RL_OAUTH", "300/60"),
    },
    overrides: std::sync::RwLock::new(std::collections::HashMap::new()),
    buckets: DashMap::new(),
});

impl RateLimiter {
    fn env_limit(&self, name: &str) -> Limit {
        match name {
            "register" => self.limits.register,
            "login" => self.limits.login,
            "login_fail" => self.limits.login_fail,
            "messages" => self.limits.messages,
            "uploads" => self.limits.uploads,
            "gifs" => self.limits.gifs,
            "oauth" => self.limits.oauth,
            _ => self.limits.mail,
        }
    }
    /// The effective limit for a bucket: the admin override if set, else the environment value.
    pub fn limit(&self, name: &str) -> Limit {
        self.overrides.read().ok().and_then(|o| o.get(name).copied()).unwrap_or_else(|| self.env_limit(name))
    }
    /// Replace all overrides (from Instance Settings, at startup and on every save).
    pub fn apply_overrides(&self, map: &std::collections::HashMap<String, String>) {
        let parsed = map.iter().filter_map(|(k, v)| Limit::parse(v).map(|l| (k.clone(), l))).collect();
        if let Ok(mut o) = self.overrides.write() { *o = parsed; }
    }
    pub fn env_defaults(&self) -> std::collections::HashMap<String, String> {
        BUCKETS.iter().map(|b| { let l = self.env_limit(b); (b.to_string(), format!("{}/{}", l.count, l.secs)) }).collect()
    }

    /// Take one token from `bucket` for `key`. Err carries the seconds until a token is back.
    pub fn take(&self, bucket: &'static str, key: &str, limit: Limit) -> Result<(), u64> {
        let now = Instant::now();
        let mut b = self.buckets.entry((bucket, key.to_string())).or_insert(Bucket { tokens: limit.count, updated: now });
        let refill = now.duration_since(b.updated).as_secs_f64() * (limit.count / limit.secs);
        b.tokens = (b.tokens + refill).min(limit.count);
        b.updated = now;
        if b.tokens >= 1.0 {
            b.tokens -= 1.0;
            Ok(())
        } else {
            Err(((1.0 - b.tokens) / (limit.count / limit.secs)).ceil().max(1.0) as u64)
        }
    }

    /// Is there at least one token, without taking it?
    pub fn peek(&self, bucket: &'static str, key: &str, limit: Limit) -> Result<(), u64> {
        match self.take(bucket, key, limit) {
            Ok(()) => {
                if let Some(mut b) = self.buckets.get_mut(&(bucket, key.to_string())) { b.tokens = (b.tokens + 1.0).min(limit.count) }
                Ok(())
            }
            Err(s) => Err(s),
        }
    }

    /// Forget buckets idle for over 10 minutes.
    pub fn prune(&self) {
        let cutoff = Instant::now() - std::time::Duration::from_secs(600);
        self.buckets.retain(|_, b| b.updated > cutoff);
    }
}

/// The client address: first hop of X-Forwarded-For (nginx sets it), else X-Real-IP, else "unknown".
pub fn client_ip(headers: &HeaderMap) -> String {
    headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(',').next())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| headers.get("x-real-ip").and_then(|v| v.to_str().ok()).map(|s| s.to_string()))
        .unwrap_or_else(|| "unknown".to_string())
}

fn user_key(headers: &HeaderMap, secret: &str) -> Option<String> {
    let value = headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    let token = value.strip_prefix("Bearer ").or_else(|| value.strip_prefix("Bot "))?;
    // Opaque app, bot and MCP tokens get a bucket of their own: an AI service calls from a few shared addresses,
    // so keying them by IP would make all its users share one limit.
    if ["mcp_", "oa_", "bot_"].iter().any(|p| token.starts_with(p)) { return Some(format!("t:{}", crate::routes::applications::hash(token))); }
    verify_token(secret, token).map(|u| u.to_string())
}

pub fn too_many(retry: u64) -> Response {
    let mut resp = (StatusCode::TOO_MANY_REQUESTS, Json(json!({ "error": format!("Too many requests. Try again in {retry}s."), "retry_after": retry }))).into_response();
    resp.headers_mut().insert(header::RETRY_AFTER, HeaderValue::from(retry));
    resp
}

async fn limited(bucket: &'static str, limit: Limit, key: String, req: Request<Body>, next: Next) -> Response {
    match LIMITER.take(bucket, &key, limit) {
        Ok(()) => next.run(req).await,
        Err(retry) => too_many(retry),
    }
}

/// Per-IP: registration.
pub async fn rl_register(req: Request<Body>, next: Next) -> Response {
    let key = client_ip(req.headers());
    limited("register", LIMITER.limit("register"), key, req, next).await
}

/// Per-IP: login attempts, plus a tighter bucket that only failed attempts consume (see auth::login).
pub async fn rl_login(req: Request<Body>, next: Next) -> Response {
    let key = client_ip(req.headers());
    if let Err(retry) = LIMITER.peek("login_fail", &key, LIMITER.limit("login_fail")) {
        return too_many(retry);
    }
    limited("login", LIMITER.limit("login"), key, req, next).await
}

/// Per-user (falls back to IP when unauthenticated): message sends.
pub async fn rl_messages(req: Request<Body>, next: Next) -> Response {
    if req.method() != axum::http::Method::POST { return next.run(req).await }
    let key = user_key(req.headers(), &SECRET).unwrap_or_else(|| client_ip(req.headers()));
    limited("messages", LIMITER.limit("messages"), key, req, next).await
}

pub async fn rl_uploads(req: Request<Body>, next: Next) -> Response {
    if req.method() != axum::http::Method::POST { return next.run(req).await }
    let key = user_key(req.headers(), &SECRET).unwrap_or_else(|| client_ip(req.headers()));
    limited("uploads", LIMITER.limit("uploads"), key, req, next).await
}

pub async fn rl_gifs(req: Request<Body>, next: Next) -> Response {
    let key = user_key(req.headers(), &SECRET).unwrap_or_else(|| client_ip(req.headers()));
    limited("gifs", LIMITER.limit("gifs"), key, req, next).await
}

/// Per-user (or IP): emails we send on request (verification resend, password reset).
pub async fn rl_mail(req: Request<Body>, next: Next) -> Response {
    let key = user_key(req.headers(), &SECRET).unwrap_or_else(|| client_ip(req.headers()));
    limited("mail", LIMITER.limit("mail"), key, req, next).await
}

/// The token signing secret, resolved like `Config::jwt_secret` (so `JWT_SECRET_FILE` works too).
static SECRET: LazyLock<String> = LazyLock::new(|| {
    crate::config::env_or_file("JWT_SECRET").unwrap_or_else(|| "dev-insecure-secret-change-me".into())
});

pub async fn prune_loop() {
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(600)).await;
        LIMITER.prune();
    }
}
