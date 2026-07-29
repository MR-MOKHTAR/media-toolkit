# Media Toolkit

A small desktop app for the two things people actually need to do with a video:
get it, and change it. Download from the web, then compress, trim, convert,
resize, or turn a clip into a GIF.

Built for people who do not want to think about codecs. Every tool is one file
picker, two or three choices, and a button. There is no bitrate field anywhere.

`yt-dlp` and `FFmpeg` ship inside the installer, so nothing else has to be
installed and everything except downloading works offline.

## Tools

| | |
|---|---|
| **Download** | Paste a link. Works with the ~1000 sites yt-dlp supports, not just YouTube. Shows the title, channel, duration, and thumbnail before you commit. Video or audio, with a quality picker. |
| **Compress** | Small / Balanced / High quality, with an estimated output size shown before you start. Target-size chips (10 / 25 / 50 MB) sit behind *Advanced*, for when something has to fit an upload limit. |
| **Trim** | Drag two handles over a timeline. Cuts losslessly by default, which is instant; *Exact cut* re-encodes when you need the exact frame you asked for. |
| **Convert** | MP4, MKV, MOV, WebM, MP3, M4A, WAV. Picking an audio format *is* how you extract audio — there is no separate mode for it. When the streams can be copied the app says so and finishes in about a second. |
| **Resize** | 1080p / 720p / 480p, with options at or above the source resolution disabled. |
| **GIF** | A range plus two presets. Two-pass palette generation, so the result does not look like 1998. |

Jobs run concurrently and each reports its own progress. FFmpeg work is capped
by a semaphore, so four compressions cannot make the app itself unresponsive.

## Languages

English, Persian, and Arabic, with full RTL. Inter and Vazirmatn are bundled as
variable fonts — no network request at runtime, and mixed strings like
`دانلود clip_final.mp4` render correctly per character from a single stack.

Timecodes, sizes, and file paths stay in ASCII digits and LTR even in RTL
layouts, because Persian digits in an `mm:ss` field are unreadable.

## Development

```sh
bun install
bun run tauri dev
```

The first build downloads yt-dlp and FFmpeg (~200 MB) into `src-tauri/binaries/`.
After that they are cached; `build.rs` re-fetches only when the pinned URL in
`src-tauri/tools.lock.json` changes.

```sh
bun run build          # typecheck + bundle the frontend
bun run check:i18n     # locale parity, placeholders, unused keys
cargo test             # from src-tauri/
bun run tauri build    # installers
```

Environment variables for the build:

- `DOWNLOADER_SKIP_TOOL_FETCH=1` — never touch the network (airgapped dev)
- `DOWNLOADER_FORCE_TOOL_FETCH=1` — re-download the tools, ignoring the cache

## Layout

```
src/
  app/            routing — a state machine, not a router (9 screens, no URLs)
  lib/            ipc.ts is the single Tauri boundary
  components/     ui primitives, layout, feedback
  features/
    home/         the launcher
    downloads/    download screen
    media/        shared tool shell + the five tool screens
    jobs/         job queue, reducer, persistence
    settings/
  i18n/locales/   en, fa, ar
src-tauri/src/
  binaries.rs     tool resolution: app data dir -> bundled resources -> PATH
  jobs.rs         job registry, cancellation, CPU/network semaphores
  process.rs      spawn + concurrent stdout/stderr drain
  media/          probe, ffmpeg runner, and the five operations
```

## Licensing

The bundled FFmpeg is the **GPL** configuration, because that is the build that
includes libx264 and libx265 — without them, compress, convert, and resize have
nothing to encode with.

**Distributing this app together with that FFmpeg makes the combined
distribution GPL-3.0-or-later.** The project has no `LICENSE` file yet; whatever
one is added has to be GPL-compatible, or the bundled FFmpeg has to be swapped
for an LGPL build first (and that build has no H.264/H.265 encoder).

See [`src-tauri/resources/THIRD-PARTY.md`](src-tauri/resources/THIRD-PARTY.md)
for the source offer and the exact builds shipped. The URL, SHA-256, and size of
every bundled binary is recorded in `src-tauri/binaries/.tools.json` at build
time.
