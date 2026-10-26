//! README badges for invites, drawn like shields.io's: "Parley | 12 online · 340 members", linking to the invite.
//! Text is sized from approximate Verdana widths and pinned with `textLength`, so it fits whatever font renders it.

use base64::Engine;

const LOGO: &str = include_str!("badge-logo.svg");
pub const COLOR: &str = "#6d5dfc";
pub const GREY: &str = "#9f9f9f";

#[derive(Clone, Copy, PartialEq)]
pub enum Style { Flat, FlatSquare, ForTheBadge }

impl Style {
    pub fn parse(s: Option<&str>) -> Style {
        match s { Some("flat-square") => Style::FlatSquare, Some("for-the-badge") => Style::ForTheBadge, _ => Style::Flat }
    }
}

/// Width in px of `s` in 11px Verdana (bold 10px caps for for-the-badge are close enough after `textLength`).
fn text_width(s: &str) -> f64 {
    s.chars().map(|c| match c {
        'i' | 'l' | 'j' | 'I' | '|' | '.' | ',' | ':' | ';' | '\'' | '!' => 3.1,
        'f' | 't' | 'r' | '(' | ')' | '[' | ']' | '/' => 4.3,
        ' ' => 3.9,
        '·' => 4.7,
        'm' => 10.7,
        'w' => 8.9,
        'M' | 'W' => 9.9,
        '0'..='9' => 7.0,
        'A'..='Z' => 7.5,
        'a'..='z' => 6.6,
        _ => 7.5,
    }).sum()
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// The badge's SVG. `label` sits on grey after the logo, `message` on `color`.
pub fn render(label: &str, message: &str, color: &str, style: Style) -> String {
    let big = style == Style::ForTheBadge;
    let (label, message) = if big { (label.to_uppercase(), message.to_uppercase()) } else { (label.to_string(), message.to_string()) };
    // for-the-badge text is spaced out, so it needs about 10% more room.
    let w = |s: &str| (text_width(s) * if big { 1.1 } else { 1.0 }).ceil();
    let (h, pad, logo) = if big { (28.0, 12.0, 14.0) } else { (20.0, 6.0, 14.0) };
    let (lt, mt) = (w(&label), w(&message));
    let logo_x = if big { 9.0 } else { 5.0 };
    let label_start = logo_x + logo + if big { 6.0 } else { 3.0 };
    let lw = label_start + lt + pad - if big { 2.0 } else { 0.0 };
    let mw = mt + pad * 2.0;
    let total = lw + mw;
    let title = esc(&format!("{label}: {message}"));
    let (label, message) = (esc(&label), esc(&message));
    let logo_uri = format!("data:image/svg+xml;base64,{}", base64::engine::general_purpose::STANDARD.encode(LOGO));
    let logo_y = (h - logo) / 2.0;
    let rx = if style == Style::Flat { 3 } else { 0 };
    // Centres and lengths are in tenths of a pixel, drawn at scale(.1), as shields.io does for crisper text.
    let lx = (label_start + lt / 2.0) * 10.0;
    let mx = (lw + mw / 2.0) * 10.0;
    let (lt10, mt10) = (lt * 10.0, mt * 10.0);
    let (font, weight, y_shadow, y_text) = if big { (100, " font-weight=\"bold\"", 0, 175) } else { (110, "", 150, 140) };
    let gradient = if style == Style::Flat {
        format!(r##"<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient><rect width="{total}" height="{h}" fill="url(#s)"/>"##)
    } else { String::new() };
    let shadow = |x: f64, len: f64, text: &str| if big { String::new() } else {
        format!(r##"<text aria-hidden="true" x="{x}" y="{y_shadow}" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="{len}">{text}</text>"##)
    };
    format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{total}" height="{h}" role="img" aria-label="{title}"><title>{title}</title><clipPath id="r"><rect width="{total}" height="{h}" rx="{rx}" fill="#fff"/></clipPath><g clip-path="url(#r)"><rect width="{lw}" height="{h}" fill="#555"/><rect x="{lw}" width="{mw}" height="{h}" fill="{color}"/>{gradient}</g><g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="{font}"{weight}><image x="{logo_x}" y="{logo_y}" width="{logo}" height="{logo}" xlink:href="{logo_uri}"/>{ls}<text x="{lx}" y="{y_text}" transform="scale(.1)" fill="#fff" textLength="{lt10}">{label}</text>{ms}<text x="{mx}" y="{y_text}" transform="scale(.1)" fill="#fff" textLength="{mt10}">{message}</text></g></svg>"##,
        ls = shadow(lx, lt10, &label),
        ms = shadow(mx, mt10, &message),
    )
}

/// "1.2k" style counts, so the badge stays short on big servers.
pub fn compact(n: i64) -> String {
    match n {
        n if n >= 1_000_000 => trim(n as f64 / 1_000_000.0, "M"),
        n if n >= 10_000 => format!("{}k", n / 1000),
        n if n >= 1000 => trim(n as f64 / 1000.0, "k"),
        n => n.to_string(),
    }
}

fn trim(v: f64, unit: &str) -> String {
    let s = format!("{:.1}", (v * 10.0).floor() / 10.0);
    format!("{}{unit}", s.strip_suffix(".0").unwrap_or(&s))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compact_counts() {
        assert_eq!(compact(7), "7");
        assert_eq!(compact(1000), "1k");
        assert_eq!(compact(1250), "1.2k");
        assert_eq!(compact(48_900), "48k");
        assert_eq!(compact(2_340_000), "2.3M");
    }

    #[test]
    fn renders_escaped_text() {
        let svg = render("Parley <3", "5 online", COLOR, Style::Flat);
        assert!(svg.starts_with("<svg") && svg.contains("Parley &lt;3") && !svg.contains("<3"));
        assert!(render("x", "y", COLOR, Style::ForTheBadge).contains("height=\"28\""));
    }
}
