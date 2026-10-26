//! Link previews: fetch a page's OpenGraph / Twitter / <title> metadata server-side, with SSRF protection
//! (public addresses only, manual redirects re-checked per hop, size and time limits) and a 24 h cache.

use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    ratelimit::rl_gifs,
    state::AppState,
};
use axum::{extract::{Query, State}, middleware::from_fn, routing::get, Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::net::{IpAddr, ToSocketAddrs};
use url::Url;

pub fn router() -> Router<AppState> {
    Router::new().route("/embeds", get(embed).route_layer(from_fn(rl_gifs)))
}

pub const MAX_BODY: usize = 512 * 1024;
const MAX_REDIRECTS: usize = 3;
const CACHE_OK_SECS: i64 = 24 * 3600;
const CACHE_NONE_SECS: i64 = 3600;

#[derive(Debug, Default, Serialize, Deserialize, Clone, PartialEq)]
pub struct Embed {
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub site_name: Option<String>,
    /// The page's theme colour (`<meta name="theme-color">`), drawn as the embed's edge.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// Show the picture large (Twitter's summary_large_image, or a wide og:image).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub large_image: bool,
    /// A playable video file (og:video), https only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub video: Option<String>,
}

#[derive(Deserialize)]
struct EmbedQuery {
    url: String,
}

/// Is this address one we must never fetch from a server (loopback, private, link-local, multicast, ...)?
pub fn is_forbidden_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback() || v4.is_private() || v4.is_link_local() || v4.is_multicast() || v4.is_broadcast() || v4.is_unspecified()
                || v4.octets()[0] == 0 || (v4.octets()[0] == 100 && (64..128).contains(&v4.octets()[1])) // CGNAT 100.64/10
                || (v4.octets()[0] == 192 && v4.octets()[1] == 0 && v4.octets()[2] == 0) // 192.0.0.0/24
                || v4.octets()[0] >= 240
        }
        IpAddr::V6(v6) => {
            if let Some(m) = v6.to_ipv4_mapped() { return is_forbidden_ip(IpAddr::V4(m)) }
            v6.is_loopback() || v6.is_unspecified() || v6.is_multicast()
                || (v6.segments()[0] & 0xfe00) == 0xfc00 // unique local fc00::/7
                || (v6.segments()[0] & 0xffc0) == 0xfe80 // link local
        }
    }
}

/// Validate a URL for fetching: http(s), a host that resolves only to public addresses (or is allow-listed).
pub fn check_url(raw: &str, allow_hosts: &[String]) -> Result<Url, String> {
    let u = Url::parse(raw.trim()).map_err(|_| "Invalid URL".to_string())?;
    if !matches!(u.scheme(), "http" | "https") {
        return Err("Only http and https links can be previewed".into());
    }
    if !u.username().is_empty() || u.password().is_some() {
        return Err("Links with credentials are not previewed".into());
    }
    let host = u.host_str().ok_or("Invalid URL")?.trim_end_matches('.').to_lowercase();
    if allow_hosts.iter().any(|h| *h == host) {
        return Ok(u);
    }
    if host == "localhost" || host.ends_with(".localhost") || host.ends_with(".local") || host.ends_with(".internal") {
        return Err("That address is not reachable from here".into());
    }
    let port = u.port_or_known_default().unwrap_or(80);
    let addrs = (host.as_str(), port).to_socket_addrs().map_err(|_| "Could not resolve that host".to_string())?;
    let mut any = false;
    for a in addrs {
        any = true;
        if is_forbidden_ip(a.ip()) {
            return Err("That address is not reachable from here".into());
        }
    }
    if !any {
        return Err("Could not resolve that host".into());
    }
    Ok(u)
}

