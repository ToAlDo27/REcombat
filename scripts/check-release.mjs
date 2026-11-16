import { readFileSync } from "node:fs"

const read = path => JSON.parse(readFileSync(path, "utf8"))
const pkg = read("package.json")
const manifest = read("public/manifest.json")
const lock = read("package-lock.json")
const releases = read("src/releases.json")
if (
  manifest.version !== pkg.version ||
  releases[0]?.version !== pkg.version ||
  lock.packages[""].version !== pkg.version
)
  throw new Error("Версии package, lock, manifest и release notes должны совпадать.")
if (!readFileSync("CHANGELOG.md", "utf8").includes(`## ${pkg.version}`))
  throw new Error("Добавьте описание выпуска в CHANGELOG.md.")
if (
  !releases[0].changes?.length ||
  new Set(releases.map(release => release.version)).size !== releases.length
)
  throw new Error("История должна содержать уникальные версии и описание изменений.")
console.log(`REcombat ${pkg.version}: версия и история согласованы.`)
