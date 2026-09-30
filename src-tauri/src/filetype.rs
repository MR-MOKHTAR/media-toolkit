//! What a file is -- video, audio, or neither -- and what it should be called.
//!
//! One module, because every engine has to answer the same question and the
//! answers used to disagree. The direct downloader read a name and a content
//! type, yt-dlp's path took the Video/Audio toggle at its word, and nothing
//! looked at the file that actually arrived. An installer that reached yt-dlp
//! came back as `<uuid>.unknown_video`, on the Video shelf, drawn with a film
//! icon.
//!
//! The rule everywhere is the same: evidence first, and "not media" is an
//! answer rather than a failure. The bytes are the strongest witness (a magic
//! number cannot be mislabelled by a CDN), a real extension comes next, and the
//! server's content type is the last resort -- `application/octet-stream` is the
//! most common content type on earth for a file that knows perfectly well it
//! is a zip.

use std::path::Path;

use tokio::io::AsyncReadExt;

use crate::jobs::MediaClass;
use crate::paths;

/// How much of a file is read to work out what it is. One TCP segment's worth:
/// every magic number worth knowing sits in the first few dozen bytes.
pub const SNIFF_BYTES: usize = 512;

/// Extensions that make a file a video. The same list `src/lib/fileKind.ts`
/// draws the job card from, so the shelf a file lands on and the icon it is
/// drawn with cannot disagree.
pub const VIDEO_EXTENSIONS: &[&str] = &[
    "mp4", "mkv", "mov", "webm", "avi", "m4v", "ts", "flv", "wmv", "mpg", "mpeg", "3gp", "ogv",
    "mts", "m2ts", "vob", "divx", "asf", "rm", "rmvb",
];

/// Extensions that make a file audio. Mirrors `AUDIO_EXTENSIONS` in fileKind.ts.
pub const AUDIO_EXTENSIONS: &[&str] = &[
    "mp3", "m4a", "wav", "flac", "aac", "ogg", "opus", "wma", "weba", "oga", "m4b", "aiff", "aif",
    "amr", "ape", "ac3", "mka",
];

/// Extensions that are certainly *not* media: the image, archive, document and
/// installer lists of fileKind.ts. A name ending in one of these is a claim the
/// server's content type does not get to overrule -- `setup.exe` served as
/// `video/mp4` is an installer.
const OTHER_EXTENSIONS: &[&str] = &[
    // images
    "jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "ico", "tif", "tiff", "heic", "avif",
    "jfif", "apng", "psd",
    // archives
    "zip", "7z", "rar", "tar", "gz", "tgz", "bz2", "xz", "zst", "iso", "cab", "lz", "lzma",
    "arj", "txz", "tbz", "tbz2",
    // documents
    "pdf", "txt", "md", "srt", "vtt", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "csv", "json",
    "xml", "epub", "rtf", "odt", "ods", "odp", "ass", "sub", "sbv", "html", "htm", "yml",
    "yaml", "log", "tex", "mobi", "azw3",
    // installers and packages
    "exe", "msi", "dmg", "pkg", "deb", "rpm", "appimage", "apk", "snap", "flatpak", "bin", "appx",
    "msix", "jar", "run", "sh", "bat", "com", "xpi", "crx", "apks", "xapk", "img", "torrent",
];

/// Extensions that say nothing about the file: what yt-dlp calls anything it
/// could not name, and the generic words servers and downloaders fall back on.
/// Replaced whenever anything better is known.
const PLACEHOLDER_EXTENSIONS: &[&str] = &["unknown_video", "bin", "dat", "tmp", "download"];

/// The program that served the file, not the file: `download.php?id=5` hands
/// out zips, installers and PDFs. Replaced when the response says what the
/// file actually is -- but a `.php` served as text is left alone, because that
/// one may well be PHP.
const SCRIPT_EXTENSIONS: &[&str] = &[
    "php", "php3", "php5", "phtml", "asp", "aspx", "ashx", "axd", "jsp", "jspx", "cgi", "pl", "do",
    "action", "cfm",
];

