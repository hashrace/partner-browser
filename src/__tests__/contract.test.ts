import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { UP_EVENT_NAMES } from '../events';
import type { UpEventMap, UpEventName } from '../events';
import { CLIENT_UP_EVENTS, SDK_ONLY_NOT_YET_SENT } from './fixtures/client-up-events';

/**
 * 上行事件契约对账：SDK 认的事件 ↔ 游戏客户端真实发送的事件。
 *
 * 守的回归：各测试文件的 payload 都是自己编的，与真实客户端对不上时照样全绿——
 * 客户端发了 SDK 不认的事件（Partner 永远收不到），或 SDK 文档主推的事件客户端从来不发，
 * 都没有任何测试会红。这里把两边逐一对齐。
 */

// 列出某 payload 类型的全部顶层字段；少列一个字段编译失败，保证下方表格与类型同步。
// 无 payload 的事件（Record<string, never>）只接受空列表。
function keysOf<T>() {
    return <const K extends readonly (keyof T & string)[]>(
        ...keys: K &
            (string extends keyof T
                ? readonly []
                : [Exclude<keyof T, K[number]>] extends [never]
                  ? unknown
                  : { missing: Exclude<keyof T, K[number]> })
    ): readonly string[] => keys;
}

const SDK_PAYLOAD_FIELDS: { [E in UpEventName]: readonly string[] } = {
    'iframe.ready': keysOf<UpEventMap['iframe.ready']>()('client_version', 'protocol_version'),
    'iframe.size_change': keysOf<UpEventMap['iframe.size_change']>()('width', 'height'),
    'iframe.exit_request': keysOf<UpEventMap['iframe.exit_request']>()('reason'),
    'iframe.round_start': keysOf<UpEventMap['iframe.round_start']>()('round_id', 'game_code', 'started_at'),
    'iframe.round_end': keysOf<UpEventMap['iframe.round_end']>()(
        'round_id', 'game_code', 'net_change_minor', 'currency', 'ended_at',
    ),
    'iframe.error': keysOf<UpEventMap['iframe.error']>()('code', 'trace_id', 'message'),
    'iframe.retry_request': keysOf<UpEventMap['iframe.retry_request']>()(),
    'iframe.support_request': keysOf<UpEventMap['iframe.support_request']>()(),
    'iframe.game_ended': keysOf<UpEventMap['iframe.game_ended']>()('game_id'),
};

// keysOf 自身的守栏：它若退化成不检查，上面那张表就不再和类型同步。
// @ts-expect-error 漏列 game_code 必须编译失败
keysOf<UpEventMap['iframe.round_start']>()('round_id', 'started_at');

const sorted = (xs: readonly string[]): string[] => [...xs].sort();

describe('上行事件契约：SDK ↔ 客户端清单', () => {
    it('客户端发送的每个事件 SDK 都认', () => {
        const unknownToSdk = Object.keys(CLIENT_UP_EVENTS).filter(
            (e) => !(UP_EVENT_NAMES as readonly string[]).includes(e),
        );
        expect(unknownToSdk, '客户端发了、SDK 不认的事件（Partner 收不到）').toEqual([]);
    });

    it('SDK 认的每个事件要么客户端在发，要么如实记在「未接」清单里', () => {
        const unaccounted = UP_EVENT_NAMES.filter(
            (e) => !(e in CLIENT_UP_EVENTS) && !SDK_ONLY_NOT_YET_SENT.includes(e),
        );
        expect(unaccounted, 'SDK 认了、客户端不发、也没记进未接清单的事件').toEqual([]);

        const both = SDK_ONLY_NOT_YET_SENT.filter((e) => e in CLIENT_UP_EVENTS);
        expect(both, '客户端已经在发，却还挂在未接清单里').toEqual([]);

        const stale = SDK_ONLY_NOT_YET_SENT.filter(
            (e) => !(UP_EVENT_NAMES as readonly string[]).includes(e),
        );
        expect(stale, '未接清单里有 SDK 已不存在的事件').toEqual([]);
    });

    it('客户端发送的 payload 字段与 SDK 类型逐一对齐', () => {
        for (const [event, fields] of Object.entries(CLIENT_UP_EVENTS)) {
            const sdk = SDK_PAYLOAD_FIELDS[event as UpEventName];
            if (!sdk) continue; // 事件名缺失由上一条用例报
            expect(sorted(fields), `${event} 的 payload 字段`).toEqual(sorted(sdk));
        }
    });
});

// ============================================================================
// 兄弟仓自动取数：直接扫客户端源码，核对上面那份夹具本身没有过期
// ============================================================================

const CLIENT_SCRIPTS = join('assets', 'scripts');
// 唯一允许直接调 postMessage 的地方：信封就是在这里封装的
const CHANNEL_IMPL = join('core', 'iframe', 'PostMessageChannel.ts');

