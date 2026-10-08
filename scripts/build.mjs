// Standalone build without Python; original avatar regeneration remains available in build.py.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(path.join(root, "src", f), "utf8");
const scripts = [
  "portraits.js",
  "avatars.js",
  "conventions.js",
  "souls.js",
  "vendor/three.min.js",
  "city.js",
  "app.js",
]
  .map(read)
  .join("\n");
const html = read("shell.html")
  .replace(
    "<!--STYLE-->",
    () => "<style>\n" + read("styles.css") + "\n</style>",
  )
  .replace("<!--SCRIPTS-->", () => "<script>\n" + scripts + "\n</script>");
writeFileSync(path.join(root, "index.html"), html);
console.log(`index.html: ${Math.round(Buffer.byteLength(html) / 1024)} KB`);
