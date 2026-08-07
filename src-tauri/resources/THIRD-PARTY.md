# Third-party software bundled with this application

This app ships three external programs inside its installer. It does not
modify them; it runs them as separate processes.

## FFmpeg / ffprobe — GPL-3.0-or-later

Used for every media operation (compress, trim, convert, GIF) and for
reading media metadata.

- Build: `n8.1-latest`, GPL configuration, from
  <https://github.com/BtbN/FFmpeg-Builds> (Windows and Linux) and
  <https://ffmpeg.martin-riedl.de> (macOS).
- Upstream source: <https://github.com/FFmpeg/FFmpeg>
- Build recipe for the exact binaries shipped:
  <https://github.com/BtbN/FFmpeg-Builds>
- Full license text: `LICENSE-ffmpeg.txt`, installed next to the binaries.

**Why GPL and not LGPL:** the GPL configuration is the one that includes
libx264 and libx265. Without them there is no H.264 or H.265 encoder, which
would leave the compress and convert tools with nothing to encode
with. Linking them makes the distributed work GPL-3.0-or-later.

**Consequence:** because this application is distributed together with a
GPL-licensed FFmpeg, the combined distribution is covered by GPL-3.0-or-later,
and the corresponding source for FFmpeg must remain available to recipients.
The links above satisfy that. Do not switch this app to a closed-source
license without first replacing the bundled FFmpeg build.

## yt-dlp — Unlicense (public domain)

Used to download media from the web.

- Source: <https://github.com/yt-dlp/yt-dlp>
- The standalone build is bundled so the app does not require a system Python
  installation.

## Bundled fonts — SIL Open Font License 1.1

Two font files ship inside the application bundle, under
`src/assets/fonts/`. Neither is modified; each is the upstream `woff2` subset.

| Face | Used for | Source |
|---|---|---|
| Inter | the interface, Latin | <https://github.com/rsms/inter> |
| Vazirmatn | the interface, Arabic script | <https://github.com/rastikerdar/vazirmatn> |

The OFL permits bundling and redistribution inside an application, including
a GPL-licensed one, provided the fonts are not sold on their own and keep
their names. Full license text: <https://openfontlicense.org>.

---

The exact URL, SHA-256, and byte count of every binary in a given build are
recorded in `binaries/.tools.json`, written by `build.rs` at build time. The
pinned sources live in `src-tauri/tools.lock.json`.
