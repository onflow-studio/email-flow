"use client";

import { Pause, Play, RotateCw } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { cn } from "@/lib/utils";

/**
 * Background audio from YouTube, with a station list that opens on hover,
 * keyboard focus or a tap. Mounted in the root layout so it survives
 * client-side navigation. Nothing loads from YouTube until the first play,
 * which also satisfies the autoplay policy.
 */
type Station = { id: string; label: string } & ({ video: string } | { playlist: string });

const STATIONS: Station[] = [
  { id: "hacker", label: "hacker radio", video: "sjSnCKudqj0" },
  { id: "gamma", label: "40hz gamma", video: "tAIiXRZNh9E" },
  { id: "techno", label: "minimal techno", video: "ujrBG09lcYY" },
  { id: "deep-work", label: "deep work mix", video: "UDTmUzu05BE" },
  { id: "brainfm", label: "brain.fm sessions", playlist: "PLm1EodmV4HIjT0EjDGKFsWU5vOidU2rtW" },
];

const API_SRC = "https://www.youtube.com/iframe_api";
const API_TIMEOUT_MS = 15_000;
// YouTube refuses to play in players smaller than 200px.
const PLAYER_SIZE = 200;
// DESIGN.md: long enough to cross from the button to the list without it closing.
const CLOSE_DELAY_MS = 150;
const STORAGE_KEY = "radio-station";

// The slice of the IFrame API used here.
type YTPlayer = {
  playVideo(): void;
  pauseVideo(): void;
  loadVideoById(id: string): void;
  loadPlaylist(options: { list: string; listType: "playlist" }): void;
  setShuffle(shuffle: boolean): void;
  setLoop(loop: boolean): void;
  destroy(): void;
};
type YTNamespace = {
  Player: new (
    el: HTMLElement,
    options: {
      width: number;
      height: number;
      playerVars: Record<string, number>;
      events: {
        onReady: () => void;
        onStateChange: (e: { data: number }) => void;
        onError: (e: { data: number }) => void;
      };
    },
  ) => YTPlayer;
};
declare global {
  interface Window {
    YT?: YTNamespace & { loaded?: number };
    onYouTubeIframeAPIReady?: () => void;
  }
}

const YT_PLAYING = 1;
const YT_BUFFERING = 3;

let apiPromise: Promise<YTNamespace> | null = null;

function loadApi(): Promise<YTNamespace> {
  if (window.YT?.loaded) return Promise.resolve(window.YT);
  apiPromise ??= new Promise<YTNamespace>((resolve, reject) => {
    const script = document.createElement("script");
    const fail = () => {
      clearTimeout(timer);
      script.remove();
      apiPromise = null;
      reject(new Error("youtube api failed to load"));
    };
    const timer = setTimeout(fail, API_TIMEOUT_MS);
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      clearTimeout(timer);
      resolve(window.YT!);
    };
    script.src = API_SRC;
    script.async = true;
    script.onerror = fail;
    document.head.appendChild(script);
  });
  return apiPromise;
}

function tune(player: YTPlayer, station: Station) {
  if ("video" in station) {
    player.loadVideoById(station.video);
  } else {
    player.loadPlaylist({ list: station.playlist, listType: "playlist" });
  }
}

// The chosen station, persisted per browser. The in-memory copy covers storage that throws.
let chosen: string | null = null;
const stationListeners = new Set<() => void>();