fn lower(ext: &str) -> String {
    ext.trim().to_ascii_lowercase()
}

/// Video or audio, by extension alone.
pub fn media_class_of_extension(ext: &str) -> Option<MediaClass> {
    let ext = lower(ext);
    if VIDEO_EXTENSIONS.contains(&ext.as_str()) {
        Some(MediaClass::Video)
    } else if AUDIO_EXTENSIONS.contains(&ext.as_str()) {
        Some(MediaClass::Audio)
    } else {
        None
    }
}

/// Whether this extension names a kind of file this app recognises at all.
pub fn is_known_extension(ext: &str) -> bool {
    let ext = lower(ext);
    media_class_of_extension(&ext).is_some() || OTHER_EXTENSIONS.contains(&ext.as_str())
}

pub fn is_placeholder_extension(ext: &str) -> bool {
    PLACEHOLDER_EXTENSIONS.contains(&lower(ext).as_str())
}

fn is_script_extension(ext: &str) -> bool {
    SCRIPT_EXTENSIONS.contains(&lower(ext).as_str())
}

/// An extension that says something about the file: neither a placeholder nor
/// the name of the program that served it.
pub fn is_real_extension(ext: &str) -> bool {
    !is_placeholder_extension(ext) && !is_script_extension(ext)
}

/// Splits a file name into a sanitized stem and a lowercase extension.
///
/// An "extension" here has to look like one: up to eight characters, letters
/// and digits only. Without that, `archive.2024.backup` is saved with an
/// extension of "backup" -- harmless -- but `report.v1 final` gets one of
/// "v1 final", and a version number in a video title turns into a file the OS
/// will not open. `unknown_video` is the one exception, because it is the
/// extension yt-dlp gives a file it could not name and it has to be recognised
/// to be replaced.
pub fn split_name(raw: &str) -> (String, Option<String>) {
    let trimmed = raw.trim().trim_end_matches('/');
    match trimmed.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() && is_extension_like(ext) => {
            (paths::sanitize_stem(stem), Some(ext.to_ascii_lowercase()))
        }
        _ => (paths::sanitize_stem(trimmed), None),
    }
}

/// The test `split_name` applies to what follows the last dot.
pub fn is_extension_like(ext: &str) -> bool {
    ext.eq_ignore_ascii_case("unknown_video")
        || ((1..=8).contains(&ext.len()) && ext.chars().all(|c| c.is_ascii_alphanumeric()))
}

/// The extension of a path, when it has one that looks like one.
pub fn extension_of(path: &Path) -> Option<String> {
    let name = path.file_name()?.to_string_lossy().into_owned();
    split_name(&name).1
}

