//! Discover → Profile Style: one catalogue of every assets-folder cosmetic for browsing, with what a shop sync script
//! (or Profile Studio) adds to each kind's `metadata.json`: colours, themes, a collection, a design's variants
//! (`base_name` + `variant_label`), its bundles and tags, plus the theme labels (`tag_labels`). Every field is optional
//! and read leniently: a value of the wrong type is skipped. Prices and availability are ignored; nothing here is
//! for sale.
//!
//! Bundles are cross-kind sets. They come from `bundles.json` at the assets root, with `bundles.local.json` (Profile
//! Studio's edits) laid over it: an entry whose id is in `bundles.json` overrides its fields (`items` replaces the
//! whole list) or hides it (`deleted: true`); any other id is a bundle of its own. An item reference is
//! `{shop_item_id, type}` or `{type, key}` (key: the file or folder name). A bundle neither file defines takes its
//! members from the items' own `bundles` lists. Parley only reads these two files, never writes them.

use axum::{extract::State, routing::{get, patch}, Json, Router};
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::{
    collections::{HashMap, HashSet},
    path::Path as FsPath,
    sync::{Arc, LazyLock, RwLock},
    time::{Duration, Instant},
};

use crate::{auth::AuthUser, error::{AppError, AppResult}, routes::{asset_layers, assets, cosmetics}, state::AppState};

pub fn router() -> Router<AppState> {
    Router::new().route("/cosmetics/explore", get(explore)).route("/users/@me/cosmetics", patch(wear))
}

/// An item's browse fields, from its `metadata.json` entry.
#[derive(Debug, Clone, Default, Serialize, PartialEq)]
pub struct Facets {
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub colors: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub themes: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub collection_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub variant_label: Option<String>,
    #[serde(skip)]
    pub shop_item_id: Option<String>,
    /// The entry's own `[{id, name}]`: only used for bundles neither bundles file defines.
    #[serde(skip)]
    pub bundles: Vec<(String, String)>,
}

/// "Cute & Cozy" → `cute_cozy`, "Sci-Fi" → `sci_fi`: lower case, each run of anything else one `_`.
pub fn code(label: &str) -> String {
    let mut out = String::new();
    for c in label.trim().to_lowercase().chars() {
        if c.is_alphanumeric() { out.push(c) } else if !out.is_empty() && !out.ends_with('_') { out.push('_') }
    }
    out.trim_end_matches('_').chars().take(40).collect()
}

/// A string, or a number written as one (ids), trimmed and non-empty.
fn id_of(v: &Value) -> Option<String> {
    let s = match v { Value::String(s) => s.trim().to_string(), Value::Number(n) => n.to_string(), _ => return None };
    (!s.is_empty() && s.len() <= 120).then_some(s)
}
fn text_of(v: &Value, max: usize) -> Option<String> {
    v.as_str().map(|s| s.trim().chars().take(max).collect::<String>()).filter(|s| !s.is_empty())
}
fn codes(v: &Value) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for c in v.as_array().map(Vec::as_slice).unwrap_or_default().iter().filter_map(Value::as_str).map(code) {
        if !c.is_empty() && !out.contains(&c) && out.len() < 20 { out.push(c) }
    }
    out
}

impl Facets {
    pub fn of(entry: &Value) -> Facets {
        Facets {
            colors: codes(&entry["colors"]),
            themes: codes(&entry["themes"]),
            collection_id: id_of(&entry["collection_id"]),
            base_name: text_of(&entry["base_name"], 80),
            variant_label: text_of(&entry["variant_label"], 80),
            shop_item_id: id_of(&entry["shop_item_id"]),
            bundles: entry["bundles"].as_array().map(Vec::as_slice).unwrap_or_default().iter()
                .filter_map(|b| { let id = id_of(&b["id"])?; Some((id.clone(), text_of(&b["name"], 80).unwrap_or(id))) }).collect(),
        }
    }
}

const KINDS: [(&str, &str, &str); 4] = [
    ("decoration", assets::DECORATIONS_DIR, "avatar_decoration"),
    ("nameplate", assets::NAMEPLATES_DIR, "nameplate"),
    ("effect", asset_layers::EFFECTS_DIR, "profile_effect"),
    ("frame", asset_layers::FRAMES_DIR, "profile_frame"),
];

