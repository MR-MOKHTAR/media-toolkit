import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "../../components/ui/Button";
import { Field, SectionLabel } from "../../components/ui/Card";
import { Segmented } from "../../components/ui/Segmented";
import { Select } from "../../components/ui/Select";
import { TextInput } from "../../components/ui/TextInput";
import * as ipc from "../../lib/ipc";
import { cn } from "../../lib/cn";
import { formatBytes, formatCount } from "../../lib/format";
import type { ToastType } from "../../types/feedback";
import { describeAppError } from "../jobs/errorText";
import type { NetworkSettings } from "../jobs/types";

type ProxyKind = "off" | "http" | "socks";

/** What the panel shows for a stored proxy URL: its kind, and the rest of it
 *  as typed -- `127.0.0.1:10808`, or `user:pass@host:port`. */
function splitProxy(proxy: string | null): { kind: ProxyKind; address: string } {
  if (!proxy) return { kind: "off", address: "" };
  const [scheme, rest = ""] = proxy.split("://");
  return { kind: scheme.startsWith("socks") ? "socks" : "http", address: rest };
}

/** The URL the backend stores. SOCKS as `socks5h`: names are resolved at the
 *  proxy, which is the one that works where local DNS answers are tampered
 *  with -- and it is what v2rayN and Clash expect. */
function joinProxy(kind: ProxyKind, address: string): string | null {
  const trimmed = address.trim().replace(/^[a-z0-9]+:\/\//i, "");
  if (kind === "off" || !trimmed) return null;
  return `${kind === "socks" ? "socks5h" : "http"}://${trimmed}`;
}

const SLOTS = ["1", "2", "3", "4", "6", "8"] as const;

/** KB/s presets. A free number would invite 0 and 10000000; these are the
 *  figures people actually reach for, and "no limit" is the first of them. */
const LIMITS = ["0", "256", "512", "1024", "2048", "5120", "10240"] as const;

type TestState =
  | { state: "idle" }
  | { state: "testing" }
  | { state: "ok"; latencyMs: number }
  | { state: "failed"; message: string };

/**
 * The connection every download goes through: the proxy, how many at once,
 * and how fast.
 *
 * Stored by the backend rather than in the webview like the download
 * preferences, because the backend is what has to obey them -- yt-dlp and the
 * app's own HTTP client alike, from the first request after launch.
 */
export function NetworkPanel({
  notify,
}: {
  notify: (type: ToastType, message: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const [settings, setSettings] = useState<NetworkSettings | null>(null);
  const [kind, setKind] = useState<ProxyKind>("off");
  const [address, setAddress] = useState("");
  const [saving, setSaving] = useState(false);
  const [test, setTest] = useState<TestState>({ state: "idle" });

  useEffect(() => {
    void ipc
      .getNetworkSettings()
      .then((loaded) => {
        setSettings(loaded);
        const split = splitProxy(loaded.proxy);
        setKind(split.kind);
        setAddress(split.address);
      })
      .catch(() => undefined);
  }, []);

  /** Saves, then shows what the backend says is in force -- a proxy address
   *  it tidied, or the old settings if it refused. */
  const save = async (next: NetworkSettings, success?: string) => {
    setSaving(true);
    try {
      const applied = await ipc.setNetworkSettings(next);
      setSettings(applied);
      const split = splitProxy(applied.proxy);
      setKind(split.kind);
      setAddress(split.address);
      if (success) notify("success", success);
    } catch (error) {
      notify("error", describeProxyError(ipc.toAppError(error)));
    } finally {
      setSaving(false);
    }
  };

  const describeProxyError = (error: ReturnType<typeof ipc.toAppError>) =>
    error.kind === "invalidInput" && error.field === "proxy"
      ? t("proxy_invalid")
      : describeAppError(error, t);

  const proxy = joinProxy(kind, address);
  const proxyChanged = settings !== null && proxy !== settings.proxy;

  const runTest = async () => {
    setTest({ state: "testing" });
    try {
      const result = await ipc.testProxy(proxy);
      setTest({ state: "ok", latencyMs: result.latencyMs });
    } catch (error) {
      setTest({ state: "failed", message: describeProxyError(ipc.toAppError(error)) });
    }
  };

  // A result is about the address it was run against.
  useEffect(() => setTest({ state: "idle" }), [kind, address]);

  if (!settings) return null;

  return (
    <>
      <section className="flex flex-col gap-2">
        <SectionLabel>{t("proxy")}</SectionLabel>
        <Segmented
          label={t("proxy")}
          value={kind}
          onChange={setKind}
          options={[
            { value: "off", label: t("proxy_off") },
            { value: "http", label: "HTTP" },
            { value: "socks", label: "SOCKS5" },
          ]}
        />
        {kind !== "off" && (
          // An address is ltr in every language, like a path.
          <div dir="ltr" className="flex flex-wrap items-center gap-2">
            <TextInput
              aria-label={t("proxy_address")}
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && proxyChanged) {
                  void save({ ...settings, proxy }, t("proxy_saved"));
                }
              }}
              placeholder={kind === "socks" ? "127.0.0.1:10808" : "127.0.0.1:10809"}
              spellCheck={false}
              className="min-w-48 flex-1 tnum"
            />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={saving || !proxyChanged || (kind !== "off" && !address.trim())}
            onClick={() => void save({ ...settings, proxy }, t("proxy_saved"))}
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : null}
            {t("apply")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={test.state === "testing" || (kind !== "off" && !address.trim())}
            onClick={() => void runTest()}
          >
            {test.state === "testing" ? <Loader2 size={14} className="animate-spin" /> : null}
            {t("proxy_test")}
          </Button>
          {test.state === "ok" && (
            <span className="flex items-center gap-1.5 text-sm text-success-text">
              <CheckCircle2 size={15} className="shrink-0" />
              {t("proxy_test_ok", { ms: formatCount(test.latencyMs, i18n.language) })}
            </span>
          )}
          {test.state === "failed" && (
            <span className="flex min-w-0 items-center gap-1.5 text-sm text-danger-text">
              <XCircle size={15} className="shrink-0" />
              <span className="min-w-0">{test.message}</span>
            </span>
          )}
        </div>
        <p className="text-xs text-fg-muted">{t("proxy_hint")}</p>
      </section>

      <section className="flex flex-col gap-2">
        <SectionLabel>{t("simultaneous_downloads")}</SectionLabel>
        <Segmented
          label={t("simultaneous_downloads")}
          value={String(settings.maxDownloads) as (typeof SLOTS)[number]}
          onChange={(value) => void save({ ...settings, maxDownloads: Number(value) })}
          options={SLOTS.map((value) => ({
            value,
            label: formatCount(Number(value), i18n.language),
          }))}
        />
        <p className="text-xs text-fg-muted">{t("simultaneous_downloads_hint")}</p>
      </section>

      <Field label={t("speed_limit")} htmlFor="speed-limit" hint={t("speed_limit_hint")}>
        <Select
          id="speed-limit"
          value={String(Math.round((settings.speedLimit ?? 0) / 1024)) as (typeof LIMITS)[number]}
          onChange={(value) =>
            void save({
              ...settings,
              speedLimit: value === "0" ? null : Number(value) * 1024,
            })
          }
          options={LIMITS.map((value) => ({
            value,
            label:
              value === "0"
                ? t("speed_unlimited")
                : t("speed_per_second", {
                    size: formatBytes(Number(value) * 1024, i18n.language),
                  }),
          }))}
          className={cn(saving && "opacity-disabled")}
        />
      </Field>
    </>
  );
}