/// What the bytes themselves say this is.
///
/// The last word on a file's type, and the only honest one for the very
/// common case of a CDN serving everything as `application/octet-stream` from
/// a URL with no extension in it.
///
/// Deliberately short. Every entry here is a fixed byte sequence at a fixed
/// offset that cannot be anything else; a guess that is only usually right
/// would rename files wrongly, which is worse than `.bin`.
pub fn sniff(head: &[u8]) -> Option<&'static str> {
    let starts = |magic: &[u8]| head.starts_with(magic);
    // The `ftyp` box that opens every ISO base media file names the brand.
    let brand = |want: &[u8]| head.len() >= 12 && &head[4..8] == b"ftyp" && head[8..].starts_with(want);

    Some(match () {
        _ if starts(b"%PDF-") => "pdf",
        _ if starts(b"\x89PNG\r\n\x1a\n") => "png",
        _ if starts(b"\xff\xd8\xff") => "jpg",
        _ if starts(b"GIF87a") || starts(b"GIF89a") => "gif",
        _ if starts(b"RIFF") && head.len() >= 12 => match &head[8..12] {
            b"WEBP" => "webp",
            b"WAVE" => "wav",
            b"AVI " => "avi",
            _ => return None,
        },
        _ if brand(b"M4A") => "m4a",
        _ if brand(b"qt") => "mov",
        _ if brand(b"3g") => "3gp",
        // isom, mp42, avc1, dash, iso5 ... all of them are mp4.
        _ if head.len() >= 8 && &head[4..8] == b"ftyp" => "mp4",
        // Matroska and WebM share a container; the DocType a few bytes in is
        // what separates them.
        _ if starts(b"\x1a\x45\xdf\xa3") => {
            if head.windows(4).take(64).any(|w| w == b"webm") {
                "webm"
            } else {
                "mkv"
            }
        }
        _ if starts(b"OggS") => "ogg",
        _ if starts(b"fLaC") => "flac",
        _ if starts(b"ID3") || starts(b"\xff\xfb") || starts(b"\xff\xf3") => "mp3",
        _ if starts(b"PK\x03\x04") => "zip",
        _ if starts(b"Rar!\x1a\x07") => "rar",
        _ if starts(b"7z\xbc\xaf\x27\x1c") => "7z",
        _ if starts(b"\xfd7zXZ\x00") => "xz",
        _ if starts(b"\x1f\x8b") => "gz",
        _ if starts(b"BZh") => "bz2",
        _ if starts(b"\x28\xb5\x2f\xfd") => "zst",
        _ if starts(b"MSCF") => "cab",
        _ if starts(b"\xed\xab\xee\xdb") => "rpm",
        // `!<arch>` is any ar archive; the first member of a .deb names it.
        _ if starts(b"!<arch>\n") && head.windows(13).any(|w| w == b"debian-binary") => "deb",
        // The tar magic sits in the header block rather than at the start.
        _ if head.len() > 262 && &head[257..262] == b"ustar" => "tar",
        _ if starts(b"MZ") => "exe",
        // An AppImage is an ELF with its own magic at offset 8. Plain ELF is
        // left alone: it is a binary, and `.bin` is what we already call one.
        _ if starts(b"\x7fELF") && head.len() >= 11 && &head[8..11] == b"AI\x02" => "AppImage",
        _ => return None,
    })
}

/// Whether these bytes are data rather than text.
///
/// A NUL is the giveaway -- every media container and executable format has
/// one within its first few hundred bytes, and text in any language this app
/// speaks has none. Failing that, a body where more than one byte in ten is a
/// control character is not something anyone meant to be read.
pub fn looks_binary(head: &[u8]) -> bool {
    if head.is_empty() {
        return false;
    }
    if head.contains(&0) {
        return true;
    }
    let control = head
        .iter()
        .filter(|&&byte| byte < 0x20 && !matches!(byte, b'\t' | b'\n' | b'\r' | 0x0c))
        .count();
    control * 10 > head.len()
}

/// Whether these bytes are the start of a web page.
///
/// Only the openings a document actually starts with, so a `<` inside a
/// subtitle file or an XML feed is not read as a page.
pub fn looks_like_html(head: &[u8]) -> bool {
    let start = head
        .iter()
        .position(|byte| !byte.is_ascii_whitespace() && *byte != 0xef && *byte != 0xbb && *byte != 0xbf)
        .unwrap_or(head.len());
    let text = String::from_utf8_lossy(&head[start..]).to_ascii_lowercase();
    text.starts_with("<!doctype html") || text.starts_with("<html") || text.starts_with("<head")
}

/// Video, audio, or neither, from the best evidence there is.
///
/// - `ext`: the extension of the name the file is (or will be) saved under.
/// - `content_type`: what the server declared, when anything was asked.
/// - `head`: the file's first bytes, when they have been seen. `None` means
///   "not looked at", which is different from an empty body.
///
/// A magic number is decisive when there is one. Two media answers are
/// reconciled in the name's favour -- an `.m4a` is a DASH `mp4` by its brand,
/// and it is still audio. Text is never media, whatever it is called: an
/// `index.ts` that reads as TypeScript is not an MPEG transport stream.
pub fn classify(ext: Option<&str>, content_type: Option<&str>, head: Option<&[u8]>) -> Option<MediaClass> {
    let by_name = ext.and_then(media_class_of_extension);

    if let Some(head) = head {
        if let Some(kind) = sniff(head) {
            let by_bytes = media_class_of_extension(kind);
            return match (by_name, by_bytes) {
                (Some(name), Some(_)) => Some(name),
                (_, bytes) => bytes,
            };
        }
        if !head.is_empty() && !looks_binary(head) {
            return None;
        }
    }

    if ext.is_some_and(is_known_extension) {
        return by_name;
    }

    match content_type.map(|value| value.trim().to_ascii_lowercase()) {
        Some(value) if value.starts_with("video/") => Some(MediaClass::Video),
        Some(value) if value.starts_with("audio/") => Some(MediaClass::Audio),
        _ => None,
    }
}

