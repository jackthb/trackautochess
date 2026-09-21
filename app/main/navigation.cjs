// Renderer links may open web pages, never OS handlers or privileged documents.
function externalWebUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

function protectRendererNavigation(webContents, openExternal) {
  const open = (value) => {
    const url = externalWebUrl(value);
    if (url) Promise.resolve(openExternal(url)).catch(() => {});
  };
  webContents.setWindowOpenHandler(({ url }) => {
    open(url);
    return { action: "deny" };
  });
  webContents.on("will-navigate", (event, url) => {
    event.preventDefault();
    open(url);
  });
}

module.exports = { externalWebUrl, protectRendererNavigation };
