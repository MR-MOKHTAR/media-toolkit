//! What every connection the app makes has to agree on: the proxy, the speed
//! limit, and how many downloads run at once.
//!
//! Held in memory, because they are read on every request and every yt-dlp
//! spawn, and written to `settings.json` so they survive a restart. The proxy
//! matters most: yt-dlp and the app's own HTTP client must leave through the
//! same exit. YouTube signs its stream URLs for the address that asked for
//! them, and a URL resolved by yt-dlp through a proxy and then fetched by
//! `direct` without one is answered with a 403.

use std::sync::{OnceLock, RwLock};
use std::time::{Duration, Instant};

use reqwest::{ClientBuilder, Url};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};
use crate::jobs::Jobs;
use crate::ratelimit;
use crate::settings;

/// The most downloads the app will run at once, whatever is asked for. Eight
/// connections each is already 64 sockets at this ceiling.
pub const MAX_DOWNLOAD_SLOTS: usize = 8;

/// Four, which is what the app always ran before this was a setting.
pub const DEFAULT_DOWNLOAD_SLOTS: usize = 4;

/// The proxy schemes both clients accept. `socks5h` resolves names at the
/// proxy rather than here, which is the one that works where local DNS
/// answers are tampered with.
const SCHEMES: &[&str] = &["http", "https", "socks5", "socks5h"];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkSettings {
    /// `socks5h://127.0.0.1:10808`, `http://127.0.0.1:10809`. `None` leaves
    /// both clients on the system's own proxy settings, as before.
    pub proxy: Option<String>,
    /// How many downloads run at once; the rest wait their turn.
    pub max_downloads: usize,
    /// Bytes per second for everything the app downloads, together. `None`
    /// is no limit.
    pub speed_limit: Option<u64>,
}

impl Default for NetworkSettings {
    fn default() -> Self {
        Self {
            proxy: None,
            max_downloads: DEFAULT_DOWNLOAD_SLOTS,
            speed_limit: None,
        }
    }
}

fn live() -> &'static RwLock<NetworkSettings> {
    static LIVE: OnceLock<RwLock<NetworkSettings>> = OnceLock::new();
    LIVE.get_or_init(Default::default)
}

/// The settings in force right now.
pub fn current() -> NetworkSettings {
    live().read().map(|guard| guard.clone()).unwrap_or_default()
}

/// The proxy in force right now, if one was set.
pub fn proxy() -> Option<String> {
    current().proxy
}

/// `builder`, sent through the proxy when there is one -- for every client
/// the app builds, so none of them leaves by a different route.
pub fn proxied(builder: ClientBuilder, proxy: Option<&str>) -> ClientBuilder {
    match proxy.map(reqwest::Proxy::all) {
        Some(Ok(proxy)) => builder.proxy(proxy),
        // Validated before it was stored; a value that still fails to parse is
        // treated as none rather than taking every download down with it.
        _ => builder,
    }
}

/// Checks and tidies a proxy address typed by a person.
///
/// Empty is "no proxy". Anything else must be a URL with one of `SCHEMES`, a
/// host and a port: `127.0.0.1:10808` alone is refused rather than guessed at,
/// because guessing HTTP for a SOCKS port fails in a way that looks like the
/// network being down.
pub fn normalize_proxy(raw: Option<&str>) -> AppResult<Option<String>> {
    let Some(raw) = raw.map(str::trim).filter(|raw| !raw.is_empty()) else {
        return Ok(None);
    };
    let url = Url::parse(raw).map_err(|_| AppError::invalid("proxy", "not a proxy address"))?;
    if !SCHEMES.contains(&url.scheme()) {
        return Err(AppError::invalid("proxy", "unsupported proxy type"));
    }
    let host = url
        .host_str()
        .filter(|host| !host.is_empty())
        .ok_or_else(|| AppError::invalid("proxy", "no host"))?;
    let port = url
        .port()
        .ok_or_else(|| AppError::invalid("proxy", "no port"))?;
    let credentials = match (url.username(), url.password()) {
        ("", _) => String::new(),
        (user, Some(password)) => format!("{user}:{password}@"),
        (user, None) => format!("{user}@"),
    };
    Ok(Some(format!("{}://{credentials}{host}:{port}", url.scheme())))
}

