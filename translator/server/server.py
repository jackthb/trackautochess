"""
WebSocket server: receives raw PCM audio chunks from the Firefox extension,
transcribes/translates Russian → English via faster-whisper, streams results back.

Protocol:
  Client → Server: binary frames (raw PCM f32le, 16kHz, mono)
  Server → Client: JSON text frames {"text": "...", "start": float, "end": float}

Run:
  pip install faster-whisper websockets
  python server.py
"""

import asyncio
import json
import logging
import numpy as np
import websockets
from faster_whisper import WhisperModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────
HOST = "localhost"
PORT = 8765
SAMPLE_RATE = 16_000
CHUNK_SECONDS = 3.0          # accumulate this many seconds before transcribing
MIN_SPEECH_SECONDS = 0.5     # drop chunks shorter than this (silence/noise)
MODEL_SIZE = "large-v3"
DEVICE = "cuda"
COMPUTE_TYPE = "float16"     # float16 is fastest on RTX 5080
# ──────────────────────────────────────────────────────────────────────────────

log.info(f"Loading faster-whisper {MODEL_SIZE} on {DEVICE} ({COMPUTE_TYPE})…")
model = WhisperModel(MODEL_SIZE, device=DEVICE, compute_type=COMPUTE_TYPE)
log.info("Model ready.")


async def handle(ws: websockets.WebSocketServerProtocol):
    remote = ws.remote_address
    params = dict(p.split("=") for p in ws.request.path.lstrip("/?").split("&") if "=" in p)
    lang = params.get("lang", None)  # None = Whisper auto-detects
    log.info(f"Client connected: {remote} lang={lang!r}")
    buffer = bytearray()
    chunk_bytes = int(SAMPLE_RATE * CHUNK_SECONDS * 4)  # f32 = 4 bytes/sample

    try:
        async for message in ws:
            if not isinstance(message, bytes):
                continue  # ignore stray text frames

            buffer.extend(message)

            # Process whenever we've accumulated a full chunk
            while len(buffer) >= chunk_bytes:
                raw = bytes(buffer[:chunk_bytes])
                del buffer[:chunk_bytes]

                audio = np.frombuffer(raw, dtype=np.float32)
                duration = len(audio) / SAMPLE_RATE
                rms = float(np.sqrt(np.mean(audio ** 2)))
                log.info(f"chunk {duration:.1f}s  rms={rms:.6f}")

                if duration < MIN_SPEECH_SECONDS:
                    continue

                # Run transcription in a thread so we don't block the event loop
                result = await asyncio.get_event_loop().run_in_executor(
                    None, transcribe, audio, lang
                )

                for seg in result:
                    payload = json.dumps({"text": seg["text"], "start": seg["start"], "end": seg["end"]})
                    log.info(f"→ {payload}")
                    await ws.send(payload)

    except websockets.exceptions.ConnectionClosed:
        log.info(f"Client disconnected: {remote}")


def transcribe(audio: np.ndarray, language: str | None = None) -> list[dict]:
    segments, _info = model.transcribe(
        audio,
        language=language,         # ru, zh, or None (auto-detect)
        task="translate",          # → English
        beam_size=5,
        vad_filter=True,
        vad_parameters={
            "threshold": 0.65,               # raise from 0.5 — filters music better
            "min_silence_duration_ms": 400,
            "speech_pad_ms": 100,
        },
        word_timestamps=False,
    )
    return [{"text": s.text.strip(), "start": s.start, "end": s.end} for s in segments if s.text.strip()]


async def main():
    log.info(f"Listening on ws://{HOST}:{PORT}")
    async with websockets.serve(handle, HOST, PORT, max_size=10 * 1024 * 1024):
        await asyncio.Future()  # run forever


if __name__ == "__main__":
    asyncio.run(main())
