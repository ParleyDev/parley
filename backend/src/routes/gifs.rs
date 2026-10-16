//! GIF picker backend: proxies Tenor (or GIPHY) so the API key never reaches the browser and
//! results come back in one normalised shape. Configure `TENOR_API_KEY` or `GIPHY_API_KEY`.

use crate::{auth::AuthUser, error::{AppError, AppResult}, state::AppState};
use axum::{extract::{Query, State}, middleware::from_fn, routing::get, Json, Router};
use crate::ratelimit::rl_gifs;
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/gifs/search", get(search))
        .route("/gifs/trending", get(trending))
        .route("/gifs/categories", get(categories))
        .route_layer(from_fn(rl_gifs))
}

#[derive(Serialize)]
pub struct Gif {
    pub id: String,
    pub title: String,
    /// Full-size GIF to send.
    pub url: String,
    /// Smaller version for the picker grid.
    pub preview: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Serialize)]
pub struct GifPage {
    pub results: Vec<Gif>,
    pub next: Option<String>,
    pub provider: &'static str,
}

#[derive(Serialize)]
pub struct Category {
    pub name: String,
    pub image: String,
}

#[derive(Deserialize)]
pub struct GifQuery {
    #[serde(default)]
    q: String,
    pos: Option<String>,
    #[serde(default = "default_limit")]
    limit: u32,
}

fn default_limit() -> u32 {
    30
}

enum Provider<'a> {
    Tenor(&'a str),
    Giphy(&'a str),
}

fn provider(state: &AppState) -> AppResult<Provider<'_>> {
    if let Some(k) = state.config.tenor_api_key.as_deref().filter(|k| !k.is_empty()) {
        return Ok(Provider::Tenor(k));
    }
    if let Some(k) = state.config.giphy_api_key.as_deref().filter(|k| !k.is_empty()) {
        return Ok(Provider::Giphy(k));
    }
    Err(AppError::BadRequest("GIF search is not configured. Set TENOR_API_KEY or GIPHY_API_KEY on the backend.".into()))
}

