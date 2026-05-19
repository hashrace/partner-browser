import {
    CHANNEL,
    DownEventMap,
    DownEventName,
    FORBIDDEN_DOWN_EVENTS,
    UpEventName,
} from './events';
import type { AckSender, UpHandler } from './client';

/**
 * embedHashraceIframe / launchInPopup 默认的 iframe `allow` 属性。
 *
 * 与 PG Soft / Pragmatic Play 等 B2B 厂商的 Partner 父页基线对齐——四项权限：
 *   - web-share *       : navigator.share() 社交分享
 *   - clipboard-write * : navigator.clipboard.writeText() 复制 trace_id / verify URL
 *   - screen-wake-lock *: 长 round 防屏幕休眠（slot 自动旋转 / crash 高倍率等待）
 *   - fullscreen *      : 游戏全屏模式
 *
 * 若未授权，对应 navigator API 在 iframe 内会被浏览器静默拒绝；玩家会看到
 * "按钮无响应" 的故障表现，排查路径极长。SDK 默认开启避免 Partner 遗漏。
 *
 * 调用方传 `iframeAllow: ''` 可显式 opt-out（不设 allow 属性）。
 */
export const DEFAULT_IFRAME_ALLOW =
    'web-share *; clipboard-write *; screen-wake-lock *; fullscreen *';

/**
 * launchInPopup 配置选项。
 */
export interface LaunchInPopupOptions {
    /** 游戏启动 URL（含 launch_token query）。必须 https:// 或 http://localhost。 */
    launchUrl: string;
    /**
     * 期望的 HashMach iframe 侧 origin。默认从 launchUrl 解析，多环境可传数组。
     */
    expectedChildOrigin?: string | readonly string[];
    /** popup window 尺寸 + 位置。默认 1280 × 720。 */
    window?: {
        width: number;
        height: number;
        left?: number;
        top?: number;
    };
    /** popup window 名字 (window.open 第二参数)。同名复用窗口；不传则匿名新窗口。 */
    name?: string;
    /** iframe 上的 allow 属性。默认 DEFAULT_IFRAME_ALLOW；传 '' 显式 opt-out。 */
    iframeAllow?: string;
    /** 安全违规回调，与 createPartnerClient 同语义。 */
    onSecurityViolation?: (reason: string, detail: unknown) => void;
    /** popup 被浏览器拦截时的回调。触发后 SDK 函数返回 null。 */
    onPopupBlocked?: () => void;
}

/**
 * launchInPopup 返回的句柄。
 *
 * 接口形态与 PartnerClient 对齐（on / off / send / dispose），另加 popup window
 * 控制能力（close / focus / onClosed / closed flag）。
 */
export interface PopupHandle {
    /** 订阅 hashrace.v1 上行事件。重复订阅会覆盖之前的 handler。 */
    on<E extends UpEventName>(event: E, handler: UpHandler<E>): void;
    /** 取消订阅。 */
    off<E extends UpEventName>(event: E): void;
    /** 向 iframe 发下行事件（白名单内）。FORBIDDEN_DOWN_EVENTS 会抛错。 */
    send<E extends DownEventName>(event: E, payload: DownEventMap[E]): void;
    /** 程序化关闭 popup window；自然关闭时也会触发 onClosed。 */
    close(): void;
    /** popup window 是否已关闭。 */
    readonly closed: boolean;
    /** popup window focus 到前台。 */
    focus(): void;
    /** 注册 popup 关闭回调（按注册顺序触发；可注册多个）。 */
    onClosed(cb: () => void): void;
    /** 解除事件订阅 + window 监听 + 释放内部 timer。popup 已关时调用是 no-op。 */
    dispose(): void;
}

// relay 三种信封（约束于 opener ↔ wrapper 之间，不会跨入 iframe）：
//   hashrace.v1-relay      : wrapper → opener，转发 iframe 上行
//   hashrace.v1-relay-down : opener → wrapper，转发为 iframe 下行
//   hashrace.v1-relay-ack  : opener → wrapper，转发为 iframe.exit_request.ack
const RELAY_UP = 'hashrace.v1-relay';
const RELAY_DOWN = 'hashrace.v1-relay-down';
const RELAY_ACK = 'hashrace.v1-relay-ack';

