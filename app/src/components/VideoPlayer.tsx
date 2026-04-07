import { useState, useRef, useCallback, useEffect } from "react";

interface VideoPlayerProps {
  src: string;
  autoPlay?: boolean;
}

const SPEED_OPTIONS = [0.5, 1, 1.5, 2, 4];

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function VideoPlayer({ src, autoPlay = false }: VideoPlayerProps) {
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [progress, setProgress] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play();
    } else {
      video.pause();
    }
  }, []);

  const skip = useCallback((seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + seconds));
  }, []);

  const cycleSpeed = useCallback(() => {
    setPlaybackSpeed((prev) => {
      const idx = SPEED_OPTIONS.indexOf(prev);
      const next = SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length];
      if (videoRef.current) videoRef.current.playbackRate = next;
      return next;
    });
  }, []);

  const setSpeed = useCallback((speed: number) => {
    setPlaybackSpeed(speed);
    if (videoRef.current) videoRef.current.playbackRate = speed;
  }, []);

  const handleProgressClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const video = videoRef.current;
    const bar = progressRef.current;
    if (!video || !bar) return;
    const rect = bar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    video.currentTime = pct * video.duration;
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key) {
        case " ":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowLeft":
          e.preventDefault();
          skip(-5);
          break;
        case "ArrowRight":
          e.preventDefault();
          skip(5);
          break;
        case "s":
          e.preventDefault();
          cycleSpeed();
          break;
        case "f":
          e.preventDefault();
          videoRef.current?.requestFullscreen?.();
          break;
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [togglePlay, skip, cycleSpeed]);

  return (
    <div className="player-wrapper">
      <video
        ref={videoRef}
        key={src}
        src={src}
        autoPlay={autoPlay}
        onClick={togglePlay}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={() => {
          const v = videoRef.current;
          if (!v) return;
          setCurrentTime(v.currentTime);
          setProgress(v.duration ? v.currentTime / v.duration : 0);
        }}
        onLoadedMetadata={() => {
          const v = videoRef.current;
          if (!v) return;
          setDuration(v.duration);
          v.playbackRate = playbackSpeed;
        }}
      />
      <div className="player-controls">
        <div
          className="player-progress"
          ref={progressRef}
          onClick={handleProgressClick}
        >
          <div
            className="player-progress-fill"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
        <div className="player-controls-row">
          <div className="player-controls-left">
            <button className="player-btn" onClick={togglePlay} title={isPlaying ? "Pause" : "Play"}>
              {isPlaying ? "\u275A\u275A" : "\u25B6"}
            </button>
            <button className="player-btn" onClick={() => skip(-5)} title="Back 5s">
              -5s
            </button>
            <button className="player-btn" onClick={() => skip(5)} title="Forward 5s">
              +5s
            </button>
            <span className="player-time">
              {formatTimestamp(currentTime)} / {formatTimestamp(duration)}
            </span>
          </div>
          <div className="player-controls-right">
            <div className="speed-controls">
              {SPEED_OPTIONS.map((s) => (
                <button
                  key={s}
                  className={`speed-btn ${playbackSpeed === s ? "active" : ""}`}
                  onClick={() => setSpeed(s)}
                >
                  {s}x
                </button>
              ))}
            </div>
            <button
              className="player-btn"
              onClick={() => videoRef.current?.requestFullscreen?.()}
              title="Fullscreen (F)"
            >
              &#x26F6;
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
