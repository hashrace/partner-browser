import { defineConfig } from 'tsup';

// 构建产物：ES Module + CommonJS + .d.ts 三份，目标浏览器 ES2019。
// sideEffects: false（在 package.json 声明）+ minify 以保持 gzipped < 5 KB 目标。
export default defineConfig({
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    sourcemap: true,
    minify: true,
    target: 'es2019',
    outExtension({ format }) {
        return {
            js: format === 'cjs' ? '.cjs' : '.mjs',
        };
    },
});