function computeWindowFeatures(win?: LaunchInPopupOptions['window']): string {
    const w = win?.width ?? 1280;
    const h = win?.height ?? 720;
    const features: string[] = [
        `width=${w}`,
        `height=${h}`,
        // 显式声明 popup=yes 让浏览器尽量按真正的小窗（而非新 tab）打开
        'popup=yes',
        // 不要 noopener — relay 模式必须 opener / popup 互访
        'noopener=no',
        'noreferrer=no',
    ];
    if (win?.left !== undefined) features.push(`left=${win.left}`);
    if (win?.top !== undefined) features.push(`top=${win.top}`);
    return features.join(',');
}

// JSON.stringify 默认不转义 '<'；嵌入 <script> 时必须自行转义，否则 launchUrl
// 内的 `</script>` 字面可被解析器误认为闭合标签提前结束脚本。
function jsonForScript(value: unknown): string {
    return JSON.stringify(value).replace(/</g, '\\u003c');
}

function buildWrapperHTML(params: {
    launchUrl: string;
    expectedChildOrigin: string | readonly string[];
    iframeAllow: string;
    openerOrigin: string;
}): string {
    const allowAttr = params.iframeAllow ? ` allow=${jsonForScript(params.iframeAllow)}` : '';
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>HashMach</title></head>
<body style="margin:0;background:#000">
<iframe src=${jsonForScript(params.launchUrl)}${allowAttr} style="width:100vw;height:100vh;border:0"></iframe>
<script>
(function(){
    var iframe = document.querySelector('iframe');
    var expected = ${jsonForScript(params.expectedChildOrigin)};
    var openerOrigin = ${jsonForScript(params.openerOrigin)};
    var CHANNEL = ${jsonForScript(CHANNEL)};
    var RELAY_UP = ${jsonForScript(RELAY_UP)};
    var RELAY_DOWN = ${jsonForScript(RELAY_DOWN)};
    var RELAY_ACK = ${jsonForScript(RELAY_ACK)};
    function isExpected(actual){
        if(!actual || actual === 'null') return false;
        var list = Array.isArray(expected) ? expected : [expected];
        return list.indexOf(actual) !== -1;
    }
    function targetForIframe(){
        return Array.isArray(expected) ? expected[0] : expected;
    }
    window.addEventListener('message', function(e){
        // iframe → opener 转发
        if (e.source === iframe.contentWindow) {
            if (!isExpected(e.origin)) return;
            var d = e.data;
            if (!d || typeof d !== 'object') return;
            if (d.channel !== CHANNEL) return;
            if (!window.opener) return;
            window.opener.postMessage({
                channel: RELAY_UP,
                event: d.event,
                payload: d.payload,
                nonce: d.nonce
            }, openerOrigin);
            return;
        }
        // opener → iframe 转发
        if (e.source === window.opener) {
            if (e.origin !== openerOrigin) return;
            var d2 = e.data;
            if (!d2 || typeof d2 !== 'object') return;
            var t = targetForIframe();
            if (d2.channel === RELAY_DOWN) {
                iframe.contentWindow.postMessage({
                    channel: CHANNEL,
                    event: d2.event,
                    payload: d2.payload,
                    nonce: d2.nonce
                }, t);
                return;
            }
            if (d2.channel === RELAY_ACK) {
                iframe.contentWindow.postMessage({
                    channel: CHANNEL,
                    event: 'iframe.exit_request.ack',
                    payload: d2.payload,
                    nonce: d2.nonce
                }, t);
                return;
            }
        }
    });
})();
</script>
</body></html>`;
}

function makeNonce(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return 'r' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * 以 popup window 形式启动 HashMach 游戏。
 *
 * 实现机制：
 *   1. window.open('about:blank', name, features) 创建 popup（必须在 user gesture 同步路径内调用以避开 popup blocker）
 *   2. popup 内 document.write 注入 wrapper HTML（含 iframe + relay 转发脚本）
 *   3. wrapper 监听 iframe 上行 hashrace.v1 消息 → 转发到 window.opener
 *   4. opener 端 PopupHandle 监听 popup 发来的 hashrace.v1-relay 信封 → 路由到 on() handler
 *   5. PopupHandle.send / ack 反向走 hashrace.v1-relay-down / hashrace.v1-relay-ack 信封
 *
 * 调用约束：
 *   - 必须在 user gesture 同步路径调用（点击事件 handler 内），否则浏览器拦截
 *   - launchUrl 必须 https://（dev 例外允许 http://localhost）
 *
 * 返回 null 表示被 popup blocker 拦截；调用方应在 onPopupBlocked 回调里给用户提示。
 */
export function launchInPopup(opts: LaunchInPopupOptions): PopupHandle | null {
    // 1. URL 协议校验（同步抛错，调用方编程错误）
    const url = new URL(opts.launchUrl);
    const isLocalhostHttp = url.protocol === 'http:' && url.hostname === 'localhost';
    if (url.protocol !== 'https:' && !isLocalhostHttp) {
        throw new Error(
            '[@hashrace/partner-browser] launchUrl must be https:// (or http://localhost for dev)',
        );
    }

    const expected = opts.expectedChildOrigin ?? url.origin;
    const iframeAllow = opts.iframeAllow ?? DEFAULT_IFRAME_ALLOW;
    const features = computeWindowFeatures(opts.window);

    // 2. 创建 popup（user gesture 时机）
    const popup = window.open('about:blank', opts.name ?? '_blank', features);
    if (!popup) {
        opts.onPopupBlocked?.();
        return null;
    }

    // 3. 注入 wrapper HTML
    const openerOrigin = window.location.origin;
    const wrapperHTML = buildWrapperHTML({
        launchUrl: opts.launchUrl,
        expectedChildOrigin: expected,
        iframeAllow,
        openerOrigin,
    });
    try {
        popup.document.open();
        popup.document.write(wrapperHTML);
        popup.document.close();
    } catch (err) {
        opts.onSecurityViolation?.('popup_write_failed', err);
        try { popup.close(); } catch { /* ignore */ }
        return null;
    }

    // 4. 父页 PopupHandle 状态
    const handlers = new Map<string, UpHandler<UpEventName>>();
    const closedCallbacks: Array<() => void> = [];
    const onViolation = opts.onSecurityViolation ?? ((): void => { /* no-op */ });
    let disposed = false;
    let closed = false;
    const targetOrigin = openerOrigin; // wrapper inherits opener origin via about:blank

    const onMessage = (e: MessageEvent): void => {
        if (e.source !== popup) return;
        if (e.origin !== openerOrigin) {
            onViolation('relay_origin_mismatch', { origin: e.origin });
            return;
        }
        const data = e.data as
            | { channel?: string; event?: string; payload?: unknown; nonce?: string }
            | undefined;
        if (!data || typeof data !== 'object') return;
        if (data.channel !== RELAY_UP) return;
        if (typeof data.event !== 'string') return;
        const h = handlers.get(data.event);
        if (!h) return;
        const needsAck = data.event === 'iframe.exit_request';
        const ack: AckSender | undefined = needsAck
            ? (ackPayload): void => {
                if (closed || disposed) return;
                popup.postMessage(
                    {
                        channel: RELAY_ACK,
                        payload: ackPayload,
                        nonce: data.nonce,
                    },
                    targetOrigin,
                );
            }
            : undefined;
        try {
            (h as (payload: unknown, ack: AckSender | undefined) => void)(data.payload, ack);
        } catch (err) {
            onViolation('handler_error', err);
        }
    };
    window.addEventListener('message', onMessage);

    // 5. popup 关闭轮询：250ms 检查 popup.closed 并触发 onClosed
    const closePoll: ReturnType<typeof setInterval> = setInterval(() => {
        if (popup.closed && !closed) {
            closed = true;
            clearInterval(closePoll);
            window.removeEventListener('message', onMessage);
            closedCallbacks.forEach((cb) => {
                try { cb(); } catch (err) { onViolation('on_closed_error', err); }
            });
        }
    }, 250);

    const handle: PopupHandle = {
        on(event, handler) {
            handlers.set(event, handler as UpHandler<UpEventName>);
        },
        off(event) {
            handlers.delete(event);
        },
        send(event, payload) {
            if (FORBIDDEN_DOWN_EVENTS.includes(event as string)) {
                throw new Error(
                    `[@hashrace/partner-browser] forbidden event: ${String(event)} — this event must not be sent from Partner page; route through Seamless Wallet / server-side channel instead.`,
                );
            }
            if (closed || disposed) return;
            popup.postMessage(
                {
                    channel: RELAY_DOWN,
                    event,
                    payload,
                    nonce: makeNonce(),
                },
                targetOrigin,
            );
        },
        close() {
            if (!closed && !popup.closed) {
                try { popup.close(); } catch { /* ignore */ }
            }
        },
        get closed() {
            return closed || popup.closed;
        },
        focus() {
            if (!closed && !popup.closed) {
                try { popup.focus(); } catch { /* ignore */ }
            }
        },
        onClosed(cb) {
            closedCallbacks.push(cb);
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            clearInterval(closePoll);
            window.removeEventListener('message', onMessage);
            handlers.clear();
        },
    };
    return handle;
}
