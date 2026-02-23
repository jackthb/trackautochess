# dac-analyzer: Progress Log

## What Works

- **Download**: `yt-dlp` downloads VOD to `~/.cache/dac/videos/{video_id}.mp4`, reused on rerun
- **Frame extraction**: ffmpeg extracts frames at configurable interval, writes `index.json` so frames aren't re-extracted on rerun
- **Light scan**: rounds each frame through a light vision call to detect round/phase; checkpointed to `game.lightscan.jsonl`
- **Full analysis**: deeper per-frame analysis; checkpointed to `game.partial.jsonl` — survives crashes, resumes on rerun
- **Timeline assembly**: detects pivots, power spikes, item combines, economy events, level-ups
- **JSON output**: structured `game.json`
- **Summary output**: human-readable `game.summary.txt`
- **Build guide**: `dac build-guide game.json` generates `game.md` Markdown from structured data
- **Local backend**: `--local` flag routes all vision calls through Ollama instead of Anthropic API
- **CLI**: `dac analyze <url> [--local] [--build-guide]` — minimal flags needed, sensible defaults

## What's Broken / In Progress

### Ollama model stability (blocker)
- `qwen2.5vl:7b` crashes the Ollama runner (`llama runner terminated, exit status 2`) on roughly 10–15% of frames
- Each crash = 500 error from Ollama, ~15s retry wait, then skip and continue
- At 284 frames × ~4s/frame + ~15s per crash: run takes 20+ minutes
- 26/284 frames done when paused; checkpoint is intact and resumable
- Root cause: model bug / WSL2 instability, not our code

### Candidate fixes to try
1. **Different model**: `ollama pull llava:7b` — older but no runner crashes
2. **Downscale frames before sending**: frames are 2–3MB PNG; resize to 720p before base64-encoding might reduce crash rate
3. **Ollama on Windows native** instead of WSL2 (avoid WSL GPU passthrough issues)
4. **`--no-adaptive` flag**: skip dense resampling → 76 frames instead of 284, much faster run, less crash exposure

### Minor bugs
- Video cache detection finds `.part` files (partial downloads) and treats them as complete — needs glob filter for `.mp4` only
- `"Using cached video"` message always prints even on fresh downloads

## File State

| Path | Status |
|------|--------|
| `~/.cache/dac/videos/Oi7RRtFnVwk.f399.mp4.part` | Downloaded (might be incomplete, name is wrong) |
| `~/.cache/dac/frames/Oi7RRtFnVwk/initial/` | 76 frames + `index.json` ✓ |
| `~/.cache/dac/frames/Oi7RRtFnVwk/dense/` | 252 frames (no `index.json` yet) |
| `game.lightscan.jsonl` | 76/76 frames ✓ complete |
| `game.partial.jsonl` | 26/284 frames — resumable |

## Next Steps (Recommended Order)

1. Try `--no-adaptive` first: only 76 frames, much faster, see if output quality is acceptable
2. If quality ok: pull `llava:7b` and rerun with it — more stable for batch
3. If quality needs dense sampling: fix model stability first, then re-enable adaptive

```bash
# Fastest path to a result:
uv run dac analyze "https://www.youtube.com/watch?v=Oi7RRtFnVwk" \
  --local --model llava:7b --no-adaptive --build-guide
```
