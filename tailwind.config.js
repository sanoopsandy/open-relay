/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/renderer/**/*.{ts,tsx,html}',
    './index.html',
  ],
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
          dim: 'var(--accent-dim)',
        },
      },
      fontFamily: {
        mono: [
          'SF Mono',
          'JetBrains Mono',
          'Fira Code',
          'ui-monospace',
          'monospace',
        ],
      },
      animation: {
        blink: 'blink 1s step-start infinite',
        'bounce-dot': 'bounce 0.8s infinite',
      },
      keyframes: {
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
        },
      },
      typography: {
        DEFAULT: {
          css: {
            color: 'var(--text-primary)',
            a: { color: 'var(--accent)' },
            code: {
              backgroundColor: 'var(--bg-input)',
              borderRadius: '0.25rem',
              padding: '0.125rem 0.375rem',
            },
            'code::before': { content: 'none' },
            'code::after': { content: 'none' },
            pre: {
              backgroundColor: 'var(--bg-input)',
              border: '1px solid var(--border)',
            },
          },
        },
      },
    },
  },
  plugins: [
    // Provides `prose` classes for markdown rendering in chat messages.
    // Run: npm install -D @tailwindcss/typography
    ...((() => { try { return [require('@tailwindcss/typography')]; } catch { return []; } })()),
  ],
};
