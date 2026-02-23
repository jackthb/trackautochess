import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const res = await fetch("https://www.autochess.site/static/js/main.917ef4c8.js");
const js = await res.text();
console.log("Bundle size:", js.length, "bytes");

const names = ["Terrorblade", "Axe", "Crystal Maiden", "Anti-Mage", "Enigma", "Invoker", "Marci", "Snapfire", "Dawnbreaker", "Lifestealer"];
for (const name of names) {
  const idx = js.indexOf(name);
  if (idx !== -1) {
    console.log(`\nFound: "${name}" at index ${idx}`);
    console.log("Context:", js.slice(Math.max(0, idx - 150), idx + 300));
  } else {
    console.log(`Not found: "${name}"`);
  }
}
