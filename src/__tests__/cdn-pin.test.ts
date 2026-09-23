import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 对外文档与示例里的 CDN 引用：版本必须锁死、必须带 SRI。
 *
 * 守的回归：Partner 会把文档里的片段原样抄进自己的收银页。不锁版本的 CDN 地址（`@latest`、
 * 不带版本）意味着 CDN 上换了产物，Partner 页面就静默跑上另一份代码；不带 integrity 意味着
 * CDN 被投毒时浏览器照样执行。两者在页面上都没有任何现象。
 *
 * 判据：
 *   - CDN 地址必须带精确版本 `@x.y.z`
 *   - CDN 地址只能出现在带 `integrity="sha384-…|sha512-…"` 与 `crossorigin` 的 `<script>` / `<link>` 标签里；
 *     `import … from 'https://cdn…'` 这类写法浏览器没有给它挂 SRI 的位置，一律不许
 */

const CDN_HOSTS = ['unpkg.com', 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'esm.sh', 'cdn.skypack.dev'];
const CDN_URL = new RegExp(`https?://(?:${CDN_HOSTS.map((h) => h.replace(/\./g, '\\.')).join('|')})/[^\\s"'<>)\`]+`, 'g');
const TAG = /<(script|link)\b[^>]*>/gis;

export function cdnViolations(text: string): string[] {
    const bad: string[] = [];
    const inTags = new Set<string>();
    for (const m of text.matchAll(TAG)) {
        const tag = m[0];
        for (const u of tag.match(CDN_URL) ?? []) {
            inTags.add(u);
            if (!/@\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?(?:\/|$)/.test(u)) bad.push(`${u}：没有锁精确版本 @x.y.z`);
            if (!/\bintegrity\s*=\s*["']sha(?:384|512)-[A-Za-z0-9+/=]+["']/.test(tag)) bad.push(`${u}：标签缺 integrity（sha384 / sha512）`);
            if (!/\bcrossorigin\b/.test(tag)) bad.push(`${u}：标签缺 crossorigin，SRI 对跨源脚本不生效`);
        }
    }
    for (const u of text.match(CDN_URL) ?? []) {
        if (!inTags.has(u)) bad.push(`${u}：出现在 <script> / <link> 标签之外（import 语句等），挂不上 SRI`);
    }
    return bad;
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// 语料取受版本控制的文件，排除 node_modules / dist 这类产物目录。
function corpus(): string[] {
    const out = execFileSync('git', ['ls-files', '-z', '--', 'README.md', 'docs', 'examples'], {
        cwd: repoRoot,
        encoding: 'utf8',
    });
    return out.split('\0').filter((f) => /\.(md|html|tsx?|vue)$/.test(f));
}

describe('CDN 引用锁版本 + SRI', () => {
    it('判据本身：未锁版本 / 缺 integrity / 在 import 里都会被认出来', () => {
        expect(cdnViolations('<script src="https://unpkg.com/@hashrace/partner-browser"></script>')).toHaveLength(3);
        expect(cdnViolations('<script src="https://unpkg.com/@hashrace/partner-browser@latest/dist/index.mjs" integrity="sha384-abc" crossorigin="anonymous"></script>')).toHaveLength(1);
        expect(cdnViolations("import { x } from 'https://cdn.jsdelivr.net/npm/@hashrace/partner-browser@0.2.0/dist/index.mjs';")).toHaveLength(1);
        expect(
            cdnViolations(
                '<script type="module"\n  src="https://cdn.jsdelivr.net/npm/@hashrace/partner-browser@0.2.0/dist/index.mjs"\n  integrity="sha384-Zm9v" crossorigin="anonymous"></script>',
            ),
        ).toEqual([]);
    });

    it('README / docs / examples 里的每一处 CDN 引用都合规', () => {
        const files = corpus();
        // 语料取不到与「全部合规」必须可区分：README 与对外接入文档一定在语料里。
        expect(files).toContain('README.md');
        expect(files).toContain('docs/integration-guide.md');
        const bad = files.flatMap((f) => cdnViolations(readFileSync(resolve(repoRoot, f), 'utf8')).map((v) => `${f}: ${v}`));
        expect(bad).toEqual([]);
    });
});
