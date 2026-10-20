//! Upload malware scanning through a ClamAV daemon (clamd) using its INSTREAM protocol over TCP.
//! Configured from Instance Settings (`av_addr`, e.g. `clamav:3310` for the compose `av` profile; empty = off,
//! `av_fail_closed` decides what an unreachable scanner means). Files are scanned before they are recorded, so
//! nothing unscanned is ever served: the upload simply fails with the signature name.

use crate::error::AppError;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

#[derive(Debug)]
pub enum Verdict {
    Clean,
    Infected(String),
}

/// Scan `bytes`; Err when the daemon could not be reached or answered nonsense.
pub async fn scan(addr: &str, bytes: &[u8]) -> Result<Verdict, String> {
    let io = async {
        let mut s = tokio::net::TcpStream::connect(addr).await.map_err(|e| format!("connect {addr}: {e}"))?;
        s.write_all(b"zINSTREAM\0").await.map_err(|e| e.to_string())?;
        for chunk in bytes.chunks(64 * 1024) {
            s.write_all(&(chunk.len() as u32).to_be_bytes()).await.map_err(|e| e.to_string())?;
            s.write_all(chunk).await.map_err(|e| e.to_string())?;
        }
        s.write_all(&0u32.to_be_bytes()).await.map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        s.read_to_end(&mut out).await.map_err(|e| e.to_string())?;
        Ok::<String, String>(String::from_utf8_lossy(&out).trim_end_matches(['\0', '\n']).to_string())
    };
    let reply = tokio::time::timeout(std::time::Duration::from_secs(60), io).await.map_err(|_| "scan timed out".to_string())??;
    // "stream: OK" | "stream: Eicar-Test-Signature FOUND" | "stream: ... ERROR"
    if let Some(rest) = reply.strip_prefix("stream: ") {
        if rest == "OK" { return Ok(Verdict::Clean); }
        if let Some(sig) = rest.strip_suffix(" FOUND") { return Ok(Verdict::Infected(sig.to_string())); }
    }
    Err(format!("unexpected clamd reply: {reply}"))
}

/// Gate an upload: Ok(()) when clean or scanning is off; the upload error otherwise.
pub async fn check(state: &crate::state::AppState, bytes: &[u8], what: &str) -> Result<(), AppError> {
    let settings = match crate::routes::admin::load_settings(&state.db).await { Ok(s) => s, Err(_) => return Ok(()) };
    let addr = settings.av_addr.trim();
    if addr.is_empty() {
        return Ok(());
    }
    match scan(addr, bytes).await {
        Ok(Verdict::Clean) => Ok(()),
        Ok(Verdict::Infected(sig)) => {
            tracing::warn!(what, signature = %sig, "upload rejected by antivirus");
            crate::metrics::METRICS.av_rejected.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            Err(AppError::BadRequest(format!("Upload rejected: {sig} detected")))
        }
        Err(e) => {
            tracing::error!(what, error = %e, "antivirus scan failed");
            if settings.av_fail_closed { Err(AppError::BadRequest("Upload refused: the virus scanner is unavailable".into())) } else { Ok(()) }
        }
    }
}