fn decode_entities(s: &str) -> String {
    let mut out = s.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&#39;", "'").replace("&#x27;", "'").replace("&apos;", "'").replace("&nbsp;", " ");
    // numeric entities
    while let Some(i) = out.find("&#") {
        let rest = &out[i + 2..];
        let end = match rest.find(';') { Some(e) if e <= 8 => e, _ => break };
        let num = &rest[..end];
        let code = if let Some(h) = num.strip_prefix('x').or_else(|| num.strip_prefix('X')) { u32::from_str_radix(h, 16).ok() } else { num.parse::<u32>().ok() };
        match code.and_then(char::from_u32) {
            Some(c) => out.replace_range(i..i + 3 + end, &c.to_string()),
            None => break,
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Pull `<meta ... property|name="KEY" ... content="VALUE">` pairs (either attribute order) and `<title>`.
pub fn parse_meta(html: &str) -> std::collections::HashMap<String, String> {
    let mut out = std::collections::HashMap::new();
    let lower = html.to_lowercase();
    let mut pos = 0;
    while let Some(i) = lower[pos..].find("<meta") {
        let start = pos + i;
        let end = match lower[start..].find('>') { Some(e) => start + e, None => break };
        let tag = &html[start..end];
        let attr = |name: &str| -> Option<String> {
            let tl = tag.to_lowercase();
            let mut from = 0;
            while let Some(k) = tl[from..].find(name) {
                let at = from + k;
                let after = &tl[at + name.len()..];
                let trimmed = after.trim_start();
                if trimmed.starts_with('=') && (at == 0 || !tl.as_bytes()[at - 1].is_ascii_alphanumeric()) {
                    let rest = &tag[at + name.len() + (after.len() - trimmed.len()) + 1..].trim_start();
                    let (quote, body) = match rest.chars().next() { Some(q @ ('"' | '\'')) => (Some(q), &rest[1..]), _ => (None, *rest) };
                    let val = match quote { Some(q) => body.split(q).next().unwrap_or(""), None => body.split(|c: char| c.is_whitespace() || c == '>').next().unwrap_or("") };
                    return Some(decode_entities(val));
                }
                from = at + name.len();
            }
            None
        };
        if let Some(key) = attr("property").or_else(|| attr("name")) {
            if let Some(content) = attr("content") {
                out.entry(key.to_lowercase()).or_insert(content);
            }
        }
        pos = end;
    }
    if let Some(i) = lower.find("<title") {
        if let Some(gt) = lower[i..].find('>') {
            let s = i + gt + 1;
            if let Some(e) = lower[s..].find("</title>") {
                out.entry("title".into()).or_insert(decode_entities(&html[s..s + e]));
            }
        }
    }
    out
}

fn clip(s: Option<String>, n: usize) -> Option<String> {
    s.map(|v| v.chars().take(n).collect::<String>()).filter(|v| !v.is_empty())
}

pub fn embed_from_html(url: &Url, html: &str) -> Option<Embed> {
    let m = parse_meta(html);
    let pick = |keys: &[&str]| keys.iter().find_map(|k| m.get(*k).cloned());
    let title = clip(pick(&["og:title", "twitter:title", "title"]), 200);
    let description = clip(pick(&["og:description", "twitter:description", "description"]), 400);
    let image = pick(&["og:image", "og:image:url", "twitter:image", "twitter:image:src"])
        .and_then(|i| url.join(&i).ok())
        .filter(|i| matches!(i.scheme(), "http" | "https"))
        .map(|i| i.to_string());
    let site_name = clip(pick(&["og:site_name"]), 100).or_else(|| url.host_str().map(|h| h.to_string()));
    if title.is_none() && description.is_none() && image.is_none() {
        return None;
    }
    let color = pick(&["theme-color"]).map(|c| c.trim().to_string()).filter(|c| c.len() <= 9 && c.starts_with('#') && c[1..].chars().all(|x| x.is_ascii_hexdigit()));
    let wide = pick(&["og:image:width"]).and_then(|w| w.parse::<u32>().ok()).map(|w| w >= 600).unwrap_or(false);
    let large_image = image.is_some() && (pick(&["twitter:card"]).as_deref() == Some("summary_large_image") || wide);
    let video = pick(&["og:video:secure_url", "og:video:url", "og:video"])
        .and_then(|v| url.join(&v).ok())
        .filter(|v| v.scheme() == "https" && pick(&["og:video:type"]).map(|t| t.starts_with("video/")).unwrap_or(true))
        .map(|v| v.to_string());
    Some(Embed { url: url.to_string(), title, description, image, site_name, color, large_image, video })
}

/// Fetch with manual redirects (each hop re-validated) and a body cap. Returns None for non-HTML or on failure.
async fn fetch(state: &AppState, mut url: Url) -> Option<Embed> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(6))
        .user_agent("Mozilla/5.0 (compatible; ParleyBot/1.0; +https://github.com/vic10us/parley)")
        .build()
        .ok()?;
    for _ in 0..=MAX_REDIRECTS {
        let resp = client.get(url.clone()).header("Accept", "text/html,application/xhtml+xml").send().await.ok()?;
        if resp.status().is_redirection() {
            let loc = resp.headers().get("location")?.to_str().ok()?;
            let next = url.join(loc).ok()?;
            url = check_url(next.as_str(), &state.config.embed_allow_hosts).ok()?;
            continue;
        }
        if !resp.status().is_success() {
            return None;
        }
        let ct = resp.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("").to_lowercase();
        if !(ct.contains("text/html") || ct.contains("xhtml")) {
            return None;
        }
        let mut body: Vec<u8> = Vec::new();
        let mut stream = resp;
        while let Some(chunk) = stream.chunk().await.ok()? {
            body.extend_from_slice(&chunk);
            if body.len() >= MAX_BODY {
                body.truncate(MAX_BODY);
                break;
            }
        }
        let html = String::from_utf8_lossy(&body);
        return embed_from_html(&url, &html);
    }
    None
}

/// `GET /embeds?url=` -> the preview (cached 24 h) or `null` when the page has nothing to show (cached 1 h).
async fn embed(State(state): State<AppState>, AuthUser(_uid): AuthUser, Query(q): Query<EmbedQuery>) -> AppResult<Json<Value>> {
    let url = check_url(&q.url, &state.config.embed_allow_hosts).map_err(AppError::BadRequest)?;
    let key = url.to_string();
    let cached: Option<(String, Value, i64)> = sqlx::query_as("SELECT status, data, EXTRACT(EPOCH FROM now() - fetched_at)::bigint FROM link_embeds WHERE url = $1")
        .bind(&key)
        .fetch_optional(&state.db)
        .await?;
    if let Some((status, data, age)) = cached {
        let ttl = if status == "ok" { CACHE_OK_SECS } else { CACHE_NONE_SECS };
        if age < ttl {
            return Ok(Json(if status == "ok" { data } else { Value::Null }));
        }
    }
    let result = fetch(&state, url).await;
    let (status, data) = match &result { Some(e) => ("ok", json!(e)), None => ("none", json!({})) };
    sqlx::query("INSERT INTO link_embeds (url, status, data, fetched_at) VALUES ($1, $2, $3, now()) ON CONFLICT (url) DO UPDATE SET status = EXCLUDED.status, data = EXCLUDED.data, fetched_at = now()")
        .bind(&key).bind(status).bind(&data)
        .execute(&state.db)
        .await?;
    Ok(Json(result.map(|e| json!(e)).unwrap_or(Value::Null)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn forbidden_ips() {
        for ip in ["127.0.0.1", "10.1.2.3", "172.16.5.5", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1"] {
            assert!(is_forbidden_ip(ip.parse().unwrap()), "{ip} should be forbidden");
        }
        for ip in ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "93.184.216.34"] {
            assert!(!is_forbidden_ip(ip.parse().unwrap()), "{ip} should be allowed");
        }
    }

    #[test]
    fn url_checks() {
        assert!(check_url("ftp://example.com/x", &[]).is_err());
        assert!(check_url("http://user:pw@example.com/", &[]).is_err());
        assert!(check_url("http://localhost/", &[]).is_err());
        assert!(check_url("http://127.0.0.1:8080/health", &[]).is_err());
        assert!(check_url("http://[::1]/", &[]).is_err());
        assert!(check_url("not a url", &[]).is_err());
        assert!(check_url("http://127.0.0.1:8080/health", &["127.0.0.1".into()]).is_ok(), "allow-list wins");
    }

    #[test]
    fn rich_fields() {
        let url = Url::parse("https://example.com/post").unwrap();
        let html = r##"<meta property="og:title" content="Clip"><meta name="theme-color" content="#ff6600">
            <meta name="twitter:card" content="summary_large_image"><meta property="og:image" content="/big.jpg">
            <meta property="og:video:secure_url" content="https://cdn.example.com/v.mp4"><meta property="og:video:type" content="video/mp4">"##;
        let e = embed_from_html(&url, html).unwrap();
        assert_eq!(e.color.as_deref(), Some("#ff6600"));
        assert!(e.large_image);
        assert_eq!(e.video.as_deref(), Some("https://cdn.example.com/v.mp4"));
        let plain = embed_from_html(&url, r#"<meta property="og:title" content="x"><meta name="theme-color" content="red; background:url(x)"><meta property="og:video" content="http://insecure/v.mp4">"#).unwrap();
        assert!(plain.color.is_none() && !plain.large_image && plain.video.is_none(), "bad colours and http videos are dropped");
    }

    #[test]
    fn meta_parsing() {
        let html = r#"<html><head><title>Fallback &amp; title</title>
            <meta property="og:title" content="Hello &quot;World&quot;" />
            <META content='A description' name="description">
            <meta name="twitter:image" content="/img/x.png">
            <meta property="og:site_name" content="Example &#169; Site"></head><body><meta property="og:description" content="later wins? no"></body></html>"#;
        let u = Url::parse("https://example.com/page").unwrap();
        let e = embed_from_html(&u, html).unwrap();
        assert_eq!(e.title.as_deref(), Some("Hello \"World\""));
        assert_eq!(e.description.as_deref(), Some("later wins? no"), "og:description beats name=description");
        assert_eq!(e.image.as_deref(), Some("https://example.com/img/x.png"), "relative images resolve against the page");
        assert_eq!(e.site_name.as_deref(), Some("Example © Site"));
        assert!(embed_from_html(&u, "<html><body>nothing here</body></html>").is_none());
        let only_title = embed_from_html(&u, "<title>Just a title</title>").unwrap();
        assert_eq!(only_title.site_name.as_deref(), Some("example.com"));
    }
}
