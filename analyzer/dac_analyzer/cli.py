"""CLI entry point for the DAC Analyzer."""

import json
from pathlib import Path

import click


def _load_or_extract_frames(video_path, output_dir, interval_sec):
    """Extract frames, or load from cached index if already done."""
    from .frame_extractor import ExtractedFrame, extract_frames

    index_path = output_dir / "index.json"
    if index_path.exists():
        entries = json.loads(index_path.read_text())
        frames = [ExtractedFrame(Path(e["path"]), e["timestamp_sec"], e["frame_index"]) for e in entries]
        if frames and all(f.path.exists() for f in frames):
            return frames, True  # (frames, was_cached)

    frames = extract_frames(video_path=video_path, output_dir=output_dir, interval_sec=interval_sec)
    index_path.write_text(json.dumps([
        {"path": str(f.path), "timestamp_sec": f.timestamp_sec, "frame_index": f.frame_index}
        for f in frames
    ]))
    return frames, False


def _load_jsonl(path: Path) -> dict:
    """Load a JSONL checkpoint file. Returns dict keyed by rounded timestamp_sec."""
    results = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if line:
            r = json.loads(line)
            results[round(r["timestamp_sec"])] = r
    return results


@click.group()
def cli():
    """Dota Auto Chess VOD Analyzer - extract game state from YouTube VODs."""
    pass


@cli.command()
@click.argument("url")
@click.option("--interval", default=30, help="Seconds between initial frame captures.")
@click.option("--dense-interval", default=5, help="Seconds between frames in dense sampling regions.")
@click.option("--dense-window", default=30, help="Window size (sec) for dense sampling around transitions.")
@click.option("--output", "-o", default="game.json", help="Output JSON file path.")
@click.option("--summary", "-s", default=None, help="Output summary text file (default: <output>.summary.txt).")
@click.option("--video-dir", default="~/.cache/dac/videos", show_default=True,
              help="Directory for downloaded videos (reused on reruns).")
@click.option("--frames-dir", default="~/.cache/dac/frames", show_default=True,
              help="Directory for extracted frames (reused on reruns).")
@click.option("--skip-download", default=None, type=click.Path(exists=True),
              help="Skip download, use this local video file instead.")
@click.option("--no-adaptive", is_flag=True, help="Skip adaptive re-sampling (faster, less accurate).")
@click.option("--local", is_flag=True, help="Use local Ollama model instead of the Anthropic API.")
@click.option("--model", default="qwen2.5vl:7b", show_default=True,
              help="Ollama model name (only used with --local).")
