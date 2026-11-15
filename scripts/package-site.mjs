import { copyFileSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
let revision = "development"
try {
  revision = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim()
} catch {
  /* Local preview before the first commit. */
}
copyFileSync("LICENSE", "dist/LICENSE.txt")
const dependencies = [
  "@owlbear-rodeo/sdk",
  "events",
  "immer",
  "js-base64",
  "uuid",
  "react",
  "react-dom",
  "scheduler",
  "loose-envify",
  "js-tokens",
]
writeFileSync(
  "dist/THIRD_PARTY_LICENSES.txt",
  dependencies
    .map(name => {
      const directory = `node_modules/${name}`
      const pkg = JSON.parse(readFileSync(`${directory}/package.json`, "utf8"))
      const license = readdirSync(directory).find(file =>
        /^(license|licence|copying)(\.|$)/i.test(file),
      )
      if (!license) throw new Error(`Missing license for ${name}`)
      return `${name} ${pkg.version}\n${"=".repeat(50)}\n${readFileSync(
        `${directory}/${license}`,
        "utf8",
      )}\n`
    })
    .join("\n"),
)
writeFileSync(
  "dist/SOURCE.txt",
  `REcombat by ToAlDo27\nSource code: https://github.com/ToAlDo27/REcombat\nRevision: ${revision}\nLicense: MIT (LICENSE.txt)\nIndependent implementation; inspired by CLASH for Owlbear Rodeo.\n`,
)
