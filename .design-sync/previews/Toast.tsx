import { Toast } from "downloader";

const at = (seconds: number) => Date.now() + seconds * 1000;

/**
 * Toast positions itself `fixed` against the inline-end edge, so these cells
 * are sized to give the stack somewhere to land rather than wrapping it in a
 * box it would ignore.
 */
export function Stack() {
  return (
    <div className="relative h-72 w-full">
      <Toast
        isRtl={false}
        onDismiss={() => {}}
        toasts={[
          {
            id: "1",
            type: "success",
            message: "Interstellar — docking scene.mp4 finished",
            expiresAt: at(20),
            action: { label: "Show in folder", onClick: () => {} },
          },
          {
            id: "2",
            type: "info",
            message: "Compressing clip.mp4",
            expiresAt: at(20),
          },
        ]}
      />
    </div>
  );
}

export function Tones() {
  return (
    <div className="relative h-72 w-full">
      <Toast
        isRtl={false}
        onDismiss={() => {}}
        toasts={[
          { id: "1", type: "success", message: "Download finished", expiresAt: at(20) },
          { id: "2", type: "info", message: "Fetching video details", expiresAt: at(20) },
          { id: "3", type: "warning", message: "No subtitles for this language", expiresAt: at(20) },
          {
            id: "4",
            type: "error",
            message: "yt-dlp could not read that link",
            expiresAt: at(20),
            action: { label: "Retry", onClick: () => {} },
          },
        ]}
      />
    </div>
  );
}

export function LongTitle() {
  return (
    <div className="relative h-72 w-full">
      <Toast
        isRtl={false}
        onDismiss={() => {}}
        toasts={[
          {
            id: "1",
            type: "success",
            // Clamped to three lines: a video title can be a whole sentence,
            // and one toast must not push the others off screen.
            message:
              "The Making of Blade Runner 2049 — Cinematography, Practical Effects and the Long Road to a Sequel (Extended Cut).mkv finished",
            expiresAt: at(20),
            action: { label: "Show in folder", onClick: () => {} },
          },
        ]}
      />
    </div>
  );
}