@click.option("--build-guide", is_flag=True, help="Generate a Markdown build guide after analysis.")
def analyze(url, interval, dense_interval, dense_window, output, summary,
            video_dir, frames_dir, skip_download, no_adaptive,
            local, model, build_guide):
    """Analyze a Dota Auto Chess VOD from a YouTube URL.

    Automatically resumes if interrupted — video, frames, and API results
    are all cached and reused on rerun.
    """
    from .downloader import _video_id_from_url, download_video, get_video_duration
    from .frame_extractor import extract_dense_around_timestamps
    from .output import generate_summary, save_json, save_summary
    from .timeline import assemble_timeline

    if local:
        from .ollama_analyzer import OllamaClient, batch_full_analysis, batch_light_scan
        client = OllamaClient(model=model)
        click.echo(f"Using local Ollama model: {model}")
    else:
        import anthropic
        from .analyzer import batch_full_analysis, batch_light_scan
        client = anthropic.Anthropic()

    output_path = Path(output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if summary is None:
        summary = output_path.with_suffix(".summary.txt")
    summary_path = Path(summary)

    # Checkpoint files live alongside the output JSON
    lightscan_ckpt = output_path.with_suffix(".lightscan.jsonl")
    fullanalysis_ckpt = output_path.with_suffix(".partial.jsonl")

    # Set up directories, organised by video ID so multiple videos don't collide
    video_dir = Path(video_dir).expanduser()
    base_frames_dir = Path(frames_dir).expanduser()

    if skip_download:
        video_path = Path(skip_download)
        video_id = video_path.stem
        click.echo(f"Using local video: {video_path}")
    else:
        video_id = _video_id_from_url(url) or "unknown"
        video_dir.mkdir(parents=True, exist_ok=True)
        click.echo(f"Downloading video from: {url}")
        video_path = download_video(url, video_dir)
        if video_path.stat().st_size > 0 and (video_dir / video_path.name).exists():
            click.echo(f"Using cached video: {video_path}")
        else:
            click.echo(f"Downloaded: {video_path}")

    video_frames_dir = base_frames_dir / video_id
    initial_dir = video_frames_dir / "initial"
    dense_dir = video_frames_dir / "dense"

    duration = get_video_duration(video_path)
    click.echo(f"Video duration: {duration:.0f}s ({duration/60:.1f} min)")

    # Step 2: Initial frame extraction
    initial_frames, cached = _load_or_extract_frames(video_path, initial_dir, interval)
    if cached:
        click.echo(f"\nLoaded {len(initial_frames)} cached frames from {initial_dir}")
    else:
        click.echo(f"\nExtracted {len(initial_frames)} frames")

    # Step 3: Light scan — load from checkpoint if available
    if lightscan_ckpt.exists():
        cached = _load_jsonl(lightscan_ckpt)
        click.echo(f"\nResuming light scan ({len(cached)} frames cached)...")
        remaining = [f for f in initial_frames if round(f.timestamp_sec) not in cached]
        light_results_map = dict(cached)
    else:
        remaining = list(initial_frames)
        light_results_map = {}

    if remaining:
        click.echo(f"  Scanning {len(remaining)} frames...")
        with lightscan_ckpt.open("a") as fh:
            def light_progress(i, total, result):
                fh.write(json.dumps(result) + "\n")
                fh.flush()
                r = result.get("round", "?")
                phase = result.get("phase", "?")
                click.echo(f"  [{i+1}/{total}] t={result['timestamp_sec']:.0f}s -> Round {r} ({phase})")
            new_light = batch_light_scan(client, remaining, on_progress=light_progress)
        for r in new_light:
            light_results_map[round(r["timestamp_sec"])] = r

    light_results = sorted(light_results_map.values(), key=lambda r: r["timestamp_sec"])

    # Step 4: Adaptive re-sampling
    all_frames = list(initial_frames)

    if not no_adaptive:
        transition_timestamps = []
        prev_round = None
        for result in light_results:
            current_round = result.get("round")
            if current_round is not None and current_round != prev_round:
                if prev_round is not None:
                    transition_timestamps.append(result["timestamp_sec"])
                prev_round = current_round

        if transition_timestamps:
            dense_index = dense_dir / "index.json"
            if dense_index.exists():
                from .frame_extractor import ExtractedFrame
                entries = json.loads(dense_index.read_text())
                dense_frames = [ExtractedFrame(Path(e["path"]), e["timestamp_sec"], e["frame_index"]) for e in entries]
                click.echo(f"\nLoaded {len(dense_frames)} cached dense frames")
            else:
                click.echo(f"\nDetected {len(transition_timestamps)} round transitions, doing dense re-sample...")
                dense_frames = extract_dense_around_timestamps(
                    video_path=video_path,
                    output_dir=dense_dir,
                    timestamps=transition_timestamps,
                    window_sec=dense_window,
                    dense_interval_sec=dense_interval,
                )
                dense_index.write_text(json.dumps([
                    {"path": str(f.path), "timestamp_sec": f.timestamp_sec, "frame_index": f.frame_index}
                    for f in dense_frames
                ]))
                click.echo(f"Extracted {len(dense_frames)} additional dense frames")
            all_frames.extend(dense_frames)
        else:
            click.echo("\nNo round transitions detected, skipping adaptive re-sample")

    # Deduplicate frames by timestamp
    seen = set()
    unique_frames = []
    for f in sorted(all_frames, key=lambda x: x.timestamp_sec):
        key = round(f.timestamp_sec)
        if key not in seen:
            seen.add(key)
            unique_frames.append(f)

    # Step 5: Full analysis — load from checkpoint if available
    if fullanalysis_ckpt.exists():
        completed = _load_jsonl(fullanalysis_ckpt)
        click.echo(f"\nResuming full analysis ({len(completed)} frames cached)...")
    else:
        completed = {}

    remaining_frames = [f for f in unique_frames if round(f.timestamp_sec) not in completed]

    if remaining_frames:
        click.echo(f"Running full analysis on {len(remaining_frames)} frames...")
        with fullanalysis_ckpt.open("a") as fh:
            def full_progress(i, total, result):
                fh.write(json.dumps(result) + "\n")
                fh.flush()
                r = result.get("round", "?")
                units = len(result.get("board_units", []))
                click.echo(f"  [{i+1}/{total}] Round {r}: {units} units on board")
            new_results = batch_full_analysis(client, remaining_frames, on_progress=full_progress)
        for r in new_results:
            completed[round(r["timestamp_sec"])] = r
    else:
        click.echo("\nAll frames already analyzed (from checkpoint)")

    full_results = sorted(completed.values(), key=lambda r: r.get("timestamp_sec", 0))

    # Step 6: Assemble timeline
    click.echo("\nAssembling game timeline...")
    timeline = assemble_timeline(full_results)
    click.echo(f"Detected {len(timeline.events)} events across rounds {timeline.first_round}-{timeline.last_round}")

    # Step 7: Output
    save_json(timeline, output_path)
    click.echo(f"\nJSON saved to: {output_path}")

    save_summary(timeline, summary_path)
    click.echo(f"Summary saved to: {summary_path}")

    click.echo("\n" + "=" * 60)
    click.echo(generate_summary(timeline))

    # Step 8: Optional build guide
    if build_guide:
        from .build_guide import save_build_guide
        guide_path = save_build_guide(output_path)
        click.echo(f"Build guide saved to: {guide_path}")

    # Clean up checkpoints now that we have a complete output
    lightscan_ckpt.unlink(missing_ok=True)
    fullanalysis_ckpt.unlink(missing_ok=True)


@cli.command()
@click.argument("image_path", type=click.Path(exists=True))
@click.option("--mode", type=click.Choice(["light", "full"]), default="full",
              help="Analysis mode: light (round only) or full (complete state).")
@click.option("--local", is_flag=True, help="Use local Ollama model instead of the Anthropic API.")
@click.option("--model", default="qwen2.5vl:7b", show_default=True,
              help="Ollama model name (only used with --local).")
def scan_frame(image_path, mode, local, model):
    """Analyze a single game screenshot (for testing)."""
    from .frame_extractor import ExtractedFrame

    frame = ExtractedFrame(path=Path(image_path), timestamp_sec=0, frame_index=0)

    if local:
        from .ollama_analyzer import OllamaClient, full_analysis, light_scan
        client = OllamaClient(model=model)
    else:
        import anthropic
        from .analyzer import full_analysis, light_scan
        client = anthropic.Anthropic()

    if mode == "light":
        result = light_scan(client, frame)
    else:
        result = full_analysis(client, frame)

    click.echo(json.dumps(result, indent=2))


@cli.command("build-guide")
@click.argument("analysis_json", type=click.Path(exists=True))
@click.option("--output", "-o", default=None,
              help="Output Markdown file path (default: alongside the JSON).")
def build_guide_cmd(analysis_json, output):
    """Generate a Markdown build guide from an existing analysis JSON file."""
    from .build_guide import save_build_guide

    json_path = Path(analysis_json)
    output_path = Path(output) if output else None

    guide_path = save_build_guide(json_path, output_path)
    click.echo(f"Build guide saved to: {guide_path}")


def main():
    cli()


if __name__ == "__main__":
    main()