function readStation() {
  if (chosen) return chosen;
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveStation(id: string) {
  chosen = id;
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {}
  stationListeners.forEach((l) => l());
}

function subscribeStation(listener: () => void) {
  stationListeners.add(listener);
  return () => stationListeners.delete(listener);
}

/** Dispatched on window by the palette's `toggle radio` action. */
export const RADIO_TOGGLE_EVENT = "superfer:radio-toggle";

type Status = "idle" | "loading" | "playing" | "paused" | "buffering" | "error";

export function Radio() {
  const [status, setStatus] = useState<Status>("idle");
  const [open, setOpen] = useState(false);
  const storedId = useSyncExternalStore(subscribeStation, readStation, () => null);
  const station = STATIONS.find((s) => s.id === storedId) ?? STATIONS[0];

  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  // Read by onReady, which may fire after a station change made during loading.
  const stationRef = useRef(station);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hovered = useRef(false);
  const lastPointer = useRef("mouse");
  // Shuffle and loop only take once a playlist is loaded, so they wait for its first play.
  const shufflePending = useRef(false);
  // Opened or driven from the keyboard: then leaving with the mouse does not close it.
  const viaKeyboard = useRef(false);
  // An option to focus once the list has rendered, set when an arrow key opens it.
  const pendingFocus = useRef<number | null>(null);

  useEffect(() => {
    stationRef.current = station;
  }, [station]);

  useEffect(
    () => () => {
      clearTimeout(closeTimer.current);
      playerRef.current?.destroy();
    },
    [],
  );

  useEffect(() => {
    if (!open || pendingFocus.current === null) return;
    optionRefs.current[pendingFocus.current]?.focus();
    pendingFocus.current = null;
  }, [open]);

  // Esc and outside presses close the list. Capture phase, so the mail keymap never sees this esc.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      const inside = rootRef.current?.contains(document.activeElement);
      setOpen(false);
      if (inside) buttonRef.current?.focus();
    };
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const tuneTo = (player: YTPlayer, next: Station) => {
    shufflePending.current = "playlist" in next;
    tune(player, next);
  };

  const start = async () => {
    setStatus("loading");
    playerRef.current?.destroy();
    playerRef.current = null;
    try {
      const YT = await loadApi();
      // The API replaces the element it is given, so hand it a fresh child.
      const el = document.createElement("div");
      hostRef.current!.replaceChildren(el);
      playerRef.current = new YT.Player(el, {
        width: PLAYER_SIZE,
        height: PLAYER_SIZE,
        playerVars: { autoplay: 1, controls: 0, disablekb: 1, playsinline: 1 },
        events: {
          onReady: () => playerRef.current && tuneTo(playerRef.current, stationRef.current),
          onStateChange: ({ data }) => {
            if (data === YT_PLAYING && shufflePending.current) {
              shufflePending.current = false;
              playerRef.current?.setShuffle(true);
              playerRef.current?.setLoop(true);
            }
            setStatus(data === YT_PLAYING ? "playing" : data === YT_BUFFERING ? "buffering" : "paused");
          },
          onError: () => setStatus("error"),
        },
      });
    } catch {
      setStatus("error");
    }
  };

  const toggle = () => {
    const player = playerRef.current;
    if (status === "loading") return;
    if (status === "idle" || status === "error" || !player) void start();
    else if (status === "playing" || status === "buffering") player.pauseVideo();
    else if (status === "paused") player.playVideo();
  };

  const choose = (next: Station) => {
    setOpen(false);
    buttonRef.current?.focus();
    const player = playerRef.current;
    const live = player && status !== "idle" && status !== "error";
    if (next.id === station.id) {
      // Same station: just make sure it plays.
      if (!live) void start();
      else if (status === "paused") player.playVideo();
      return;
    }
    saveStation(next.id);
    stationRef.current = next;
    if (status === "loading") return; // onReady tunes to stationRef
    if (live) {
      setStatus("buffering");
      tuneTo(player, next);
    } else void start();
  };

  const toggleRef = useRef(toggle);
  useEffect(() => {
    toggleRef.current = toggle;
  });
  useEffect(() => {
    const onToggle = () => toggleRef.current();
    window.addEventListener(RADIO_TOGGLE_EVENT, onToggle);
    return () => window.removeEventListener(RADIO_TOGGLE_EVENT, onToggle);
  }, []);

  const openNow = () => {
    clearTimeout(closeTimer.current);
    setOpen(true);
  };

  const closeSoon = () => {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      if (!viaKeyboard.current) setOpen(false);
    }, CLOSE_DELAY_MS);
  };

  const focusOption = (index: number) => {
    const n = STATIONS.length;
    optionRefs.current[(index + n) % n]?.focus();
  };

  const onButtonKey = (e: React.KeyboardEvent) => {
    viaKeyboard.current = true;
    if (e.key === "Enter" || e.key === " ") {
      // Handled here so the mail keymap's `enter` never fires alongside.
      e.preventDefault();
      toggle();
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const current = STATIONS.indexOf(station);
      if (open) focusOption(current);
      else {
        pendingFocus.current = current;
        openNow();
      }
    }
  };

  const onOptionKey = (e: React.KeyboardEvent, index: number) => {
    viaKeyboard.current = true;
    const moves: Record<string, number> = { ArrowUp: index - 1, ArrowDown: index + 1, Home: 0, End: STATIONS.length - 1 };
    if (e.key in moves) {
      e.preventDefault();
      focusOption(moves[e.key]);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(STATIONS[index]);
    }
  };

  const on = status === "playing" || status === "buffering" || status === "loading";
  // The accessible name stays put; aria-pressed carries play vs pause.
  const label = status === "error" ? "radio failed, retry" : "radio";
  const Icon = status === "error" ? RotateCw : on ? Pause : Play;

  return (
    <>
      <div
        ref={rootRef}
        className="fixed right-4 bottom-radio z-30 flex flex-col items-end"
        onPointerEnter={(e) => {
          if (e.pointerType !== "mouse") return;
          hovered.current = true;
          viaKeyboard.current = false;
          openNow();
        }}
        onPointerLeave={(e) => {
          if (e.pointerType !== "mouse") return;
          hovered.current = false;
          closeSoon();
        }}
        onBlur={(e) => {
          if (!hovered.current && !e.currentTarget.contains(e.relatedTarget)) setOpen(false);
        }}
      >
        {open ? (
          // pb-2 rather than a margin, so the gap to the button stays inside the hover area.
          <div className="pb-2">
            <div role="menu" aria-label="stations" className="flex flex-col rounded-md border border-border bg-surface-top py-1">
              {STATIONS.map((s, i) => {
                const current = s.id === station.id;
                return (
                  <button
                    key={s.id}
                    ref={(el) => {
                      optionRefs.current[i] = el;
                    }}
                    type="button"
                    role="menuitemradio"
                    aria-checked={current}
                    tabIndex={-1}
                    onClick={() => choose(s)}
                    onKeyDown={(e) => onOptionKey(e, i)}
                    onPointerMove={(e) => {
                      if (e.pointerType === "mouse") e.currentTarget.focus({ preventScroll: true });
                    }}
                    className={cn(
                      "flex h-touch items-center gap-4 border-l-2 border-transparent pr-3 pl-2 text-left whitespace-nowrap text-text-muted outline-none transition-colors duration-80 ease-snap md:h-row",
                      "focus:glow-focus focus:border-accent focus:bg-surface-raised focus:text-text",
                      current && "text-text",
                    )}
                  >
                    <span className="flex-1">{s.label}</span>
                    {current ? <span className="text-11 text-text-muted">tuned</span> : null}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
        <button
          ref={buttonRef}
          type="button"
          onPointerDown={(e) => {
            lastPointer.current = e.pointerType;
          }}
          onClick={() => {
            // Touch has no hover: the first tap opens the list, the next one plays or pauses.
            if (lastPointer.current === "touch" && !open) openNow();
            else toggle();
            lastPointer.current = "mouse";
          }}
          onFocus={(e) => {
            if (!e.currentTarget.matches(":focus-visible")) return;
            viaKeyboard.current = true;
            openNow();
          }}
          onKeyDown={onButtonKey}
          aria-label={label}
          aria-pressed={on}
          aria-haspopup="menu"
          aria-expanded={open}
          title={status === "error" ? label : `${on ? "pause" : "play"} ${station.label}`}
          className={cn(
            "flex size-touch items-center justify-center rounded-sm border border-border bg-surface-raised text-text-muted transition-colors duration-80 ease-snap outline-none hover:text-text focus-visible:border-accent md:size-row",
            on && "text-text",
            status === "error" && "text-danger hover:text-danger",
          )}
        >
          <Icon
            aria-hidden
            className={cn("size-3", (status === "loading" || status === "buffering") && "animate-pulse text-text-dim")}
            strokeWidth={1.5}
          />
        </button>
      </div>
      {/* Clipped to 1px rather than display:none, which stops playback. Inert keeps the iframe out of tab order. */}
      <div inert className="fixed right-0 bottom-0 size-px overflow-hidden opacity-0">
        <div ref={hostRef} />
      </div>
    </>
  );
}