/// The extension a file should be saved with.
///
/// The name's own extension, when it is a real one. A placeholder (`.bin`,
/// yt-dlp's `.unknown_video`) is replaced by whatever says more, and so is a
/// server-script extension on a body that is plainly not a script. With no
/// extension at all, the response and the bytes are asked. `None` means
/// nothing knows -- the caller decides what an unnamed file is called.
pub fn best_extension(
    name_ext: Option<&str>,
    content_type: Option<&str>,
    head: Option<&[u8]>,
) -> Option<String> {
    let content_type = content_type.map(|value| value.trim().to_ascii_lowercase());
    let typed = content_type.as_deref().and_then(extension_for_type);
    let sniffed = head.and_then(sniff);
    let binary = head.is_some_and(looks_binary);
    let html = head.is_some_and(looks_like_html);
    let evidence = better_of(sniffed, typed).or(html.then_some("html"));

    match name_ext.map(lower) {
        Some(ext) if is_script_extension(&ext) => {
            // A script extension on a text body is left alone: a `.php`
            // served as text/plain may well be PHP. Only the bytes, or a
            // content type that is not text, can say otherwise.
            let served_text = content_type.as_deref().is_some_and(|value| value.starts_with("text/"));
            match (sniffed, typed) {
                (Some(bytes), _) => Some(bytes.to_string()),
                (None, Some(typed)) if !served_text => Some(typed.to_string()),
                _ if binary => Some("bin".to_string()),
                _ => Some(ext),
            }
        }
        Some(ext) if is_placeholder_extension(&ext) => {
            Some(evidence.map(str::to_string).unwrap_or(ext))
        }
        Some(ext) => Some(ext),
        None => evidence.map(str::to_string),
    }
}

/// Reconciles what the bytes say with what the server said.
///
/// The bytes win, with two exceptions where the content type is the more
/// specific of the two: every zip-based format (docx, apk, epub, jar) sniffs
/// as a zip, and an audio-only MP4 sniffs as `mp4` while `audio/mp4` says
/// `m4a`.
fn better_of(sniffed: Option<&'static str>, typed: Option<&'static str>) -> Option<&'static str> {
    match (sniffed, typed) {
        (Some("zip"), Some(typed)) => Some(typed),
        (Some(bytes), Some(typed))
            if media_class_of_extension(bytes).is_some() && media_class_of_extension(typed).is_some() =>
        {
            Some(typed)
        }
        (Some(bytes), _) => Some(bytes),
        (None, typed) => typed,
    }
}

