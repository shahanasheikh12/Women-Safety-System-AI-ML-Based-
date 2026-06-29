/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        primary: '#C0392B',
        secondary: '#922B21',
        accent: '#F1948A',
        safe: '#1E8449',
        warning: '#D35400',
        background: '#0D0D0D',
        surface: '#1A1A2E',
        text: '#FDFEFE',
        textMuted: '#BDC3C7',
      }
    },
  },
  plugins: [],
}
