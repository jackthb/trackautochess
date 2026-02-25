# DAC Translator

Real-time stream translation overlay for Twitch (Russian→English) and Douyu (Chinese→English).

## How it works

```
Browser tab audio
  → Firefox extension (Web Audio API)
  → WebSocket (raw PCM, 16kHz mono)
  → Python server (faster-whisper large-v3, CUDA)
  → translated text back over WebSocket
  → subtitle overlay on page
```

No screen capture. The extension taps the stream's `<video>` element directly via `AudioWorklet`.

## Requirements

- NVIDIA GPU (tested on RTX 5080)
- CUDA toolkit 12.6 (WSL2: see below)
- Python 3.12+, [uv](https://github.com/astral-sh/uv)
- Firefox

## Setup

### 1. CUDA (WSL2 only)

```bash
curl -fsSL https://developer.download.nvidia.com/compute/cuda/repos/wsl-ubuntu/x86_64/cuda-keyring_1.1-1_all.deb -o cuda-keyring.deb
sudo dpkg -i cuda-keyring.deb
sudo apt-get update && sudo apt-get install -y cuda-toolkit-12-6
```

### 2. Python server

```bash
uv sync
LD_LIBRARY_PATH=/usr/local/cuda-12.6/lib64:$LD_LIBRARY_PATH uv run python server/server.py
```

The server downloads `faster-whisper large-v3` from HuggingFace on first run (~3GB).

### 3. Firefox extension

1. Go to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select `extension/manifest.json`

## Usage

Open a Twitch or Douyu stream, click the **DAC Translator** toolbar button, hit **Start**. Subtitles appear at the bottom of the page.

- **Twitch** → assumes Russian, translates to English
- **Douyu** → assumes Chinese, translates to English

## Tuning

| Setting | File | Default | Notes |
|---|---|---|---|
| Chunk size | `server/server.py` | 3s | Shorter = lower latency, worse accuracy |
| VAD threshold | `server/server.py` | 0.65 | Raise to filter more music |
| Model size | `server/server.py` | `large-v3` | `medium` is faster, less accurate |
| Subtitle size | `extension/content_script.js` | 28px | |

## Roadmap

- [ ] Kokoro TTS for dubbed audio output
- [ ] Adjustable subtitle position
- [ ] Support more sites/languages
