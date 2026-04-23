import { defineConfig } from 'vitest/config';

// 浏览器 API（window、MessageEvent、HTMLIFrameElement）依赖 jsdom 模拟。
export default defineConfig({
    test: {
        environment: 'jsdom',
        globals: true,
        setupFiles: ['./vitest.setup.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html'],
            lines: 90,
        },
    },
});
