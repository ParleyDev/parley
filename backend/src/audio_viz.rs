//! Visualiser data for audio attachments, so players can show a reactive visualisation without routing the audio
//! through Web Audio (which on iPhones stops playback when the app goes to the background). Each file is decoded
//! once with ffmpeg to mono PCM and analysed into a timeline of frequency bands (15 frames a second, 32 log-spaced
//! bands from 40 Hz up, levels 0-255 normalised to the track) plus a 256-point peak waveform for seek bars. The
//! result sits next to the upload as `<id>.viz`: made in the background on upload, or on first request for older
//! files. Clients fetch a few KB per minute of audio and replay it in step with the stream.
//!
//! Format (little endian): "PVZ1", fps u8, bands u8, offset_ms u16 (frame 0's centre), frames u32, peaks u16,
//! reserved u16, then `peaks` bytes, then `frames * bands` bytes. A 0-byte file marks a file that couldn't be
//! analysed.
use rustfft::{num_complex::Complex, FftPlanner};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use tokio::io::AsyncReadExt;
use tokio::sync::Semaphore;
use uuid::Uuid;

pub const FPS: u32 = 15;
pub const BANDS: usize = 32;
const PEAKS: usize = 256;
const RATE: u32 = 22050;
const WIN: usize = 2048;
const HOP: usize = (RATE / FPS) as usize;
const HEADER: usize = 16;
/// Longest stretch analysed (2 hours); the rest of a longer file has no visualiser data.
const MAX_SECONDS: u32 = 7200;
/// Decoded audio shown as a 55 dB window under the track's loud parts.
const RANGE_DB: f32 = 55.0;

/// At most two analyses at once: each is an ffmpeg decode plus FFTs.
static SLOTS: LazyLock<Semaphore> = LazyLock::new(|| Semaphore::new(2));

pub fn is_audio(content_type: &str) -> bool { content_type.to_ascii_lowercase().starts_with("audio/") }
pub fn viz_path(dir: &Path, id: Uuid) -> PathBuf { dir.join(format!("{id}.viz")) }

/// The visualiser data for the upload at `src`, made (and stored at `out`) if it isn't there yet. None when the
/// file can't be analysed.
pub async fn ensure(src: PathBuf, out: PathBuf) -> Option<Vec<u8>> {
    if let Ok(b) = tokio::fs::read(&out).await { return (!b.is_empty()).then_some(b); }
    let _slot = SLOTS.acquire().await.ok()?;
    // Someone else may have made it while this waited.
    if let Ok(b) = tokio::fs::read(&out).await { return (!b.is_empty()).then_some(b); }
    match analyse(&src).await {
        Ok(bytes) => {
            let tmp = out.with_extension(format!("viz-{}", Uuid::new_v4().simple()));
            if tokio::fs::write(&tmp, &bytes).await.is_ok() { let _ = tokio::fs::rename(&tmp, &out).await; }
            Some(bytes)
        }
        Err(Failure::NoFfmpeg(e)) => { tracing::debug!(error = %e, "no ffmpeg: audio has no visualiser data"); None }
        Err(Failure::Bad(e)) => {
            tracing::warn!(file = %src.display(), error = %e, "audio visualiser analysis failed");
            let _ = tokio::fs::write(&out, b"").await;
            None
        }
    }
}

enum Failure { NoFfmpeg(String), Bad(String) }