/// Only the types worth naming. Everything else keeps whatever the URL had, or
/// ends up as `.bin` -- which is honest about not knowing.
///
/// The extension this returns is what the UI reads the file's kind back out of,
/// so a package or a document arriving without one in its URL would otherwise
/// be filed and drawn as an anonymous blob.
pub fn extension_for_type(content_type: &str) -> Option<&'static str> {
    Some(match content_type {
        "video/mp4" => "mp4",
        "video/webm" => "webm",
        "video/x-matroska" => "mkv",
        "video/quicktime" => "mov",
        "video/x-msvideo" => "avi",
        "video/x-flv" | "video/flv" => "flv",
        "video/mp2t" => "ts",
        "video/3gpp" => "3gp",
        "video/ogg" => "ogv",
        "video/x-ms-wmv" => "wmv",
        "video/mpeg" => "mpg",
        "audio/mpeg" | "audio/mp3" => "mp3",
        "audio/mp4" | "audio/x-m4a" | "audio/m4a" => "m4a",
        "audio/aac" | "audio/aacp" => "aac",
        "audio/opus" => "opus",
        "audio/webm" => "weba",
        "audio/ogg" => "ogg",
        "audio/wav" | "audio/x-wav" | "audio/wave" => "wav",
        "audio/flac" | "audio/x-flac" => "flac",
        "audio/x-ms-wma" => "wma",
        "audio/midi" | "audio/x-midi" => "mid",
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/svg+xml" => "svg",
        "image/bmp" | "image/x-ms-bmp" => "bmp",
        "image/x-icon" | "image/vnd.microsoft.icon" => "ico",
        "image/tiff" => "tif",
        "image/avif" => "avif",
        "image/heic" | "image/heif" => "heic",
        "application/pdf" => "pdf",
        "application/rtf" | "text/rtf" => "rtf",
        "application/zip" | "application/x-zip-compressed" => "zip",
        "application/x-7z-compressed" => "7z",
        "application/x-rar-compressed" | "application/vnd.rar" => "rar",
        "application/gzip" | "application/x-gzip" => "gz",
        "application/x-tar" => "tar",
        "application/x-bzip2" => "bz2",
        "application/x-xz" => "xz",
        "application/zstd" => "zst",
        "application/x-iso9660-image" => "iso",
        "application/x-msdownload"
        | "application/vnd.microsoft.portable-executable"
        | "application/x-msdos-program"
        | "application/exe" => "exe",
        "application/x-msi" | "application/x-ms-installer" => "msi",
        "application/x-apple-diskimage" => "dmg",
        "application/vnd.debian.binary-package" | "application/x-debian-package" => "deb",
        "application/x-rpm" | "application/x-redhat-package-manager" => "rpm",
        "application/vnd.android.package-archive" => "apk",
        "application/java-archive" => "jar",
        "application/x-bittorrent" => "torrent",
        "application/vnd.microsoft.portable-executable-appx" | "application/appx" => "appx",
        "application/json" => "json",
        "application/xml" | "text/xml" => "xml",
        "application/x-sh" | "application/x-shellscript" => "sh",
        "application/epub+zip" => "epub",
        "application/msword" => "doc",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" => "docx",
        "application/vnd.ms-excel" => "xls",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" => "xlsx",
        "application/vnd.ms-powerpoint" => "ppt",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation" => "pptx",
        "application/vnd.oasis.opendocument.text" => "odt",
        "application/vnd.oasis.opendocument.spreadsheet" => "ods",
        "application/vnd.oasis.opendocument.presentation" => "odp",
        "text/csv" => "csv",
        "text/markdown" => "md",
        "text/plain" => "txt",
        "text/vtt" => "vtt",
        "application/x-subrip" => "srt",
        _ => return None,
    })
}

/// The first `SNIFF_BYTES` of a file on disk, or nothing if it cannot be read.
pub async fn read_head(path: &Path) -> Vec<u8> {
    let Ok(mut file) = tokio::fs::File::open(path).await else {
        return Vec::new();
    };
    let mut head = vec![0u8; SNIFF_BYTES];
    let mut filled = 0;
    while filled < head.len() {
        match file.read(&mut head[filled..]).await {
            Ok(0) | Err(_) => break,
            Ok(read) => filled += read,
        }
    }
    head.truncate(filled);
    head
}

#[cfg(test)]
mod tests {
    use super::*;

    const EXE: &[u8] = b"MZ\x90\0\x03\0\0\0\x04\0\0\0\xff\xff\0\0";
    const MP4: &[u8] = b"\0\0\0\x20ftypisom\0\0\x02\0isomiso2avc1mp41";
    const TEXT: &[u8] = b"export const answer: number = 42;\n";

