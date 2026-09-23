"use client";

import { Pause, Play, RotateCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Background audio from one YouTube video. Mounted in the root layout so it
 * survives client-side navigation. Nothing loads from YouTube until the first
 * press, which also satisfies the autoplay policy.
 */
const VIDEO_ID = "sjSnCKudqj0";
const API_SRC = "https://www.youtube.com/iframe_api";
const API_TIMEOUT_MS = 15_000;
// YouTube refuses to play in players smaller than 200px.
const PLAYER_SIZE = 200;

// The slice of the IFrame API used here.
type YTPlayer = {
  playVideo(): void;
  pauseVideo(): void;
  destroy(): void;
};
type YTNamespace = {
  Player: new (
    el: HTMLElement,
    options: {
      videoId: string;
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

type Status = "idle" | "loading" | "playing" | "paused" | "buffering" | "error";

export function Radio() {
  const [status, setStatus] = useState<Status>("idle");
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);

  useEffect(() => () => playerRef.current?.destroy(), []);

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
        videoId: VIDEO_ID,
        width: PLAYER_SIZE,
        height: PLAYER_SIZE,
        playerVars: { autoplay: 1, controls: 0, disablekb: 1, playsinline: 1 },
        events: {
          onReady: () => playerRef.current?.playVideo(),
          onStateChange: ({ data }) =>
            setStatus(data === YT_PLAYING ? "playing" : data === YT_BUFFERING ? "buffering" : "paused"),
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

  const on = status === "playing" || status === "buffering" || status === "loading";
  // The accessible name stays put; aria-pressed carries play vs pause.
  const label = status === "error" ? "radio failed, retry" : "radio";
  const Icon = status === "error" ? RotateCw : on ? Pause : Play;

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        aria-label={label}
        aria-pressed={on}
        title={status === "error" ? label : on ? "pause radio" : "play radio"}
        className={cn(
          "fixed right-4 bottom-radio z-30 flex size-touch items-center justify-center rounded-sm border border-border bg-surface-raised text-text-muted transition-colors duration-80 ease-snap outline-none hover:text-text focus-visible:border-accent md:size-row",
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
      {/* Clipped to 1px rather than display:none, which stops playback. Inert keeps the iframe out of tab order. */}
      <div inert className="fixed right-0 bottom-0 size-px overflow-hidden opacity-0">
        <div ref={hostRef} />
      </div>
    </>
  );
}
