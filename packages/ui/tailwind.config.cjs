/** Semantic colours resolve to the CSS variables in src/styles/tokens.css, so themes swap without touching classes. */
const v = (name) => `rgb(var(--fs-${name}) / <alpha-value>)`;
module.exports = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: { DEFAULT: v('paper'), 2: v('paper-2') },
        surface: { DEFAULT: v('surface'), 2: v('surface-2') },
        ink: { DEFAULT: v('ink'), 2: v('ink-2'), 3: v('ink-3') },
        line: { DEFAULT: v('line'), 2: v('line-2') },
        accent: { DEFAULT: v('accent'), ink: v('accent-ink'), soft: v('accent-soft'), fg: v('accent-fg') },
        primary: { DEFAULT: v('primary'), fg: v('primary-fg') },
        jade: { DEFAULT: v('jade'), soft: v('jade-soft') },
        seal: { DEFAULT: v('seal'), soft: v('seal-soft') },
        // a warning: worth a look, not an error (a page drawn with a check it did not pass)
        warn: { DEFAULT: v('warn'), soft: v('warn-soft') },
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', '-apple-system', 'BlinkMacSystemFont', '"PingFang SC"', '"Hiragino Sans GB"', '"Noto Sans SC"', '"Microsoft YaHei"', 'sans-serif'],
        display: ['"Playfair Display"', '"Songti SC"', '"STSong"', '"Noto Serif SC"', '"Source Han Serif SC"', 'serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      transitionTimingFunction: { out: 'cubic-bezier(0.16, 1, 0.3, 1)' },
      keyframes: {
        rise: { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'none' } },
        fade: { from: { opacity: '0' }, to: { opacity: '1' } },
        eq: { '0%,100%': { transform: 'scaleY(0.35)' }, '50%': { transform: 'scaleY(1)' } },
        pop: { from: { opacity: '0', transform: 'scale(0.92)' }, to: { opacity: '1', transform: 'none' } },
        trace: { to: { strokeDashoffset: '0' } },
        breathe: { '0%,100%': { opacity: '0.45' }, '50%': { opacity: '1' } },
        shimmer: { from: { backgroundPosition: '150% 0' }, to: { backgroundPosition: '-50% 0' } },
        halo: { '0%': { transform: 'scale(1)', opacity: '0.55' }, '100%': { transform: 'scale(1.9)', opacity: '0' } },
        slide: { from: { opacity: '0', transform: 'translateX(28px)' }, to: { opacity: '1', transform: 'none' } },
      },
      animation: {
        rise: 'rise 320ms cubic-bezier(0.16,1,0.3,1) both',
        fade: 'fade 240ms ease-out both',
        pop: 'pop 160ms cubic-bezier(0.16,1,0.3,1) both',
        breathe: 'breathe 1.8s ease-in-out infinite',
        shimmer: 'shimmer 2.2s linear infinite',
        halo: 'halo 1.6s cubic-bezier(0.16,1,0.3,1) infinite',
        slide: 'slide 320ms cubic-bezier(0.16,1,0.3,1) both',
      },
    },
  },
  plugins: [],
};
