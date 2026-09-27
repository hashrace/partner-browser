import {
    CHANNEL,
    Envelope,
    DownEventMap,
    DownEventName,
    UpEventMap,
    UpEventName,
    assertSendableDownEvent,
} from './events';
import { isExpectedOrigin } from './origin';

/**
 * 创建 PartnerClient 时的可选参数。
 */
export interface PartnerClientOptions {
    /** Partner 页面已经创建并挂入 DOM 的 iframe 元素。 */
    iframe: HTMLIFrameElement;
    /**
     * 期望的 iframe 侧 origin，即启动链接的 origin（`https://{Hashrace 游戏域名}`）。
     * 游戏域名开通时由 Hashrace 告知、按环境不同，所以没有默认值——猜一个默认域名，
     * 猜错时所有消息被静默当成钓鱼丢弃。embed / popup 两个入口从 launchUrl 自动取。
     * 支持数组以适配多环境（staging/prod）。发消息时 targetOrigin 取最近一次通过校验的
     * 上行消息的 origin；还没收到过时取 iframe.src 的 origin（须在白名单内），再退到数组首元素。
     */
    expectedChildOrigin: string | readonly string[];
    /**
     * 安全违规回调。触发时机：
     *   - origin 不在白名单（大概率被钓鱼或第三方脚本误触发）
     *   - 用户注册的 on() handler 抛错
     * Partner 可在此打点告警；不传则默认忽略。
     */
    onSecurityViolation?: (reason: string, detail: unknown) => void;
}

/**
 * 回执函数签名：仅 iframe.exit_request 事件带它。回执可选，iframe 不等待也不按
 * `accepted` 改变行为；不调用不会有任何后果。
 */
export type AckSender = (payload: { accepted: boolean }) => void;

/**
 * 上行事件 handler。对 iframe.exit_request 事件，ack 参数是可选调用的回执函数；
 * 其他事件 ack 为 undefined。
 */
export type UpHandler<E extends UpEventName> = (
    payload: UpEventMap[E],
    ack: E extends 'iframe.exit_request' ? AckSender : undefined,
) => void;

/**
 * PartnerClient 公共接口。生命周期由 Partner 管理——页面卸载时调用 dispose()。
 */
export interface PartnerClient {
    /** 订阅某个上行事件。重复订阅会覆盖之前的 handler。 */
    on<E extends UpEventName>(event: E, handler: UpHandler<E>): void;
    /** 取消订阅。 */
    off<E extends UpEventName>(event: E): void;
    /**
     * 向 iframe 发送下行事件。event 不在 DownEventMap 白名单内（含禁止事件）直接抛错。
     * iframe 侧当前不消费任何下行事件，发出去不会有效果。
     */
    send<E extends DownEventName>(event: E, payload: DownEventMap[E]): void;
    /** 解除 window message 监听并清空所有订阅。必须在 iframe 销毁前调用以避免内存泄漏。 */
    dispose(): void;
}

/**
 * 创建 PartnerClient 实例。
 *
 * 安全校验顺序（任一失败即丢弃消息）：
 *   1. `event.source === iframe.contentWindow`——防止页面内多个 iframe 串消息
 *   2. `isExpectedOrigin(event.origin, expected)`——防止钓鱼 origin 冒充
 *   3. `data.channel === 'hashrace.v1'`——与其他库的 postMessage 互不干扰
 *
 * 发送路径：
 *   - 不在 DownEventMap 白名单内的事件抛错（禁止事件给出专门的报错）
 *   - postMessage targetOrigin 取已通过 origin 校验的那个 origin（回执用触发它的那条消息的
 *     `e.origin`），不使用 "*"——数组配置下固定取首元素，iframe 实际在另一环境时回执与
 *     下行消息会被浏览器按 origin 不符静默丢弃
 */
export function createPartnerClient(opts: PartnerClientOptions): PartnerClient {
    const expected = opts.expectedChildOrigin;
    if (Array.isArray(expected) ? expected.length === 0 : !expected) {
        throw new Error('[@hashrace/partner-browser] expectedChildOrigin is required (the origin of the launch URL)');
    }
    const handlers = new Map<string, UpHandler<UpEventName>>();
    const onViolation = opts.onSecurityViolation ?? (() => { /* no-op */ });

    // 最近一次通过 origin 校验的上行消息的 origin。绝不使用 "*"：只往白名单内、
    // 且确实是 iframe 当前所在的 origin 发。
    let verifiedOrigin: string | undefined;
    const sendTarget = (): string => {
        if (verifiedOrigin) return verifiedOrigin;
        try {
            const src = new URL(opts.iframe.src).origin;
            if (isExpectedOrigin(src, expected)) return src;
        } catch {
            // iframe.src 为空或不是绝对 URL：退到配置
        }
        return (Array.isArray(expected) ? expected[0] : expected) as string;
    };

    const onMessage = (e: MessageEvent): void => {
        // 1. source 必须是本 client 绑定的 iframe 的 contentWindow
        if (e.source !== opts.iframe.contentWindow) return;

        // 2. origin 白名单校验
        if (!isExpectedOrigin(e.origin, expected)) {
            onViolation('origin_mismatch', { origin: e.origin });
            return;
        }

        const data = e.data as Envelope<string, unknown> | undefined;
        if (!data || typeof data !== 'object') return;

        // 3. channel 校验，避免与其他库共用 postMessage 时串包
        if (data.channel !== CHANNEL) return;

        const replyOrigin = e.origin;
        verifiedOrigin = replyOrigin;

        const h = handlers.get(data.event);
        if (!h) return;

        // 回执：目前只有 iframe.exit_request 带回执函数（可选调用）
        const needsAck = data.event === 'iframe.exit_request';
        const ack: AckSender | undefined = needsAck
            ? (ackPayload) => {
                opts.iframe.contentWindow?.postMessage(
                    {
                        channel: CHANNEL,
                        event: 'iframe.exit_request.ack',
                        payload: ackPayload,
                        nonce: data.nonce,
                    },
                    replyOrigin,
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

    return {
        on(event, handler) {
            handlers.set(event, handler as UpHandler<UpEventName>);
        },
        off(event) {
            handlers.delete(event);
        },
        send(event, payload) {
            assertSendableDownEvent(String(event));
            opts.iframe.contentWindow?.postMessage(
                {
                    channel: CHANNEL,
                    event,
                    payload,
                    nonce: crypto.randomUUID(),
                },
                sendTarget(),
            );
        },
        dispose() {
            window.removeEventListener('message', onMessage);
            handlers.clear();
        },
    };
}
