/**
 * @file tailwind.config.js
 * @description Tailwind 静态构建配置。
 *
 * 背景：站点原来用 `cdn.tailwindcss.com`（Tailwind Play CDN）。那是官方标注
 * **not for production** 的运行时编译版：在浏览器里现场生成 CSS、首屏有 FOUC、
 * 外网一断全站没样式。改成构建期生成静态 CSS 后，这条外部依赖彻底去掉。
 *
 * ★ 配置必须与原先 index.html 内联的 `tailwind.config = {...}` 完全一致，
 *   否则颜色/动画会变（primary-*、slide-up 等）。
 *
 * ★ content 必须覆盖 js/：大量 class 是在 JS 里拼进 innerHTML 的字符串字面量，
 *   不扫描 js/ 会漏生成样式。已确认代码里没有「class 名片段插值」
 *   （如 `text-${color}-500`），全部是完整类名字面量，静态扫描可靠。
 */
module.exports = {
    darkMode: 'class',
    content: ['./index.html', './admin.html', './js/**/*.js'],
    theme: {
        extend: {
            colors: {
                primary: { 50: '#f0fdfa', 100: '#ccfbf1', 500: '#14b8a6', 600: '#0d9488', 700: '#0f766e' },
                slate: { 850: '#1e293b', 900: '#0f172a' }
            },
            fontFamily: { sans: ['Inter', '-apple-system', 'sans-serif'] },
            animation: {
                'slide-up': 'slideUp 0.3s cubic-bezier(0.2, 0.8, 0.2, 1) forwards',
                'slide-in': 'slideIn 0.3s cubic-bezier(0.2, 0.8, 0.2, 1) forwards',
                'fade-in': 'fadeIn 0.2s ease-out forwards',
                'pop': 'pop 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards',
                'shake': 'shake 0.5s cubic-bezier(.36,.07,.19,.97) both'
            },
            keyframes: {
                slideUp: { '0%': { transform: 'translateY(20px)', opacity: 0 }, '100%': { transform: 'translateY(0)', opacity: 1 } },
                slideIn: { '0%': { transform: 'translateX(16px)', opacity: 0 }, '100%': { transform: 'translateX(0)', opacity: 1 } },
                fadeIn: { '0%': { opacity: 0 }, '100%': { opacity: 1 } },
                pop: { '0%': { transform: 'scale(0.95)' }, '100%': { transform: 'scale(1)' } },
                shake: {
                    '10%, 90%': { transform: 'translate3d(-1px, 0, 0)' },
                    '20%, 80%': { transform: 'translate3d(2px, 0, 0)' },
                    '30%, 50%, 70%': { transform: 'translate3d(-4px, 0, 0)' },
                    '40%, 60%': { transform: 'translate3d(4px, 0, 0)' }
                }
            }
        }
    }
};
