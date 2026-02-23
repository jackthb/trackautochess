"""Extract frames from video files using ffmpeg."""

import subprocess
from dataclasses import dataclass
from pathlib import Path


@dataclass
class ExtractedFrame:
    """A frame extracted from a video."""
    path: Path
    timestamp_sec: float
    frame_index: int


def extract_frames(
    video_path: Path,
    output_dir: Path,
    interval_sec: float = 30.0,
    start_sec: float = 0.0,
    end_sec: float | None = None,
    prefix: str = "frame",
) -> list[ExtractedFrame]:
    """Extract frames from a video at regular intervals.

    Args:
        video_path: Path to the video file.
        output_dir: Directory to save extracted frames.
        interval_sec: Seconds between frame captures.
        start_sec: Start time in seconds.
        end_sec: End time in seconds (None = end of video).
        prefix: Filename prefix for extracted frames.

    Returns:
        List of ExtractedFrame objects sorted by timestamp.
    """
    output_dir.mkdir(parents=True, exist_ok=True)

    # Build ffmpeg command
    cmd = [
        "ffmpeg",
        "-y",
        "-ss", str(start_sec),
    ]

    if end_sec is not None:
        cmd.extend(["-t", str(end_sec - start_sec)])

    cmd.extend([
        "-i", str(video_path),
        "-vf", f"fps=1/{interval_sec}",
        "-frame_pts", "1",
        "-q:v", "2",
        str(output_dir / f"{prefix}_%06d.png"),
    ])

    subprocess.run(cmd, capture_output=True, text=True, check=True)

    # Collect extracted frames and compute timestamps
    frames = []
    for i, path in enumerate(sorted(output_dir.glob(f"{prefix}_*.png"))):
        timestamp = start_sec + i * interval_sec
        frames.append(ExtractedFrame(
            path=path,
            timestamp_sec=timestamp,
            frame_index=i,
        ))

    return frames


def extract_dense_around_timestamps(
    video_path: Path,
    output_dir: Path,
    timestamps: list[float],
    window_sec: float = 30.0,
    dense_interval_sec: float = 5.0,
) -> list[ExtractedFrame]:
    """Extract frames densely around specific timestamps.

    For each timestamp, extract frames in a window around it at a higher
    frame rate. Used for adaptive sampling around round transitions.

    Args:
        video_path: Path to the video file.
        timestamps: List of timestamps (seconds) to sample around.
        output_dir: Directory to save extracted frames.
        window_sec: Total window size in seconds centered on each timestamp.
        dense_interval_sec: Seconds between frames in dense regions.

    Returns:
        List of ExtractedFrame objects, deduplicated and sorted.
    """
    all_frames: list[ExtractedFrame] = []
    seen_timestamps: set[float] = set()
    half_window = window_sec / 2

    for i, ts in enumerate(timestamps):
        start = max(0, ts - half_window)
        end = ts + half_window

        frames = extract_frames(
            video_path=video_path,
            output_dir=output_dir,
            interval_sec=dense_interval_sec,
            start_sec=start,
            end_sec=end,
            prefix=f"dense_{i}",
        )

        for frame in frames:
            # Deduplicate by rounding to nearest second
            rounded = round(frame.timestamp_sec)
            if rounded not in seen_timestamps:
                seen_timestamps.add(rounded)
                all_frames.append(frame)

    all_frames.sort(key=lambda f: f.timestamp_sec)
    return all_frames
