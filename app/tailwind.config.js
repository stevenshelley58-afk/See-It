/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        neutral: {
          50: '#fafafa',
          100: '#f5f5f5',
          200: '#e5e5e5',
          400: '#a3a3a3',
          500: '#737373',
          600: '#525252',
          700: '#404040',
          900: '#171717',
        },
        emerald: {
          50: '#ecfdf5',
          500: '#10b981',
          700: '#047857',
        },
        red: {
          50: '#fef2f2',
          500: '#ef4444',
          700: '#b91c1c',
        },
        amber: {
          50: '#fffbeb',
          500: '#f59e0b',
          700: '#b45309',
        },
      },
    },
  },
  corePlugins: {
    preflight: false, // Disable preflight to avoid conflicts with Shopify Admin/Polaris
  },
  plugins: [],
}

