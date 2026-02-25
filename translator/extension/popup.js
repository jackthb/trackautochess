const btnStart = document.getElementById("btn-start");
const btnStop  = document.getElementById("btn-stop");
const status   = document.getElementById("status");

function setRunning(running) {
  btnStart.style.display = running ? "none"  : "block";
  btnStop.style.display  = running ? "block" : "none";
  status.textContent     = running ? "Translating…" : "Stopped";
}

// Restore state from storage
browser.storage.local.get("running").then(({ running }) => setRunning(!!running));

btnStart.addEventListener("click", async () => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  await browser.tabs.sendMessage(tab.id, { cmd: "start" });
  await browser.storage.local.set({ running: true });
  setRunning(true);
});

btnStop.addEventListener("click", async () => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  await browser.tabs.sendMessage(tab.id, { cmd: "stop" });
  await browser.storage.local.set({ running: false });
  setRunning(false);
});
