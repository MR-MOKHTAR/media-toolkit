# Media Toolkit

A small desktop app for the two things people actually need to do with a video:
get it, and change it. Download from the web, then compress, trim, convert it,
or pull its audio out.

Built for people who do not want to think about codecs. Every tool is one file
picker, two or three choices, and a button. There is no bitrate field anywhere.

`yt-dlp` and `FFmpeg` ship inside the installer, so nothing else has to be
installed and everything except downloading works offline.

Deno used to ship with them, for the JavaScript runtime yt-dlp wants in order to
answer YouTube's player challenge. It was 95 MB unpacked — two thirds of the
installer — and measuring it against a 4K YouTube video showed `yt-dlp -J`
returning the same 53 formats and choosing the same 1080p H.264 + m4a pair with
it and without it. So it is not bundled. The app looks for `deno`, `node`, `bun`
or `quickjs` on the machine and points yt-dlp at whichever it finds; Settings
shows which one that was, and downloads work when it finds none.

## Tools

| | |
|---|---|
| **Download** | Paste a link — any link, and the field takes it in whatever shape it arrived: with a sentence around it, or with no `https://` in front. The form fills itself from the clipboard when it opens. A page goes to yt-dlp, which handles the ~1000 sites it supports and shows the title, channel, duration and thumbnail first. A link that already points at a file — an installer, an archive, a PDF, a direct MP4 — is fetched by the app itself on eight connections, with its real name and exact size shown before you commit; a server that names neither the file nor its type is identified from the file's own first bytes. Video *and* audio pages are fetched the same way: yt-dlp resolves the streams, the app pulls them on eight ranged connections, and FFmpeg merges or encodes — measured at 1.5× a single connection on a healthy line and up to 10× against a throttled one. An audio download keeps the track the site served rather than re-encoding it — the same argument Extract audio already makes, applied to the download that fetched the stream; MP3 is one switch away in Settings for whatever insists on it. A link that names a playlist — the whole page, or the `list=` on a single video — asks which you meant, and *Whole playlist* queues every video as its own download, four at a time, capped at 100. Every running download shows its size, its speed and how much longer it has. Interrupted downloads resume rather than restart. |
| **Compress** | Three things in one place, because they are the same question: quality (Small / Balanced / High), resolution (Original / 1080p / 720p / 480p, with anything at or above the source disabled), and an optional size to land under. The estimated output size updates as you change either of the first two, so the trade is visible before anything runs. |
| **Trim** | Drag two handles over a timeline. Cuts losslessly by default, which is instant; *Exact cut* re-encodes when you need the exact frame you asked for. |
| **Convert** | MP4, MKV, MOV, WebM, MP3, M4A, WAV — one grid, whichever the file needs. When the streams can be copied into the new container the app says so and finishes in about a second. |
| **Extract audio** | The soundtrack of a video, on its own. *Original* copies the track out untouched — instant, and lossless, because the audio inside an MP4 is already a finished AAC file; MP3, M4A and WAV are there for when something downstream insists. The app only offers the lossless option for files whose codec it has a container for. |

Jobs run concurrently and each reports its own progress. FFmpeg work is capped
by a semaphore, so four compressions cannot make the app itself unresponsive.

A download that fails, is cancelled, or is cut off by the app closing keeps its
`.part` file and comes back with a **Download again** button beside it. Pressing
it continues from where the transfer stopped — both engines resume, so a
download that died at 95% costs seconds rather than starting over.

## Where files go

Everything the app produces lands in one folder it owns —
`~/Downloads/Media Toolkit` — sorted into `Video`, `Audio`, `Files`,
`Compressed`, `Trimmed`, and `Converted`. Extracted audio joins audio downloads
on the `Audio` shelf — both are audio files this app made, and which tool
produced one is not what anybody looks for it under.
Nothing is written loose into Downloads beside your own files.

Settings moves that folder, flattens it into a single directory, or switches the
editing tools back to writing next to the file they opened. The choice is stored
in `settings.json` next to the API key, so it survives a restart; picking a
folder on a tool screen still overrides it for that one job.

## Languages

English, Persian, and Arabic, with full RTL. Inter and Vazirmatn are bundled as
variable fonts — no network request at runtime, and mixed strings like
`دانلود clip_final.mp4` render correctly per character from a single stack. Both
are SIL OFL.

Timecodes, sizes, and file paths stay in ASCII digits and LTR even in RTL
layouts, because Persian digits in an `mm:ss` field are unreadable.

## Development

```sh
bun install
bun run tauri dev
```

The first build downloads yt-dlp and FFmpeg into `src-tauri/binaries/`
(~215 MB unpacked). After that they are cached; `build.rs` re-fetches only when
the pinned URL in `src-tauri/tools.lock.json` changes.

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
  app/            routing — a state machine, not a router (7 screens, no URLs)
  lib/            ipc.ts is the single Tauri boundary
  components/     ui primitives, layout, feedback
  features/
    downloads/    download screen
    media/        components/MediaToolForm.tsx is the form; tools/ is the
                  four tools as data — controls, readiness, request
    tools/        the shape every tool screen shares: the list is the page and
                  the form is a dialog over it
    jobs/         job queue, reducer, persistence
    settings/
  i18n/locales/   en, fa, ar
src-tauri/src/
  binaries.rs     tool resolution: app data dir -> bundled resources -> PATH,
                  plus the optional JS runtime lookup
  download.rs     URL normalisation, engine choice, and the yt-dlp engine
  direct.rs       the HTTP engine: parallel ranges, resume, any file type,
                  and the content sniffing that names one
  muxed.rs        the fast path: yt-dlp resolves, direct.rs fetches, ffmpeg
                  merges or encodes -- and declines anything fragmented or live
  library.rs      the app's storage folder and its per-tool layout
  jobs.rs         job registry, cancellation, CPU/network semaphores
  process.rs      spawn + concurrent stdout/stderr drain
  media/          probe, ffmpeg runner, and the four operations
```

The four ffmpeg tools share one screen. `MediaToolScreen` draws the form — file,
preview, controls, output folder, run — and each tool in `features/media/tools/`
contributes only its own controls, its readiness rule, and the request it
builds. Adding a tool is a file there and a line in `tools/index.ts`.

## Licensing

The bundled FFmpeg is the **GPL** configuration, because that is the build that
includes libx264 and libx265 — without them, compress and convert have
nothing to encode with.

Distributing this app together with that FFmpeg makes the combined distribution
GPL-3.0-or-later, so **this project is licensed GPL-3.0-or-later** — see
[`LICENSE`](LICENSE). Relicensing would mean first swapping the bundled FFmpeg
for an LGPL build, which has no H.264/H.265 encoder.

See [`src-tauri/resources/THIRD-PARTY.md`](src-tauri/resources/THIRD-PARTY.md)
for the source offer and the exact builds shipped. The URL, SHA-256, and size of
every bundled binary is recorded in `src-tauri/binaries/.tools.json` at build
time.
