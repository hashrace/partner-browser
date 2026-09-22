import {
    CHANNEL,
    Envelope,
    DownEventMap,
    DownEventName,
    UpEventMap,
    UpEventName,
    assertSendableDownEvent,
} from './events';
import { isExpectedOrigin, DEFAULT_CHILD_ORIGIN } from './origin';

/**
 * 创建 PartnerClient 时的可选参数。
 */
export interface PartnerClientOptions {
    /** Partner 页面已经创建并挂入 DOM 的 iframe 元素。 */
    iframe: HTMLIFrameElement;
    /**
     * 期望的 iframe 侧 origin。默认 DEFAULT_CHILD_ORIGIN（生产）。
     * 支持数组以适配多环境（staging/prod）；send() 发消息时用数组首元素作 targetOrigin。
     */
    expectedChildOrigin?: string | readonly string[];
    /**
     * 安全违规回调。触发时机：
     *   - origin 不在白名单（大概率被钓鱼或第三方脚本误触发）
     *   - 用户注册的 on() handler 抛错
     * Partner 可在此打点告警；不传则默认忽略。
     */
    onSecurityViolation?: (reason: string, detail: unknown) => void;
}

/**
 * ack 函数签名：仅 iframe.exit_request 事件需要 ack 回包，
 * Partner 调用 `ack({ accepted: true/false })` 告知 iframe 是否允许退出。
 */
export type AckSender = (payload: { accepted: boolean }) => void;

/**
 * 上行事件 handler。对 iframe.exit_request 事件，ack 参数是必须同步调用的回调函数；
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
 *   - postMessage targetOrigin 严格使用 expected（数组取首元素），不使用 "*"
 */
export function createPartnerClient(opts: PartnerClientOptions): PartnerClient {
    const expected = opts.expectedChildOrigin ?? DEFAULT_CHILD_ORIGIN;
    const handlers = new Map<string, UpHandler<UpEventName>>();
    const onViolation = opts.onSecurityViolation ?? (() => { /* no-op */ });

    // 计算 postMessage 的 targetOrigin：若配置为数组取首元素（staging/prod 二选一），
    // 否则直接使用字符串。绝不使用 "*" 以避免向任意 origin 泄漏消息。
    const targetOrigin: string = (() => {
        if (Array.isArray(expected)) {
            return expected[0] ?? DEFAULT_CHILD_ORIGIN;
        }
        return expected as string;
    })();

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

        const h = handlers.get(data.event);
        if (!h) return;

        // ack 机制：目前只有 iframe.exit_request 需要 ack 回包
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
                targetOrigin,
            );
        },
        dispose() {
            window.removeEventListener('message', onMessage);
            handlers.clear();
        },
    };
}
