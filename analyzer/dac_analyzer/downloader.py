"""Download YouTube VODs using yt-dlp."""

import re
import subprocess
import tempfile
from pathlib import Path


def _video_id_from_url(url: str) -> str | None:
    """Extract YouTube video ID from a URL."""
    match = re.search(r"(?:v=|youtu\.be/)([A-Za-z0-9_-]{11})", url)
    return match.group(1) if match else None


def download_video(url: str, output_dir: Path | None = None) -> Path:
    """Download a YouTube video and return the path to the file.

    Args:
        url: YouTube video URL.
        output_dir: Directory to save the video. Uses a temp dir if None.

    Returns:
        Path to the downloaded video file.
    """
    if output_dir is None:
        output_dir = Path(tempfile.mkdtemp(prefix="dac_"))
    output_dir.mkdir(parents=True, exist_ok=True)

    # Reuse already-downloaded file if present
    video_id = _video_id_from_url(url)
    if video_id:
        existing = next(
            (p for p in output_dir.glob(f"{video_id}.*") if p.suffix != ".part"),
            None,
        )
        if existing:
            return existing

    output_template = str(output_dir / "%(id)s.%(ext)s")

    cmd = [
        "yt-dlp",
        "--no-playlist",
        "-f", "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best",
        "--merge-output-format", "mp4",
        "-o", output_template,
        "--print", "after_move:filepath",
        url,
    ]

    result = subprocess.run(cmd, capture_output=True, text=True, check=True)

    # --print after_move:filepath outputs the final path on the last line
    filepath = result.stdout.strip().splitlines()[-1]
    return Path(filepath)


def get_video_duration(video_path: Path) -> float:
    """Get video duration in seconds using ffprobe."""
    cmd = [
        "ffprobe",
        "-v", "quiet",
        "-show_entries", "format=duration",
        "-of", "csv=p=0",
        str(video_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, check=True)
    return float(result.stdout.strip())
