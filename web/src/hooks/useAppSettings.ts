import { useCallback, useEffect, useState } from "react";
import { getServerTimezone, subscribeServerTimezone } from "@/api/client";
import { formatDateTime } from "@/utils";

/**
 * App-level display settings, localStorage-backed. Currently only one knob:
 * how server wall-clock timestamps should be rendered.
 *   - "server"  (default): show times exactly as ClickHouse stores them.
 *   - "browser": convert server wall-clock strings into the browser's zone.
 */
export type DisplayTimezone = "server" | "browser";

export interface AppSettings {
  displayTimezone: DisplayTimezone;
}

const DISPLAY_SETTINGS_KEY = "cl-display-settings";

function loadDisplaySettings(): AppSettings {
  try {
    const raw = localStorage.getItem(DISPLAY_SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      if (parsed.displayTimezone === "browser" || parsed.displayTimezone === "server") {
        return { displayTimezone: parsed.displayTimezone };
      }
    }
  } catch {}
  return { displayTimezone: "server" };
}

/**
 * Display-timezone preference + setter. Subscribes to storage changes from
 * other hook instances in the same tab via a tiny listener set.
 */
const settingsListeners = new Set<() => void>();

export function useAppSettings(): { settings: AppSettings; setDisplayTimezone: (tz: DisplayTimezone) => void } {
  const [settings, setSettings] = useState<AppSettings>(loadDisplaySettings);

  useEffect(() => {
    const notify = () => setSettings(loadDisplaySettings());
    settingsListeners.add(notify);
    return () => { settingsListeners.delete(notify); };
  }, []);

  const setDisplayTimezone = useCallback((tz: DisplayTimezone) => {
    try { localStorage.setItem(DISPLAY_SETTINGS_KEY, JSON.stringify({ displayTimezone: tz })); } catch {}
    for (const fn of settingsListeners) fn();
  }, []);

  return { settings, setDisplayTimezone };
}

/**
 * The server's IANA timezone as captured at connect time (empty string when
 * unknown — detection can fail for restricted users; callers should then keep
 * rendering times as stored).
 */
export function useServerTimezone(): string {
  const [tz, setTz] = useState(getServerTimezone);
  useEffect(() => subscribeServerTimezone(() => setTz(getServerTimezone())), []);
  return tz;
}

/**
 * Convert a server wall-clock string ("YYYY-MM-DD HH:MM:SS", or ISO) from the
 * server's timezone into the browser's timezone, returning the same
 * "YYYY-MM-DD HH:MM:SS" shape so it can drop into the existing render paths.
 *
 * Uses the two-pass offset correction: parse the wall clock as if it were UTC,
 * subtract the server zone's offset at that (guessed) instant, then recompute
 * the offset at the corrected instant — the second pass is what makes the
 * result correct across DST boundaries, where the offset at the naive guess
 * differs from the offset at the true instant.
 *
 * TODO(adoption): pages still render server timestamps raw; they will adopt
 * this helper (gated on useAppSettings().displayTimezone === "browser") in a
 * follow-up, so the Layout toggle becomes visibly effective.
 *
 * @param s        server wall-clock string, e.g. "2026-03-08 01:30:00"
 * @param serverTz IANA name of the server zone, e.g. "UTC"
 * @param browserTz IANA name of the target zone; defaults to the browser's
 */
export function serverStringToBrowserString(s: string, serverTz: string, browserTz?: string): string {
  if (!s || !serverTz) return s;
  const normalized = s.includes(" ") && !s.includes("T") ? s.replace(" ", "T") : s;
  // Treat the server wall clock as if it were UTC to get a naive instant.
  const withZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized) ? normalized : `${normalized}Z`;
  const naiveMs = Date.parse(withZone);
  if (Number.isNaN(naiveMs)) return s;

  const target = browserTz || Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Offset of `tz` at instant `utcMs`, in ms (wall-as-UTC minus true UTC).
  const offsetAt = (utcMs: number, tz: string): number => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(utcMs));
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    // en-US may render hour "24" at midnight with hour12:false — fold to 0.
    const h = get("hour") % 24;
    const pad = (n: number) => String(n).padStart(2, "0");
    // ISO parsing needs two-digit month/day, not just the hour fields.
    const asUTC = Date.parse(`${get("year")}-${pad(get("month"))}-${pad(get("day"))}T${pad(h)}:${pad(get("minute"))}:${pad(get("second"))}Z`);
    return asUTC - utcMs;
  };

  // Two passes: the first lands within one offset of the truth, the second
  // corrects for a DST flip between the guess and the true instant.
  let utcMs = naiveMs;
  utcMs = naiveMs - offsetAt(utcMs, serverTz);
  utcMs = naiveMs - offsetAt(utcMs, serverTz);

  // Format the true instant in the target zone with the same shape.
  const out = new Intl.DateTimeFormat("sv-SE", {
    timeZone: target,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).format(new Date(utcMs));
  return out; // sv-SE yields exactly "YYYY-MM-DD HH:MM:SS"
}

/**
 * A formatDateTime that honors the display-timezone setting: in "browser"
 * mode (and when the server zone is known), ClickHouse wall-clock strings
 * are converted into the browser's zone before formatting. This is the
 * adoption point that makes the Layout footer's Globe toggle visibly
 * effective on the query-history surfaces.
 *
 * Returns a stable function per (mode, serverTz) so callers can use it
 * directly in render paths and export builders.
 */
export function useDisplayDateTime(): (s: string) => string {
  const { settings } = useAppSettings();
  const serverTz = useServerTimezone();

  return useCallback(
    (s: string) => {
      let out = s;
      if (settings.displayTimezone === "browser" && serverTz) {
        // Avoid converting twice: formatDateTime parses "YYYY-MM-DD HH:MM:SS"
        // as browser-local, so convert first, then format the converted value.
        out = serverStringToBrowserString(s, serverTz);
        if (out === s) {
          // Conversion failed (unknown zone / unparseable) — fall through
          // and format the original string as stored.
        }
      }
      // Lazy import avoidance: formatDateTime is a tiny pure function.
      return formatDateTime(out);
    },
    [settings.displayTimezone, serverTz]
  );
}