async fn fetch_json(url: &str) -> AppResult<Value> {
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(10)).build().map_err(|e| AppError::Other(e.into()))?;
    let resp = client.get(url).send().await.map_err(|e| AppError::Other(anyhow::anyhow!("GIF provider unreachable: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::BadRequest(format!("GIF provider returned {}", resp.status())));
    }
    resp.json().await.map_err(|e| AppError::Other(anyhow::anyhow!("GIF provider sent bad JSON: {e}")))
}

fn s(v: &Value) -> String {
    v.as_str().unwrap_or("").to_string()
}

fn tenor_gifs(v: &Value) -> GifPage {
    let results = v["results"].as_array().map(|arr| {
        arr.iter().filter_map(|r| {
            let f = &r["media_formats"];
            let full = &f["gif"];
            let small = if f["tinygif"].is_object() { &f["tinygif"] } else { full };
            let url = s(&full["url"]);
            if url.is_empty() { return None; }
            let dims = full["dims"].as_array();
            Some(Gif {
                id: s(&r["id"]),
                title: s(&r["content_description"]),
                url,
                preview: s(&small["url"]),
                width: dims.and_then(|d| d.first()).and_then(Value::as_u64).unwrap_or(0) as u32,
                height: dims.and_then(|d| d.get(1)).and_then(Value::as_u64).unwrap_or(0) as u32,
            })
        }).collect()
    }).unwrap_or_default();
    let next = v["next"].as_str().filter(|n| !n.is_empty()).map(String::from);
    GifPage { results, next, provider: "tenor" }
}

fn giphy_gifs(v: &Value, offset: u64) -> GifPage {
    let results: Vec<Gif> = v["data"].as_array().map(|arr| {
        arr.iter().filter_map(|r| {
            let imgs = &r["images"];
            let full = &imgs["original"];
            let small = if imgs["fixed_width"].is_object() { &imgs["fixed_width"] } else { full };
            let url = s(&full["url"]);
            if url.is_empty() { return None; }
            let num = |x: &Value| x.as_str().and_then(|n| n.parse::<u32>().ok()).or_else(|| x.as_u64().map(|n| n as u32)).unwrap_or(0);
            Some(Gif { id: s(&r["id"]), title: s(&r["title"]), url, preview: s(&small["url"]), width: num(&full["width"]), height: num(&full["height"]) })
        }).collect()
    }).unwrap_or_default();
    let total = v["pagination"]["total_count"].as_u64().unwrap_or(0);
    let got = results.len() as u64;
    let next = if got > 0 && offset + got < total { Some((offset + got).to_string()) } else { None };
    GifPage { results, next, provider: "giphy" }
}

async fn search(State(state): State<AppState>, AuthUser(_): AuthUser, Query(q): Query<GifQuery>) -> AppResult<Json<GifPage>> {
    let limit = q.limit.clamp(1, 50);
    let term = q.q.trim();
    if term.is_empty() {
        return trending(State(state), AuthUser(uuid::Uuid::nil()), Query(q)).await;
    }
    let enc = urlencoding(term);
    match provider(&state)? {
        Provider::Tenor(key) => {
            let pos = q.pos.as_deref().map(|p| format!("&pos={}", urlencoding(p))).unwrap_or_default();
            let v = fetch_json(&format!("https://tenor.googleapis.com/v2/search?key={key}&client_key=parley&q={enc}&limit={limit}&media_filter=gif,tinygif&contentfilter=medium{pos}")).await?;
            Ok(Json(tenor_gifs(&v)))
        }
        Provider::Giphy(key) => {
            let offset: u64 = q.pos.as_deref().and_then(|p| p.parse().ok()).unwrap_or(0);
            let v = fetch_json(&format!("https://api.giphy.com/v1/gifs/search?api_key={key}&q={enc}&limit={limit}&offset={offset}&rating=pg-13")).await?;
            Ok(Json(giphy_gifs(&v, offset)))
        }
    }
}

async fn trending(State(state): State<AppState>, AuthUser(_): AuthUser, Query(q): Query<GifQuery>) -> AppResult<Json<GifPage>> {
    let limit = q.limit.clamp(1, 50);
    match provider(&state)? {
        Provider::Tenor(key) => {
            let pos = q.pos.as_deref().map(|p| format!("&pos={}", urlencoding(p))).unwrap_or_default();
            let v = fetch_json(&format!("https://tenor.googleapis.com/v2/featured?key={key}&client_key=parley&limit={limit}&media_filter=gif,tinygif&contentfilter=medium{pos}")).await?;
            Ok(Json(tenor_gifs(&v)))
        }
        Provider::Giphy(key) => {
            let offset: u64 = q.pos.as_deref().and_then(|p| p.parse().ok()).unwrap_or(0);
            let v = fetch_json(&format!("https://api.giphy.com/v1/gifs/trending?api_key={key}&limit={limit}&offset={offset}&rating=pg-13")).await?;
            Ok(Json(giphy_gifs(&v, offset)))
        }
    }
}

async fn categories(State(state): State<AppState>, AuthUser(_): AuthUser) -> AppResult<Json<Vec<Category>>> {
    match provider(&state)? {
        Provider::Tenor(key) => {
            let v = fetch_json(&format!("https://tenor.googleapis.com/v2/categories?key={key}&client_key=parley&contentfilter=medium")).await?;
            let cats = v["tags"].as_array().map(|arr| {
                arr.iter().filter_map(|t| {
                    let name = s(&t["searchterm"]);
                    let image = s(&t["image"]);
                    if name.is_empty() || image.is_empty() { None } else { Some(Category { name, image }) }
                }).collect()
            }).unwrap_or_default();
            Ok(Json(cats))
        }
        Provider::Giphy(key) => {
            let v = fetch_json(&format!("https://api.giphy.com/v1/gifs/categories?api_key={key}")).await?;
            let cats = v["data"].as_array().map(|arr| {
                arr.iter().filter_map(|t| {
                    let name = s(&t["name"]);
                    let image = s(&t["gif"]["images"]["fixed_width"]["url"]);
                    if name.is_empty() || image.is_empty() { None } else { Some(Category { name, image }) }
                }).collect()
            }).unwrap_or_default();
            Ok(Json(cats))
        }
    }
}

fn urlencoding(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}
