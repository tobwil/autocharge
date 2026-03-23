/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        solar: '#f59e0b',
        grid: '#6366f1',
        ev: '#10b981',
        battery: '#3b82f6',
        house: '#8b5cf6',
      },
    },
  },
  plugins: [],
}
