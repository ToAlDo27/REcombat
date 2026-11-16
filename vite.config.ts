import { readFileSync } from "node:fs"
import process from "node:process"
import { defineConfig, loadEnv } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_")
  const path = (env.VITE_BASE_PATH ?? "/").replace(/^\/+|\/+$/g, "")
  const base = path ? `/${path}/` : "/"
  return {
    base,
    optimizeDeps: {
      entries: ["index.html", "background.html", "audio.html", "token.html"],
    },
    plugins: [
      react(),
      {
        name: "extension-manifest",
        generateBundle() {
          const manifest = JSON.parse(
            readFileSync(new URL("./public/manifest.json", import.meta.url), "utf8"),
          )
          manifest.icon = `${base}icon.svg`
          manifest.action.icon = `${base}action.svg`
          manifest.action.popover = base
          manifest.background_url = `${base}background.html`
          this.emitFile({
            type: "asset",
            fileName: "manifest.json",
            source: JSON.stringify(manifest, null, 2) + "\n",
          })
        },
      },
    ],
    build: {
      rollupOptions: {
        input: {
          main: "index.html",
          background: "background.html",
          audio: "audio.html",
          token: "token.html",
        },
      },
    },
  }
})
