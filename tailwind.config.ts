import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#0b0a1a',
          900: '#141232',
          800: '#1d1a45',
          700: '#2a2660',
          600: '#3b3585',
        },
        accent: {
          DEFAULT: '#ffd166',
          soft: '#ffe6a8',
        },
        mint: '#4ade80',
        coral: '#fb7185',
      },
      fontFamily: {
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        pop: {
          '0%': { transform: 'scale(0.8)', opacity: '0' },
          '60%': { transform: 'scale(1.06)', opacity: '1' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        pop: 'pop 320ms cubic-bezier(0.34, 1.56, 0.64, 1)',
        shimmer: 'shimmer 2.4s linear infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