function findClientRepo(): string | null {
    if (process.env.HASHRACE_SKIP_CLIENT_CONTRACT === '1') return null;
    const candidates: string[] = [];
    if (process.env.HASHRACE_CLIENT_DIR) candidates.push(process.env.HASHRACE_CLIENT_DIR);
    if (process.env.HASHRACE_ROOT) candidates.push(join(process.env.HASHRACE_ROOT, 'hashmach-client'));
    // 从本文件往上找同级的 hashmach-client（兼容 .worktrees/ 下的工作区）
    let dir = dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 8; i++) {
        candidates.push(join(dir, 'hashmach-client'));
        const parent = resolve(dir, '..');
        if (parent === dir) break;
        dir = parent;
    }
    return candidates.find((c) => existsSync(join(c, CLIENT_SCRIPTS))) ?? null;
}

function listTs(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) out.push(...listTs(p));
        else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(p);
    }
    return out;
}

// 粗剥注释：块注释整段去掉；行注释只在 `//` 前不是 `:` 或引号时去掉，避开 'https://...'
function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
}

/** 从 `{` 开始截出对象字面量顶层字段名；遇到展开或非法段返回 null（无法静态对账）。 */
function literalKeys(src: string, open: number): string[] | null {
    let depth = 0;
    let seg = '';
    const segs: string[] = [];
    for (let i = open; i < src.length; i++) {
        const c = src[i]!;
        if (c === '"' || c === "'" || c === '`') {
            const end = src.indexOf(c, i + 1);
            if (end < 0) return null;
            if (depth === 1) seg += src.slice(i, end + 1);
            i = end;
            continue;
        }
        if (c === '{' || c === '[' || c === '(') {
            depth++;
            if (depth === 1) continue;
        } else if (c === '}' || c === ']' || c === ')') {
            depth--;
            if (depth === 0) {
                segs.push(seg);
                break;
            }
        } else if (c === ',' && depth === 1) {
            segs.push(seg);
            seg = '';
            continue;
        }
        if (depth === 1) seg += c;
    }
    const keys: string[] = [];
    for (const raw of segs) {
        const s = raw.trim();
        if (!s) continue;
        const m = /^([A-Za-z_$][\w$]*|'[^']*'|"[^"]*")\s*(?::|$)/.exec(s);
        if (!m || s.startsWith('...')) return null;
        keys.push(m[1]!.replace(/^['"]|['"]$/g, ''));
    }
    return keys;
}

interface ScanResult {
    events: Record<string, string[]>;
    problems: string[];
}

function scanClient(root: string): ScanResult {
    const scripts = join(root, CLIENT_SCRIPTS);
    const events: Record<string, string[]> = {};
    const problems: string[] = [];
    for (const file of listTs(scripts)) {
        const rel = relative(scripts, file);
        const src = stripComments(readFileSync(file, 'utf8'));
        if (rel !== CHANNEL_IMPL && /\bpostMessage\s*\(/.test(src)) {
            problems.push(`${rel}: 直接调 postMessage，绕过了 hashrace.v1 信封（SDK 收不到）`);
        }
        const re = /\.post\(\s*(['"])(iframe\.[a-z_]+)\1\s*,\s*/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(src))) {
            const event = m[2]!;
            const at = re.lastIndex;
            const keys = src[at] === '{' ? literalKeys(src, at) : null;
            if (!keys) {
                problems.push(`${rel}: ${event} 的 payload 不是纯对象字面量，无法静态对账`);
                continue;
            }
            const prev = events[event];
            if (prev && sorted(prev).join() !== sorted(keys).join()) {
                problems.push(`${rel}: ${event} 在不同发送点的 payload 字段不一致（${prev} / ${keys}）`);
            }
            events[event] = keys;
        }
    }
    return { events, problems };
}

const clientRepo = findClientRepo();
if (!clientRepo) {
    console.warn(
        '[contract] 未找到 hashmach-client 仓，跳过「扫客户端源码核对夹具」。'
        + '设置 HASHRACE_CLIENT_DIR 或 HASHRACE_ROOT 可启用；HASHRACE_SKIP_CLIENT_CONTRACT=1 为显式跳过。',
    );
}

describe.skipIf(!clientRepo)('上行事件契约：夹具 ↔ 客户端源码', () => {
    it('客户端源码里的真实发送点与夹具一致', () => {
        const { events, problems } = scanClient(clientRepo!);
        const normalize = (m: Readonly<Record<string, readonly string[]>>): Record<string, string[]> =>
            Object.fromEntries(Object.keys(m).sort().map((e) => [e, sorted(m[e]!)]));
        // 问题清单与事件对照放在一个断言里，一次红就能看全所有差异
        expect(
            { problems, events: normalize(events) },
            `扫描 ${clientRepo} 的结果 vs fixtures/client-up-events.ts`,
        ).toEqual({ problems: [], events: normalize(CLIENT_UP_EVENTS) });
    });
});
