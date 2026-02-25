/**
 * DAC Translator — content script (runs on twitch.tv and douyu.com tabs).
 *
 * Responsibilities:
 *  1. Tap the stream <video> element via Web Audio API.
 *  2. Pipe PCM through an AudioWorklet at 16 kHz → WebSocket → Python server.
 *  3. Render translated segments as a subtitle overlay.
 *
 * Messages from popup:
 *  { cmd: "start" }
 *  { cmd: "stop"  }
 */

const SITE_LANG = location.hostname.includes("douyu.com") ? "zh" : "ru";
const WS_URL = `ws://localhost:8765?lang=${SITE_LANG}`;

let audioCtx   = null;
let worklet    = null;
let sourceNode = null;
let ws         = null;
let overlay    = null;
let active     = false;

// ── Subtitle overlay ──────────────────────────────────────────────────────────

function ensureOverlay() {
  if (overlay) return;

  overlay = document.createElement("div");
  overlay.id = "dac-subtitle-overlay";
  Object.assign(overlay.style, {
    position:      "fixed",
    bottom:        "80px",
    left:          "50%",
    transform:     "translateX(-50%)",
    width:         "80vw",
    zIndex:        "2147483647",
    pointerEvents: "none",
    textAlign:     "center",
    fontFamily:    "'Segoe UI', Arial, sans-serif",
  });
  document.body.appendChild(overlay);
}

function showSubtitle(text, durationMs = 4000) {
  ensureOverlay();

  const line = document.createElement("div");
  Object.assign(line.style, {
    display:      "inline-block",
    margin:       "4px auto",
    padding:      "6px 16px",
    background:   "rgba(0,0,0,0.82)",
    color:        "#fff",
    fontSize:     "28px",
    lineHeight:   "1.4",
    borderRadius: "4px",
    textShadow:   "1px 1px 3px #000",
    opacity:      "1",
    transition:   "opacity 0.5s",
    maxWidth:     "100%",
    wordBreak:    "break-word",
  });
  line.textContent = text;
  overlay.appendChild(line);

  setTimeout(() => { line.style.opacity = "0"; }, durationMs - 500);
  setTimeout(() => { line.remove(); },             durationMs);
}

// ── WebSocket ─────────────────────────────────────────────────────────────────

function connectWS() {
  ws = new WebSocket(WS_URL);
  ws.binaryType = "arraybuffer";

  ws.onopen  = () => console.log("[DAC] WebSocket connected");
  ws.onclose = () => {
    console.log("[DAC] WebSocket closed");
    if (active) setTimeout(connectWS, 2000);
  };
  ws.onerror = (e) => console.error("[DAC] WebSocket error", e);

  ws.onmessage = (evt) => {
    try {
      const { text, start, end } = JSON.parse(evt.data);
      console.log("[DAC] received:", text);
      if (text) showSubtitle(text, (end - start + 1) * 1000);
    } catch (e) {
      console.error("[DAC] Bad message", e);
    }
  };
}

function sendPCM(float32Array) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(float32Array.buffer);
  }
}

// ── Audio capture ─────────────────────────────────────────────────────────────

async function waitForVideo(timeoutMs = 15000) {
  const video = findVideoElement();
  if (video) return video;
  return new Promise((resolve) => {
    const obs = new MutationObserver(() => {
      const v = findVideoElement();
      if (v) { obs.disconnect(); resolve(v); }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { obs.disconnect(); resolve(null); }, timeoutMs);
  });
}

async function startCapture() {
  const video = await waitForVideo();
  if (!video) {
    console.error("[DAC] No <video> element found after 15s");
    return;
  }

  audioCtx = new AudioContext({ sampleRate: 16_000 });
  await audioCtx.resume();

  await audioCtx.audioWorklet.addModule(
    browser.runtime.getURL("audio-processor.js")
  );

  sourceNode = audioCtx.createMediaElementSource(video);

  const merger = audioCtx.createChannelMerger(1);
  sourceNode.connect(merger, 0, 0);

  worklet = new AudioWorkletNode(audioCtx, "pcm-processor", {
    numberOfInputs:   1,
    numberOfOutputs:  1,
    channelCount:     1,
    channelCountMode: "explicit",
  });

  worklet.port.onmessage = (e) => sendPCM(e.data);

  merger.connect(worklet);
  worklet.connect(audioCtx.destination);
  sourceNode.connect(audioCtx.destination);

  console.log("[DAC] Audio capture started");
}

function stopCapture() {
  worklet?.disconnect();
  sourceNode?.disconnect();
  audioCtx?.close();
  worklet = sourceNode = audioCtx = null;
  console.log("[DAC] Audio capture stopped");
}

function findVideoElement() {
  return (
    document.querySelector("video[src]") ||
    document.querySelector("video")
  );
}

// ── Start / Stop ──────────────────────────────────────────────────────────────

async function start() {
  if (active) return;
  active = true;
  connectWS();
  await startCapture();
}

function stop() {
  if (!active) return;
  active = false;
  stopCapture();
  ws?.close();
  ws = null;
  overlay?.remove();
  overlay = null;
}

// ── Message bus ───────────────────────────────────────────────────────────────

browser.runtime.onMessage.addListener((msg) => {
  if (msg.cmd === "start") start();
  if (msg.cmd === "stop")  stop();
});

// Auto-start if already running before extension reload
browser.storage.local.get("running").then(({ running }) => {
  if (running) start();
});