/// Checks a whole set of settings, tidying what can be tidied.
pub fn validate(settings: NetworkSettings) -> AppResult<NetworkSettings> {
    Ok(NetworkSettings {
        proxy: normalize_proxy(settings.proxy.as_deref())?,
        max_downloads: settings.max_downloads.clamp(1, MAX_DOWNLOAD_SLOTS),
        // Below 16 KB/s a download is not slow, it is stopped.
        speed_limit: settings.speed_limit.filter(|limit| *limit > 0).map(|limit| limit.max(16 * 1024)),
    })
}

/// Puts `settings` in force: the proxy for the next connection, the limit for
/// the next chunk, the slots for the next download to ask for one.
pub fn apply(app: &AppHandle, settings: NetworkSettings) {
    ratelimit::set_limit(settings.speed_limit);
    app.state::<Jobs>().set_download_slots(settings.max_downloads);
    if let Ok(mut guard) = live().write() {
        *guard = settings;
    }
}

/// Loads what was saved and puts it in force. Called once, at startup.
pub fn init(app: &AppHandle) {
    let saved = settings::load(app);
    let network = validate(NetworkSettings {
        proxy: saved.proxy,
        max_downloads: saved.max_downloads,
        speed_limit: saved.speed_limit,
    })
    .unwrap_or_default();
    apply(app, network);
}

#[tauri::command]
pub fn get_network_settings() -> NetworkSettings {
    current()
}

/// Validates, saves and applies. Returns what is now in force, which is what
/// the panel shows -- a tidied proxy address included.
#[tauri::command]
pub fn set_network_settings(app: AppHandle, settings: NetworkSettings) -> AppResult<NetworkSettings> {
    let settings = validate(settings)?;
    let mut saved = settings::load(&app);
    saved.proxy = settings.proxy.clone();
    saved.max_downloads = settings.max_downloads;
    saved.speed_limit = settings.speed_limit;
    settings::save(&app, &saved)?;
    apply(&app, settings.clone());
    Ok(settings)
}

/// What a proxy test found.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyTest {
    /// Time to the first response, in milliseconds.
    pub latency_ms: u64,
}

/// Whether YouTube answers through this proxy -- any HTTP response counts:
/// a 404 still proves the route works, and YouTube is the site people set a
/// proxy for. Tested before it is saved, so a typo is caught on the panel and
/// not by the next download.
#[tauri::command]
pub async fn test_proxy(proxy: Option<String>) -> AppResult<ProxyTest> {
    let proxy = normalize_proxy(proxy.as_deref())?;
    let client = proxied(
        reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(15)),
        proxy.as_deref(),
    )
    .build()
    .map_err(AppError::network)?;

    let started = Instant::now();
    client
        .get("https://www.youtube.com/generate_204")
        .send()
        .await
        .map_err(AppError::network)?;
    Ok(ProxyTest {
        latency_ms: started.elapsed().as_millis() as u64,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_proxy_address_is_tidied() {
        assert_eq!(normalize_proxy(None).unwrap(), None);
        assert_eq!(normalize_proxy(Some("  ")).unwrap(), None);
        assert_eq!(
            normalize_proxy(Some(" socks5h://127.0.0.1:10808/ ")).unwrap().as_deref(),
            Some("socks5h://127.0.0.1:10808")
        );
        assert_eq!(
            normalize_proxy(Some("http://user:pass@proxy.lan:3128")).unwrap().as_deref(),
            Some("http://user:pass@proxy.lan:3128")
        );
    }

    #[test]
    fn a_proxy_address_that_cannot_work_is_refused() {
        // No scheme: HTTP and SOCKS on the same port fail differently, and
        // guessing wrong looks like the network being down.
        assert!(normalize_proxy(Some("127.0.0.1:10808")).is_err());
        assert!(normalize_proxy(Some("ftp://127.0.0.1:21")).is_err());
        assert!(normalize_proxy(Some("socks5://127.0.0.1")).is_err());
    }

    #[test]
    fn settings_are_kept_inside_what_works() {
        let checked = validate(NetworkSettings {
            proxy: None,
            max_downloads: 50,
            speed_limit: Some(1),
        })
        .unwrap();
        assert_eq!(checked.max_downloads, MAX_DOWNLOAD_SLOTS);
        assert_eq!(checked.speed_limit, Some(16 * 1024));

        let zero = validate(NetworkSettings {
            proxy: None,
            max_downloads: 0,
            speed_limit: Some(0),
        })
        .unwrap();
        assert_eq!(zero.max_downloads, 1);
        assert_eq!(zero.speed_limit, None);
    }
}
