/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eff6ff',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          900: '#1e3a8a',
        },
        neon: {
          green: '#10ff00',
          blue: '#00d4ff',
          purple: '#ff00ff',
        },
        accent: '#199998',
        navy: '#1a1a2e',
        sidebarBg: '#16213e',
        sidebarBorder: '#0f3460',
        inputBg: '#0f3460',
        logBg: '#0d0d0d',
        dark: {
          900: '#0a0a0a',
          800: '#111827',
          700: '#1f2937',
        }
      },
      fontFamily: {
        'tron': ['Orbitron', 'monospace'],
        'mono': ['JetBrains Mono', 'monospace'],
      }
    },
  },
  plugins: [],
}