async fn analyse(src: &Path) -> Result<Vec<u8>, Failure> {
    let mut child = tokio::process::Command::new("ffmpeg")
        .args(["-nostdin", "-hide_banner", "-loglevel", "error", "-i"])
        .arg(src)
        .args(["-vn", "-ac", "1", "-ar", &RATE.to_string(), "-t", &MAX_SECONDS.to_string(), "-f", "f32le", "pipe:1"])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| Failure::NoFfmpeg(e.to_string()))?;
    let mut stdout = child.stdout.take().ok_or_else(|| Failure::Bad("no stdout".into()))?;
    let mut an = Analyser::new();
    let mut chunk = vec![0u8; 64 * 1024];
    let mut carry: Vec<u8> = Vec::new();
    loop {
        let n = stdout.read(&mut chunk).await.map_err(|e| Failure::Bad(e.to_string()))?;
        if n == 0 { break; }
        carry.extend_from_slice(&chunk[..n]);
        let whole = carry.len() / 4 * 4;
        an.push(carry[..whole].chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])));
        carry.drain(..whole);
    }
    let status = child.wait_with_output().await.map_err(|e| Failure::Bad(e.to_string()))?;
    if !status.status.success() && an.frames() == 0 {
        return Err(Failure::Bad(String::from_utf8_lossy(&status.stderr).trim().to_string()));
    }
    if an.frames() == 0 { return Err(Failure::Bad("no audio".into())); }
    Ok(tokio::task::spawn_blocking(move || an.finish()).await.map_err(|e| Failure::Bad(e.to_string()))?)
}

/// Streaming analysis: PCM in, a frame of band levels every HOP samples.
struct Analyser {
    buf: Vec<f32>,
    fft: std::sync::Arc<dyn rustfft::Fft<f32>>,
    window: Vec<f32>,
    /// Per band: FFT bin range and a tilt (+3 dB per octave above 1 kHz, minus below) so the top end doesn't look
    /// dead next to the bass, as in music visualisers.
    bands: Vec<(usize, usize, f32)>,
    db: Vec<f32>,
    peak: Vec<f32>,
    scratch: Vec<Complex<f32>>,
}

impl Analyser {
    fn new() -> Self {
        let fft = FftPlanner::new().plan_fft_forward(WIN);
        let window = (0..WIN).map(|i| 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / WIN as f32).cos()).collect();
        let bin_hz = RATE as f32 / WIN as f32;
        let (lo, hi) = (40f32, RATE as f32 / 2.0 * 0.95);
        let bands = (0..BANDS).map(|b| {
            let f0 = lo * (hi / lo).powf(b as f32 / BANDS as f32);
            let f1 = lo * (hi / lo).powf((b + 1) as f32 / BANDS as f32);
            let a = ((f0 / bin_hz).floor() as usize).max(1);
            let z = ((f1 / bin_hz).ceil() as usize).max(a + 1).min(WIN / 2);
            (a, z, 3.0 * ((f0 * f1).sqrt() / 1000.0).log2())
        }).collect();
        Analyser { buf: Vec::with_capacity(WIN * 4), fft, window, bands, db: Vec::new(), peak: Vec::new(), scratch: vec![Complex::default(); WIN] }
    }

    fn frames(&self) -> usize { self.peak.len() }

    fn push(&mut self, samples: impl Iterator<Item = f32>) {
        if self.frames() >= (MAX_SECONDS * FPS) as usize { self.buf.clear(); return; }
        self.buf.extend(samples);
        let mut start = 0;
        while self.buf.len() - start >= WIN && self.frames() < (MAX_SECONDS * FPS) as usize {
            self.frame(start);
            start += HOP;
        }
        self.buf.drain(..start.min(self.buf.len()));
    }

    fn frame(&mut self, start: usize) {
        let s = &self.buf[start..start + WIN];
        self.peak.push(s[WIN / 2 - HOP / 2..WIN / 2 + HOP / 2].iter().fold(0f32, |m, v| m.max(v.abs())));
        for (i, c) in self.scratch.iter_mut().enumerate() { *c = Complex::new(s[i] * self.window[i], 0.0); }
        self.fft.process(&mut self.scratch);
        for &(a, z, tilt) in &self.bands {
            let power = self.scratch[a..z].iter().map(|c| c.norm_sqr()).sum::<f32>() / (z - a) as f32;
            self.db.push(10.0 * (power + 1e-12).log10() + tilt);
        }
    }

    fn finish(self) -> Vec<u8> {
        let frames = self.frames();
        // Normalise to the track: its loud parts (99th percentile) at the top, RANGE_DB below that at zero.
        let mut sorted: Vec<f32> = self.db.iter().copied().filter(|v| v.is_finite()).collect();
        sorted.sort_by(|a, b| a.total_cmp(b));
        let top = sorted.get(((sorted.len() as f32) * 0.99) as usize).or(sorted.last()).copied().unwrap_or(0.0);
        let floor = top - RANGE_DB;
        let level = |v: f32| (((v - floor) / RANGE_DB).clamp(0.0, 1.0) * 255.0).round() as u8;
        let max_peak = self.peak.iter().fold(0f32, |m, v| m.max(*v)).max(1e-6);
        let peaks: Vec<u8> = (0..PEAKS).map(|i| {
            let (a, z) = (i * frames / PEAKS, ((i + 1) * frames / PEAKS).max(i * frames / PEAKS + 1).min(frames));
            let p = self.peak.get(a..z).map(|s| s.iter().fold(0f32, |m, v| m.max(*v))).unwrap_or(0.0);
            ((p / max_peak).sqrt() * 255.0).round() as u8
        }).collect();
        let mut out = Vec::with_capacity(HEADER + PEAKS + frames * BANDS);
        out.extend_from_slice(b"PVZ1");
        out.push(FPS as u8);
        out.push(BANDS as u8);
        out.extend_from_slice(&((WIN as u32 * 500 / RATE) as u16).to_le_bytes());
        out.extend_from_slice(&(frames as u32).to_le_bytes());
        out.extend_from_slice(&(PEAKS as u16).to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&peaks);
        out.extend(self.db.iter().map(|v| level(*v)));
        out
    }
}

