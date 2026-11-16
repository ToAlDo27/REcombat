import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs"
import { resolve } from "node:path"
import { build } from "esbuild"
import { zipSync, strToU8 } from "fflate"

const source = resolve("browser-bridge")
const output = resolve(source, "build")
const manifest = JSON.parse(readFileSync(resolve(source, "manifest.json"), "utf8"))
mkdirSync(output, { recursive: true })
await build({
  entryPoints: ["lss", "source-relay", "receiver", "worker", "popup"].map(name =>
    resolve(source, "src", name + ".ts"),
  ),
  outdir: output,
  bundle: true,
  format: "iife",
  target: "chrome114",
  legalComments: "none",
})
for (const file of ["manifest.json", "popup.html", "popup.css", "README.md"])
  copyFileSync(resolve(source, file), resolve(output, file))
copyFileSync("LICENSE", resolve(output, "LICENSE.txt"))
const files = [
  "manifest.json",
  "lss.js",
  "source-relay.js",
  "receiver.js",
  "worker.js",
  "popup.js",
  "popup.html",
  "popup.css",
  "README.md",
  "LICENSE.txt",
]
const archive = zipSync(
  Object.fromEntries(
    files.map(file => [
      file,
      file.endsWith(".md")
        ? strToU8(readFileSync(resolve(output, file), "utf8"))
        : readFileSync(resolve(output, file)),
    ]),
  ),
)
const filename = "recombat-lss-bridge-" + manifest.version + ".zip"
writeFileSync(resolve(source, filename), archive)
mkdirSync("dist", { recursive: true })
writeFileSync(resolve("dist", filename), archive)
console.log("REcombat LSS Bridge " + manifest.version + ": " + output)