#[derive(Debug, Clone, Serialize)]
pub struct Item {
    pub kind: &'static str,
    /// What a profile stores: `asset:<id>`.
    pub value: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    #[serde(flatten)]
    pub facets: Facets,
    /// The bundles it is in (ids), after the bundles files have had their say.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub bundles: Vec<String>,
    /// Effects: the picture for a card (its thumbnail, else its still).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumb: Option<String>,
    /// 1 = worn by the most people; none when nobody wears it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rank: Option<usize>,
    pub added: u64,
    /// Its file (decorations, nameplates) or folder (effects, frames) in the assets folder.
    #[serde(skip)]
    pub key: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct BundleItem { pub kind: &'static str, pub value: String }

#[derive(Debug, Clone, Serialize)]
pub struct Bundle {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub collection_id: Option<String>,
    pub items: Vec<BundleItem>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Collection { pub id: String, pub name: String, pub count: usize }

#[derive(Debug, Default, Clone, Serialize)]
pub struct Catalog {
    pub items: Vec<Item>,
    /// Colour and theme codes to their labels, from each kind's `tag_labels`.
    pub labels: HashMap<String, String>,
    pub collections: Vec<Collection>,
    pub bundles: Vec<Bundle>,
}

fn read_json(path: &FsPath) -> Value {
    let Ok(text) = std::fs::read_to_string(path) else { return Value::Null };
    serde_json::from_str(&text).unwrap_or_else(|_| { tracing::warn!(path = %path.display(), "not valid JSON; ignored"); Value::Null })
}

fn kind_of_type(t: &str) -> Option<&'static str> {
    KINDS.iter().find(|k| k.2 == t || k.0 == t).map(|k| k.0)
}

/// The bundles as both files define them, in order: `bundles.json`'s, then the local file's own. Also every id either
/// file defines (hidden ones included), so an item's own list can't bring those back.
pub fn effective_bundles(base: &Value, local: &Value) -> (Vec<Map<String, Value>>, HashSet<String>) {
    let entries = |v: &Value| -> Vec<(String, Map<String, Value>)> {
        v["bundles"].as_array().map(Vec::as_slice).unwrap_or_default().iter()
            .filter_map(|b| { let m = b.as_object()?; Some((id_of(&b["id"])?, m.clone())) }).collect()
    };
    let mut list = entries(base);
    let mut defined: HashSet<String> = list.iter().map(|(id, _)| id.clone()).collect();
    let mut hidden: HashSet<String> = HashSet::new();
    for (id, over) in entries(local) {
        defined.insert(id.clone());
        let deleted = over.get("deleted").and_then(Value::as_bool) == Some(true);
        match list.iter_mut().find(|(i, _)| *i == id) {
            Some(_) if deleted => { hidden.insert(id); }
            Some((_, b)) => { for (k, v) in over { if k != "id" { b.insert(k, v); } } }
            None if deleted => {}
            None => list.push((id, over)),
        }
    }
    (list.into_iter().filter(|(id, _)| !hidden.contains(id)).map(|(_, b)| b).collect(), defined)
}

/// Build the catalogue from the folder's indexes and files (everything but what's off, and how popular each is).
pub fn build(root: &FsPath, mut items: Vec<Item>) -> Catalog {
    let mut labels = HashMap::new();
    for (_, dir, _) in KINDS {
        let meta = read_json(&root.join(dir).join("metadata.json"));
        for l in meta["tag_labels"].as_array().map(Vec::as_slice).unwrap_or_default().iter().filter_map(Value::as_str) {
            let c = code(l);
            if !c.is_empty() { labels.entry(c).or_insert_with(|| l.trim().to_string()); }
        }
        // `collections: {id: {items: [file or folder]}}` fills in items that don't name theirs.
        if let Some(cols) = meta["collections"].as_object() {
            let kind = KINDS.iter().find(|k| k.1 == dir).map(|k| k.0).unwrap_or_default();
            for (cid, c) in cols {
                for key in c["items"].as_array().map(Vec::as_slice).unwrap_or_default().iter().filter_map(Value::as_str) {
                    if let Some(it) = items.iter_mut().find(|i| i.kind == kind && i.key == key && i.facets.collection_id.is_none()) {
                        it.facets.collection_id = Some(cid.clone());
                    }
                }
            }
        }
    }

    // Bundles: resolve each member to an item here; one that isn't here is left out.
    let (defined, defined_ids) = effective_bundles(&read_json(&root.join("bundles.json")), &read_json(&root.join("bundles.local.json")));
    let by_shop: HashMap<(&str, &str), usize> = items.iter().enumerate().filter_map(|(i, it)| Some(((it.kind, it.facets.shop_item_id.as_deref()?), i))).collect();
    let by_shop_any: HashMap<&str, usize> = items.iter().enumerate().filter_map(|(i, it)| Some((it.facets.shop_item_id.as_deref()?, i))).collect();
    let by_key: HashMap<(&str, &str), usize> = items.iter().enumerate().map(|(i, it)| ((it.kind, it.key.as_str()), i)).collect();
    let mut bundles: Vec<(Bundle, Vec<usize>)> = Vec::new();
    for b in &defined {
        let id = id_of(&b["id"]).unwrap_or_default();
        let mut members: Vec<usize> = Vec::new();
        for r in b.get("items").and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default() {
            let kind = r["type"].as_str().and_then(kind_of_type);
            let hit = match (id_of(&r["shop_item_id"]), text_of(&r["key"], 200)) {
                (Some(s), _) => match kind { Some(k) => by_shop.get(&(k, s.as_str())), None => by_shop_any.get(s.as_str()) }.copied(),
                (None, Some(key)) => kind.and_then(|k| by_key.get(&(k, key.as_str())).copied()),
                _ => None,
            };
            if let Some(i) = hit { if !members.contains(&i) { members.push(i) } }
        }
        let name = b.get("name").and_then(|n| text_of(n, 80)).unwrap_or_else(|| id.clone());
        bundles.push((Bundle { id, name, collection_id: b.get("collection_id").and_then(id_of), items: vec![] }, members));
    }
    // Bundles only the items know about.
    for (i, it) in items.iter().enumerate() {
        for (bid, bname) in &it.facets.bundles {
            if defined_ids.contains(bid) { continue }
            match bundles.iter_mut().find(|(b, _)| b.id == *bid) {
                Some((_, m)) => { if !m.contains(&i) { m.push(i) } }
                None => bundles.push((Bundle { id: bid.clone(), name: bname.clone(), collection_id: it.facets.collection_id.clone(), items: vec![] }, vec![i])),
            }
        }
    }
    for it in items.iter_mut() { it.bundles.clear() }
    let mut out_bundles = Vec::new();
    for (mut b, members) in bundles {
        if members.is_empty() { continue }
        for &i in &members { items[i].bundles.push(b.id.clone()); }
        b.items = members.iter().map(|&i| BundleItem { kind: items[i].kind, value: items[i].value.clone() }).collect();
        out_bundles.push(b);
    }

    // Collections, named after their bundle, else their most common design, else their id.
    let mut counts: Vec<(String, usize)> = Vec::new();
    for it in &items {
        if let Some(c) = &it.facets.collection_id {
            match counts.iter_mut().find(|(id, _)| id == c) { Some((_, n)) => *n += 1, None => counts.push((c.clone(), 1)) }
        }
    }
    let collections = counts.into_iter().map(|(id, count)| {
        let name = out_bundles.iter().find(|b| b.collection_id.as_deref() == Some(id.as_str())).map(|b| b.name.clone()).or_else(|| {
            let mut names: Vec<(&str, usize)> = Vec::new();
            for it in items.iter().filter(|i| i.facets.collection_id.as_deref() == Some(id.as_str())) {
                let n = it.facets.base_name.as_deref().unwrap_or(&it.name);
                match names.iter_mut().find(|(x, _)| *x == n) { Some((_, c)) => *c += 1, None => names.push((n, 1)) }
            }
            names.into_iter().max_by_key(|(_, c)| *c).map(|(n, _)| n.to_string())
        }).unwrap_or_else(|| assets::display_name(&id));
        Collection { id, name, count }
    }).collect();
    Catalog { items, labels, collections, bundles: out_bundles }
}

static CACHE: LazyLock<RwLock<Option<(Instant, Arc<Catalog>)>>> = LazyLock::new(|| RwLock::new(None));
const KEEP: Duration = Duration::from_secs(30);

/// Rebuild on the next look (after the admin console wrote to the folder).
pub fn forget() { *CACHE.write().unwrap() = None; }

async fn catalog(state: &AppState) -> Arc<Catalog> {
    if let Some((at, c)) = CACHE.read().unwrap().as_ref() { if at.elapsed() < KEEP { return c.clone() } }
    let c = &state.config;
    let (decos, plates, effects, frames) = (assets::decorations(c).await, assets::nameplates(c).await, asset_layers::effects(c).await, asset_layers::frames(c).await);
    let p = assets::ASSET_PREFIX;
    let mut items = Vec::new();
    for (kind, list) in [("decoration", &decos.list), ("nameplate", &plates.list)] {
        for d in list.iter() {
            items.push(Item { kind, value: format!("{p}{}", d.id), name: d.name.clone(), description: d.description.clone(), tags: d.tags.clone(), facets: d.facets.clone(), bundles: vec![], thumb: None, rank: None, added: d.added, key: d.file_name() });
        }
    }
    for (kind, list) in [("effect", &effects.list), ("frame", &frames.list)] {
        for d in list.iter() {
            items.push(Item { kind, value: format!("{p}{}", d.id), name: d.name.clone(), description: Some(d.description.clone()).filter(|s| !s.is_empty()), tags: d.tags.clone(), facets: d.facets.clone(), bundles: vec![], thumb: d.thumbnail.clone().or_else(|| d.still.clone()), rank: None, added: d.added, key: d.folder_name() });
        }
    }
    let root = c.assets_dir.clone();
    let built = Arc::new(tokio::task::spawn_blocking(move || build(&root, items)).await.unwrap_or_default());
    *CACHE.write().unwrap() = Some((Instant::now(), built.clone()));
    built
}

/// `GET /cosmetics/explore`: everything people can wear from the assets folder, for browsing.
async fn explore(State(state): State<AppState>, AuthUser(_uid): AuthUser) -> AppResult<Json<Value>> {
    let cat = catalog(&state).await;
    // Popular: how many people wear each, ranked (the counts themselves stay private).
    let mut rank: HashMap<(String, String), usize> = HashMap::new();
    for (kind, col) in [("decoration", "avatar_decoration"), ("nameplate", "nameplate"), ("effect", "profile_effect"), ("frame", "profile_frame")] {
        let rows: Vec<(String, i64)> = sqlx::query_as(&format!("SELECT {col}, COUNT(*) FROM users WHERE {col} LIKE 'asset:%' GROUP BY 1 ORDER BY 2 DESC, 1"))
            .fetch_all(&state.db).await?;
        for (i, (v, _)) in rows.into_iter().enumerate() { rank.insert((kind.to_string(), v), i + 1); }
    }
    let on = |kind: &str, value: &str| !cosmetics::is_off(kind, value);
    let items: Vec<Item> = cat.items.iter().filter(|i| on(i.kind, &i.value)).map(|i| {
        let mut i = i.clone();
        i.rank = rank.get(&(i.kind.to_string(), i.value.clone())).copied();
        i
    }).collect();
    let bundles: Vec<Bundle> = cat.bundles.iter().filter_map(|b| {
        let items: Vec<BundleItem> = b.items.iter().filter(|x| on(x.kind, &x.value)).cloned().collect();
        (!items.is_empty()).then(|| Bundle { items, ..b.clone() })
    }).collect();
    let mut collections = Vec::new();
    for c in &cat.collections {
        let count = items.iter().filter(|i| i.facets.collection_id.as_deref() == Some(c.id.as_str())).count();
        if count > 0 { collections.push(Collection { count, ..c.clone() }) }
    }
    let shown: HashSet<&str> = bundles.iter().map(|b| b.id.as_str()).collect();
    let items: Vec<Item> = items.into_iter().map(|mut i| { i.bundles.retain(|b| shown.contains(b.as_str())); i }).collect();
    Ok(Json(json!({ "items": items, "labels": cat.labels, "collections": collections, "bundles": bundles })))
}

/// The four fields that hold what someone wears, with each one's kind.
pub const WORN: [(&str, &str); 4] = [("avatar_decoration", "decoration"), ("nameplate", "nameplate"), ("profile_effect", "effect"), ("profile_frame", "frame")];

/// `PATCH /users/@me/cosmetics {avatar_decoration?, nameplate?, profile_effect?, profile_frame?}`: wear or take off
/// ('' clears) only these, as Discover's Wear buttons and assistants (MCP `mcp.profile`) do. Each value is checked like
/// the profile editor's: one that exists and isn't turned off.
async fn wear(State(state): State<AppState>, AuthUser(uid): AuthUser, Json(body): Json<Value>) -> AppResult<Json<Value>> {
    let body = body.as_object().ok_or_else(|| AppError::BadRequest("Send an object".into()))?;
    if let Some(k) = body.keys().find(|k| !WORN.iter().any(|(f, _)| f == k)) { return Err(AppError::BadRequest(format!("{k} can't be changed here"))) }
    let mut set: Vec<(&str, String)> = Vec::new();
    for (field, kind) in WORN {
        let Some(v) = body.get(field) else { continue };
        let v = v.as_str().ok_or_else(|| AppError::BadRequest(format!("{field} must be text")))?.trim().to_string();
        if !cosmetics::allowed(&state, kind, &v).await { return Err(AppError::BadRequest(format!("Unknown {}", field.replace('_', " ")))) }
        set.push((field, v));
    }
    if set.is_empty() { return Err(AppError::BadRequest("Nothing to change".into())) }
    let get = |f: &str| set.iter().find(|(k, _)| *k == f).map(|(_, v)| v.clone());
    sqlx::query("UPDATE users SET avatar_decoration = COALESCE($2, avatar_decoration), nameplate = COALESCE($3, nameplate), profile_effect = COALESCE($4, profile_effect), profile_frame = COALESCE($5, profile_frame) WHERE id = $1")
        .bind(uid).bind(get("avatar_decoration")).bind(get("nameplate")).bind(get("profile_effect")).bind(get("profile_frame")).execute(&state.db).await?;
    let u = sqlx::query_as::<_, crate::models::User>(&format!("SELECT {} FROM users WHERE id = $1", crate::routes::users::USER_COLS)).bind(uid).fetch_one(&state.db).await?;
    let out = json!(u);
    state.hub.emit_all("USER_UPDATE", out.clone());
    Ok(Json(json!({ "avatar_decoration": out["avatar_decoration"], "nameplate": out["nameplate"], "profile_effect": out["profile_effect"], "profile_frame": out["profile_frame"] })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_from_labels() {
        assert_eq!(code("Cute & Cozy"), "cute_cozy");
        assert_eq!(code("Sci-Fi"), "sci_fi");
        assert_eq!(code("Movies & TV"), "movies_tv");
        assert_eq!(code(" Purple "), "purple");
    }

    #[test]
    fn facets_are_read_leniently() {
        let f = Facets::of(&json!({ "colors": ["Blue", 3, "blue", "white"], "themes": "anime", "collection_id": 42, "base_name": "Crystals", "variant_label": ["x"],
            "shop_item_id": 1234, "bundles": [{ "id": "b1", "name": "Night" }, { "name": "no id" }, "junk"], "description": null }));
        assert_eq!(f.colors, ["blue", "white"]);
        assert!(f.themes.is_empty());
        assert_eq!(f.collection_id.as_deref(), Some("42"));
        assert_eq!(f.base_name.as_deref(), Some("Crystals"));
        assert_eq!(f.variant_label, None);
        assert_eq!(f.shop_item_id.as_deref(), Some("1234"));
        assert_eq!(f.bundles, [("b1".to_string(), "Night".to_string())]);
        assert_eq!(Facets::of(&Value::Null), Facets::default());
    }

    fn item(kind: &'static str, key: &str, entry: Value) -> Item {
        let id = assets::asset_id(key.rsplit_once('.').map(|(s, _)| s).unwrap_or(key));
        Item { kind, value: format!("asset:{id}"), name: entry["name"].as_str().unwrap_or(key).to_string(), description: None, tags: vec![], facets: Facets::of(&entry), bundles: vec![], thumb: None, rank: None, added: 0, key: key.to_string() }
    }

    /// Profile Studio's fixtures: bundles.json, bundles.local.json over it, and the items they name.
    #[test]
    fn bundles_with_the_local_overlay() {
        let root = std::env::temp_dir().join(format!("parley-explore-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("avatar-decorations")).unwrap();
        std::fs::write(root.join("bundles.json"), json!({ "source": "test", "bundle_count": 3, "bundles": [
            { "id": "b1", "name": "Night Bundle", "price": { "amount": 10.99 }, "owned": false, "collection_id": "c1", "items": [
                { "shop_item_id": "11", "name": "Moon", "type": "avatar_decoration" }, { "shop_item_id": "21", "name": "Night Sky", "type": "nameplate" },
                { "shop_item_id": "99", "name": "Missing Frame", "type": "profile_frame" }] },
            { "id": "b2", "name": "Day Bundle", "collection_id": "c2", "items": [{ "shop_item_id": "12", "type": "avatar_decoration" }] },
            { "id": "b3", "name": "Untouched", "collection_id": "c3", "items": [{ "shop_item_id": "31", "type": "profile_effect" }] },
        ] }).to_string()).unwrap();
        std::fs::write(root.join("bundles.local.json"), json!({ "bundles": [
            { "id": "b1", "name": "Night Pack", "items": [
                { "shop_item_id": "11", "type": "avatar_decoration" }, { "shop_item_id": "12", "type": "avatar_decoration" },
                { "type": "avatar_decoration", "key": "homemade_halo.png", "name": "Homemade Halo" }] },
            { "id": "b2", "deleted": true },
            { "id": "local-mwsgs60r", "name": "Starter Set", "items": [{ "shop_item_id": "21", "type": "nameplate" }, { "type": "profile_frame", "key": "vines" }] },
        ] }).to_string()).unwrap();
        std::fs::write(root.join("avatar-decorations").join("metadata.json"), json!({ "tag_labels": ["Blue", "White", "Cute & Cozy", "Sci-Fi", "Fantasy"],
            "collections": { "c1": { "items": ["moon.png"] }, "c2": { "items": ["star.png", "homemade_halo.png"] } }, "items": [] }).to_string()).unwrap();
        let items = vec![
            item("decoration", "moon.png", json!({ "name": "Moon", "shop_item_id": "11", "collection_id": "c1", "base_name": "Moon", "variant_label": "Blue", "bundles": [{ "id": "b1", "name": "Night Bundle" }] })),
            item("decoration", "star.png", json!({ "name": "Star", "shop_item_id": "12", "collection_id": "c2", "bundles": [{ "id": "b2", "name": "Day Bundle" }, { "id": "b9", "name": "Only Here" }] })),
            item("decoration", "homemade_halo.png", json!({ "name": "Homemade Halo" })),
            item("nameplate", "sky.webm", json!({ "name": "Sky", "shop_item_id": "21", "bundles": [{ "id": "b1", "name": "Night Bundle" }] })),
            item("frame", "vines", json!({ "name": "Vines" })),
            item("effect", "rain", json!({ "name": "Rain", "shop_item_id": "31" })),
        ];
        let cat = build(&root, items);
        let b = |id: &str| cat.bundles.iter().find(|b| b.id == id);
        let values = |id: &str| b(id).unwrap().items.iter().map(|x| x.value.as_str()).collect::<Vec<_>>();
        assert_eq!(b("b1").unwrap().name, "Night Pack");
        assert_eq!(b("b1").unwrap().collection_id.as_deref(), Some("c1"), "kept from bundles.json");
        assert_eq!(values("b1"), ["asset:moon", "asset:star", "asset:homemade_halo"]);
        assert!(b("b2").is_none(), "hidden, and not brought back by star's own list");
        assert_eq!(values("b3"), ["asset:rain"]);
        assert_eq!(values("local-mwsgs60r"), ["asset:sky", "asset:vines"]);
        assert_eq!(values("b9"), ["asset:star"], "a bundle only the items know");
        let sky = cat.items.iter().find(|i| i.key == "sky.webm").unwrap();
        assert_eq!(sky.bundles, ["local-mwsgs60r"], "b1's own list wins over the item's");
        let halo = cat.items.iter().find(|i| i.key == "homemade_halo.png").unwrap();
        assert_eq!(halo.facets.collection_id.as_deref(), Some("c2"), "filled in from the top-level collections");
        assert_eq!(cat.labels.get("cute_cozy").map(String::as_str), Some("Cute & Cozy"));
        assert_eq!(cat.collections.iter().find(|c| c.id == "c1").unwrap().name, "Night Pack");
        // Without either file there are no bundles but the items' own.
        std::fs::remove_file(root.join("bundles.json")).unwrap();
        std::fs::remove_file(root.join("bundles.local.json")).unwrap();
        let cat = build(&root, vec![item("decoration", "star.png", json!({ "bundles": [{ "id": "b2", "name": "Day" }] }))]);
        assert_eq!(cat.bundles.len(), 1);
        let _ = std::fs::remove_dir_all(&root);
    }
}
