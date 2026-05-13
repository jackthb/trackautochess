// electron-builder custom signing hook.
//
// Skips vendor binaries (tesseract.exe, ffmpeg.exe) that are already signed
// by their upstream maintainers — re-signing them is just a slow round-trip
// to the timestamp server. Everything else is signed via signtool using
// CSC_LINK (.pfx) or WIN_CSC_SHA1 (cert thumbprint in Windows store).
//
// If no cert env var is set, signing is skipped entirely — this is the
// local "unsigned dev build" path. Set WIN_CSC_AUTO=1 to opt into
// signtool's `/a` auto-discovery from the Windows cert store.

const { execFileSync } = require("child_process");
const path = require("path");

const SKIP_VENDOR_BINARIES = new Set([
  "tesseract.exe",
  "ffmpeg.exe",
]);

const TIMESTAMP_URL =
  process.env.WIN_CSC_TIMESTAMP_URL ||
  process.env.CSC_TIMESTAMP_URL ||
  "http://timestamp.digicert.com";

exports.default = async function sign(configuration) {
  const filePath = configuration.path;
  const basename = path.basename(filePath).toLowerCase();

  if (SKIP_VENDOR_BINARIES.has(basename)) {
    console.log(`  [custom-sign] skip vendor binary: ${basename}`);
    return;
  }

  const certFile = process.env.WIN_CSC_LINK || process.env.CSC_LINK;
  const certPassword =
    process.env.WIN_CSC_KEY_PASSWORD || process.env.CSC_KEY_PASSWORD;
  const certSha1 = process.env.WIN_CSC_SHA1;
  const autoDiscover = process.env.WIN_CSC_AUTO === "1";

  if (!certFile && !certSha1 && !autoDiscover) {
    console.log(
      `  [custom-sign] skip ${basename} (no cert configured; set WIN_CSC_LINK / WIN_CSC_SHA1 / WIN_CSC_AUTO=1 to sign)`,
    );
    return;
  }

  const args = [
    "sign",
    "/fd",
    "SHA256",
    "/tr",
    TIMESTAMP_URL,
    "/td",
    "SHA256",
  ];

  if (certFile) {
    args.push("/f", certFile);
    if (certPassword) args.push("/p", certPassword);
  } else if (certSha1) {
    args.push("/sha1", certSha1);
  } else {
    args.push("/a");
  }

  args.push(filePath);

  console.log(`  [custom-sign] sign ${basename}`);
  execFileSync("signtool", args, { stdio: "inherit" });
};
