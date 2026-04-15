import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

function versionInjectionPlugin() {
  return {
    name: "tron-software-version-injection",
    enforce: "post",
    writeBundle() {
      const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf-8"))
      const version = pkg.version

      const versionData = {
        version,
        releaseDate: new Date().toISOString().split("T")[0],
        releaseNotes: "Updated version",
        downloadUrl: `https://tronq.vercel.app/asset/setup/TRONSetup-v${version}.exe`,
        mandatory: false
      }
      fs.writeFileSync(path.resolve(process.cwd(), "public/version.json"), JSON.stringify(versionData, null, 2))

      let nsiContent = fs.readFileSync(path.resolve(process.cwd(), "tron_installer.nsi"), "utf-8")
      nsiContent = nsiContent.split("__SOFTWARE_VERSION__").join(version)
      nsiContent = nsiContent.split("__SOFTWARE_VERSION_DOT__").join(version.split("-")[0])
      fs.writeFileSync(path.resolve(process.cwd(), "tron_installer.nsi"), nsiContent)

      let specContent = fs.readFileSync(path.resolve(process.cwd(), "tron.spec"), "utf-8")
      specContent = specContent.split("__SOFTWARE_VERSION__").join(version)
      fs.writeFileSync(path.resolve(process.cwd(), "tron.spec"), specContent)
    },
  }
}

export default defineConfig({
  plugins: [react(), versionInjectionPlugin()],
  assetsInclude: ['**/*.png'],
  base: './',
  build: {
    outDir: 'dist'
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime']
  },
  server: {
    port: 5173,
    strictPort: true,
    host: true
  }
})