/// The length of the audio the visualiser data at `path` covers, in seconds, if it's there.
pub async fn seconds(path: &Path) -> Option<f32> {
    let mut f = tokio::fs::File::open(path).await.ok()?;
    let mut h = [0u8; HEADER];
    f.read_exact(&mut h).await.ok()?;
    if &h[..4] != b"PVZ1" || h[4] == 0 { return None; }
    Some(u32::from_le_bytes([h[8], h[9], h[10], h[11]]) as f32 / h[4] as f32)
}

/// Just the header and the peak waveform (seek bars), without the timeline.
pub fn peaks_only(bytes: &[u8]) -> &[u8] {
    let n = bytes.get(12..14).map(|b| u16::from_le_bytes([b[0], b[1]]) as usize).unwrap_or(0);
    &bytes[..(HEADER + n).min(bytes.len())]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_tone_lights_its_band() {
        let mut an = Analyser::new();
        // Two seconds of 1 kHz, then two of 100 Hz.
        an.push((0..RATE as usize * 2).map(|i| (2.0 * std::f32::consts::PI * 1000.0 * i as f32 / RATE as f32).sin() * 0.5));
        an.push((0..RATE as usize * 2).map(|i| (2.0 * std::f32::consts::PI * 100.0 * i as f32 / RATE as f32).sin() * 0.5));
        let frames = an.frames();
        let bands = an.bands.clone();
        let out = an.finish();
        assert_eq!(&out[..4], b"PVZ1");
        assert!((55..=62).contains(&frames), "{frames} frames for 4 s");
        let band_of = |hz: f32| bands.iter().position(|&(a, z, _)| { let bin = (hz / (RATE as f32 / WIN as f32)) as usize; bin >= a && bin < z }).unwrap();
        let frame = |f: usize| &out[HEADER + PEAKS + f * BANDS..HEADER + PEAKS + (f + 1) * BANDS];
        let loudest = |f: usize| frame(f).iter().enumerate().max_by_key(|(_, v)| **v).unwrap().0;
        assert_eq!(loudest(10), band_of(1000.0));
        assert_eq!(loudest(frames - 10), band_of(100.0));
        assert!(peaks_only(&out).len() == HEADER + PEAKS);
    }
}
