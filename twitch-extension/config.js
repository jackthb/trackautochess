// Track Auto Chess — Twitch Extension config view.
//
// Broadcaster enters their Steam username / vanity slug or SteamID64. We
// validate against the same /api/twitch/<id>/stats endpoint the panel uses,
// then persist via Twitch.ext.configuration.set so the panel can read it.

// www. directly — apex redirects to www and CORS fetches don't survive
// cross-origin redirects.
const DEFAULT_API_HOST = "https://www.trackautochess.com";
const API_HOST = (() => {
  try {
    const override = new URL(window.location.href).searchParams.get("api");
    if (override) return override.replace(/\/$/, "");
  } catch {}
  return DEFAULT_API_HOST;
})();

const CONFIG_VERSION = "1";

const els = {
  form: document.getElementById("form"),
  input: document.getElementById("steamInput"),
  submit: document.getElementById("submit"),
  status: document.getElementById("status"),
  current: document.getElementById("current"),
  currentName: document.getElementById("currentName"),
  currentProfile: document.getElementById("currentProfile"),
};

function setStatus(kind, message) {
  els.status.className = `status ${kind}`;
  els.status.textContent = message;
  els.status.classList.remove("hidden");
}

function clearStatus() {
  els.status.classList.add("hidden");
}

function readCurrentConfig() {
  const raw = window.Twitch?.ext?.configuration?.broadcaster?.content;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed.steamInput === "string" && parsed.steamInput.trim()) {
      return { steamInput: parsed.steamInput.trim() };
    }
    if (typeof parsed.steamId === "string" && parsed.steamId.trim()) {
      return { steamInput: parsed.steamId.trim() };
    }
  } catch {
    return raw.trim() ? { steamInput: raw.trim() } : null;
  }
  return null;
}

async function validate(input) {
  const resp = await fetch(
    `${API_HOST}/api/twitch/${encodeURIComponent(input)}/stats`,
    { cache: "no-store" }
  );
  if (resp.status === 404) throw new Error("That profile wasn't found.");
  if (!resp.ok) throw new Error(`Validation failed (HTTP ${resp.status}).`);
  const data = await resp.json();
  return data.player;
}

async function showCurrent() {
  const cfg = readCurrentConfig();
  if (!cfg) {
    els.current.classList.add("hidden");
    return;
  }
  els.input.value = cfg.steamInput;
  try {
    const player = await validate(cfg.steamInput);
    els.currentName.textContent = `${player.name || cfg.steamInput} (${cfg.steamInput})`;
    els.currentProfile.href = player.profile_url;
    els.current.classList.remove("hidden");
  } catch {
    els.currentName.textContent = cfg.steamInput;
    els.currentProfile.href = "#";
    els.current.classList.remove("hidden");
  }
}

async function onSubmit(e) {
  e.preventDefault();
  const input = els.input.value.trim();
  if (!input) {
    setStatus("error", "Enter a Steam username or SteamID64.");
    return;
  }

  els.submit.disabled = true;
  setStatus("info", "Validating…");

  try {
    const player = await validate(input);
    const payload = JSON.stringify({ steamInput: input });

    if (window.Twitch?.ext?.configuration?.set) {
      window.Twitch.ext.configuration.set(
        "broadcaster",
        CONFIG_VERSION,
        payload
      );
      setStatus(
        "success",
        `Linked to ${player.name || input}. The panel will refresh for viewers every 30 minutes.`
      );
      await showCurrent();
    } else {
      // Local preview — no Twitch context to save into.
      setStatus(
        "info",
        `Validated ${player.name || input}. (Not in Twitch — config can't be persisted.)`
      );
    }
  } catch (err) {
    setStatus("error", err.message || "Couldn't validate that profile.");
  } finally {
    els.submit.disabled = false;
  }
}

function bootstrap() {
  els.form.addEventListener("submit", onSubmit);

  if (window.Twitch?.ext?.onAuthorized) {
    window.Twitch.ext.onAuthorized(() => {
      showCurrent();
    });
    window.Twitch.ext.configuration.onChanged?.(() => {
      showCurrent();
    });
  } else {
    // Local preview path
    clearStatus();
  }
}

bootstrap();