    /// The answer for the very common CDN that names nothing and declares
    /// nothing: `/asset/9f8a7b`, `application/octet-stream`, and the bytes.
    #[test]
    fn reads_the_type_out_of_the_bytes_themselves() {
        for (head, want) in [
            (b"%PDF-1.7\n".as_slice(), "pdf"),
            (b"PK\x03\x04\x14\0", "zip"),
            (b"\x89PNG\r\n\x1a\n", "png"),
            (b"\xff\xd8\xff\xe0", "jpg"),
            (b"ID3\x04\0\0", "mp3"),
            (b"fLaC\0\0\0\"", "flac"),
            (b"OggS\0\x02\0\0", "ogg"),
            (b"\x1f\x8b\x08\0", "gz"),
            (b"Rar!\x1a\x07\x01\0", "rar"),
            (b"MZ\x90\0\x03", "exe"),
            (b"\0\0\0\x20ftypisom\0\0\x02\0", "mp4"),
            (b"\0\0\0\x20ftypM4A \0\0\0\0", "m4a"),
            (b"RIFF\x24\x08\0\0WAVEfmt ", "wav"),
            (b"RIFF\x24\x08\0\0WEBPVP8 ", "webp"),
        ] {
            assert_eq!(sniff(head), Some(want), "{want}");
        }

        // Matroska and WebM are the same container; only the DocType separates
        // them, and guessing wrong names a video file after the wrong format.
        assert_eq!(sniff(b"\x1a\x45\xdf\xa3\x01\0\0\0\x1fB\x82\x84webm"), Some("webm"));
        assert_eq!(sniff(b"\x1a\x45\xdf\xa3\x01\0\0\0\x1fB\x82\x88matroska"), Some("mkv"));

        // And it declines rather than guessing, which is what keeps `.bin`
        // honest for the things it really is.
        assert_eq!(sniff(b"\0\0\0\0\0\0\0\0"), None);
        assert_eq!(sniff(b""), None);
    }

    #[test]
    fn tells_data_from_text() {
        assert!(looks_binary(EXE));
        assert!(looks_binary(b"\x7fELF\x02\x01\x01\0"));
        assert!(!looks_binary(TEXT));
        assert!(!looks_binary("سلام دنیا\n".as_bytes()));
        // Nothing arrived: not evidence either way.
        assert!(!looks_binary(b""));
    }

    /// The bug the user reported, from the classifier's side: an installer is
    /// not a video whatever the server or the toggle says about it.
    #[test]
    fn an_installer_is_never_media() {
        assert_eq!(classify(Some("exe"), Some("video/mp4"), None), None);
        assert_eq!(classify(Some("exe"), None, Some(EXE)), None);
        assert_eq!(classify(Some("unknown_video"), None, Some(EXE)), None);
        assert_eq!(classify(None, Some("application/octet-stream"), Some(EXE)), None);
        // Even named like a video: the bytes say what it is.
        assert_eq!(classify(Some("mp4"), Some("video/mp4"), Some(EXE)), None);
    }

    #[test]
    fn media_is_media_by_any_honest_route() {
        assert_eq!(classify(Some("mp4"), None, None), Some(MediaClass::Video));
        assert_eq!(classify(None, None, Some(MP4)), Some(MediaClass::Video));
        assert_eq!(classify(None, Some("audio/mpeg"), None), Some(MediaClass::Audio));
        assert_eq!(classify(Some("xyz"), Some("video/webm"), None), Some(MediaClass::Video));
        // A DASH audio track sniffs as mp4; its name is the more specific claim.
        assert_eq!(classify(Some("m4a"), None, Some(MP4)), Some(MediaClass::Audio));
    }

    #[test]
    fn text_is_never_media() {
        // TypeScript source, not an MPEG transport stream.
        assert_eq!(classify(Some("ts"), None, Some(TEXT)), None);
        // Nothing read yet: the name still counts.
        assert_eq!(classify(Some("ts"), None, None), Some(MediaClass::Video));
    }

    #[test]
    fn a_real_extension_is_kept() {
        assert_eq!(best_extension(Some("msi"), None, Some(EXE)).as_deref(), Some("msi"));
        assert_eq!(best_extension(Some("docx"), Some("application/zip"), Some(b"PK\x03\x04")).as_deref(), Some("docx"));
    }

