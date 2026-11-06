module.exports = {
  content: ['./src/**/*.{ts,tsx}', './public/index.html'],
  theme: {
    extend: {
      colors: {
        brand: { 50: '#eff7f7', 100: '#d8eeef', 200: '#b3dcdd', 300: '#86c3c4', 400: '#5aa5a6', 500: '#3e8a8b', 600: '#316d6e', 700: '#285a5b', 800: '#20494a', 900: '#173536' },
      },
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'] },
      boxShadow: { card: '0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.06)' },
    },
  },
  plugins: [],
};