    #[test]
    fn a_placeholder_extension_is_replaced_by_evidence() {
        assert_eq!(best_extension(Some("unknown_video"), None, Some(EXE)).as_deref(), Some("exe"));
        assert_eq!(best_extension(Some("bin"), Some("application/zip"), None).as_deref(), Some("zip"));
        assert_eq!(
            best_extension(Some("unknown_video"), None, Some(b"<!DOCTYPE html><html>")).as_deref(),
            Some("html")
        );
        // Nothing better known: the placeholder stays, and the caller decides.
        assert_eq!(best_extension(Some("bin"), None, Some(b"\0\x01\x02\x03")).as_deref(), Some("bin"));
    }

    #[test]
    fn a_script_extension_is_the_server_not_the_file() {
        assert_eq!(best_extension(Some("php"), Some("application/zip"), None).as_deref(), Some("zip"));
        assert_eq!(
            best_extension(Some("php"), Some("application/octet-stream"), Some(EXE)).as_deref(),
            Some("exe")
        );
        assert_eq!(
            best_extension(Some("aspx"), Some("application/octet-stream"), Some(b"\0\x01\x02")).as_deref(),
            Some("bin")
        );
        // Served as text, it may really be PHP.
        assert_eq!(best_extension(Some("php"), Some("text/plain"), Some(b"<?php echo 1;")).as_deref(), Some("php"));
    }

    #[test]
    fn with_no_name_the_response_and_the_bytes_decide() {
        assert_eq!(best_extension(None, Some("video/mp4"), None).as_deref(), Some("mp4"));
        assert_eq!(best_extension(None, Some("application/octet-stream"), Some(b"%PDF-1.4")).as_deref(), Some("pdf"));
        // zip-based formats name themselves by type; the bytes only say "zip".
        assert_eq!(
            best_extension(None, Some("application/vnd.android.package-archive"), Some(b"PK\x03\x04")).as_deref(),
            Some("apk")
        );
        // The bytes win a real disagreement.
        assert_eq!(best_extension(None, Some("video/mp4"), Some(EXE)).as_deref(), Some("exe"));
        assert_eq!(best_extension(None, None, Some(b"\0\x01")), None);
    }

    #[test]
    fn a_version_number_is_not_an_extension() {
        // "report.v1 final" would otherwise be saved with an extension of
        // "v1 final", which nothing will open.
        let (stem, ext) = split_name("report.v1 final");
        assert_eq!(stem, "report.v1 final");
        assert_eq!(ext, None);

        let (stem, ext) = split_name("archive.TAR");
        assert_eq!(stem, "archive");
        assert_eq!(ext.as_deref(), Some("tar"));

        // yt-dlp's word for "I could not name this" is recognised, so it can
        // be replaced.
        let (stem, ext) = split_name("1645817e.unknown_video");
        assert_eq!(stem, "1645817e");
        assert_eq!(ext.as_deref(), Some("unknown_video"));
    }

    #[test]
    fn names_the_types_a_download_is_now_allowed_to_be() {
        for (content_type, want) in [
            ("application/vnd.android.package-archive", "apk"),
            ("application/x-msi", "msi"),
            ("application/x-iso9660-image", "iso"),
            ("application/x-tar", "tar"),
            ("application/x-rpm", "rpm"),
            ("text/csv", "csv"),
            (
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "xlsx",
            ),
        ] {
            assert_eq!(extension_for_type(content_type), Some(want), "{content_type}");
        }

        // Still declines to guess, so these keep falling through to `.bin`.
        assert_eq!(extension_for_type("application/octet-stream"), None);
    }

    #[tokio::test]
    async fn reads_only_the_head_of_a_file() {
        let path = std::env::temp_dir().join(format!("mt-filetype-{}.bin", std::process::id()));
        let mut body = EXE.to_vec();
        body.resize(4096, 7);
        tokio::fs::write(&path, &body).await.unwrap();

        let head = read_head(&path).await;
        assert_eq!(head.len(), SNIFF_BYTES);
        assert_eq!(sniff(&head), Some("exe"));

        tokio::fs::remove_file(&path).await.unwrap();
        assert!(read_head(&path).await.is_empty(), "a missing file reads as nothing");
    }
}
