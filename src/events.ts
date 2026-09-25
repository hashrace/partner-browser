/**
 * hashrace.v1 postMessage 协议——事件 Schema 与禁止事件清单。
 *
 * 本文件定义 Partner 父页面与 Hashrace iframe 之间双向消息的结构化类型。
 * 所有消息都用 Envelope 包裹：`{ channel, event, payload, nonce }`。
 *
 * 约定：
 *   - channel：固定字面量 "hashrace.v1"，跨版本用 "hashrace.v2" 表示破坏性变更
 *   - event：分两个命名空间
 *       · "iframe.*"  — iframe → parent（上行）
 *       · "parent.*"  — parent → iframe（下行）
 *   - payload：每事件有专属 interface，不允许透传任意 JSON
 *   - nonce：UUID v4 字符串；回执（ack，可选）携带原始 nonce 以关联请求
 */

export const CHANNEL = 'hashrace.v1' as const;

// ============================================================================
// iframe → parent（上行）
// ============================================================================

/**
 * iframe 框架加载完成。Partner 收到此事件后可隐藏 loading UI。
 */
export interface IframeReadyPayload {
    client_version: string;
    protocol_version: 'hashrace.v1';
}

/**
 * iframe 内容高度变化，建议父页面调整容器尺寸。
 */
export interface IframeSizeChangePayload {
    width: number;
    height: number;
}

/**
 * iframe 请求退出。reason：user_back = 玩家点了返回；session_expired = 会话已过期。
 *
 * 发出即忘：iframe 不等待回执，也不按回执内容改变行为。Partner 回不回 ack、回 true 还是
 * false 都不影响游戏——要不要收起 iframe 由 Partner 自己决定。
 */
export interface IframeExitRequestPayload {
    reason: 'user_back' | 'session_expired';
}

/**
 * 一局游戏开始。Partner 通常据此打点或锁定某些 UI。
 */
export interface IframeRoundStartPayload {
    round_id: string;
    game_code: string;
    started_at: number;
}

/**
 * 一局游戏结束，含本局净输赢（微元单位）。
 * 净变动已经由 Hashrace 通过 Seamless Webhook 写入 Partner 钱包；
 * Partner 收到此事件只需刷新余额 UI，不要自己做二次记账。
 */
export interface IframeRoundEndPayload {
    round_id: string;
    game_code: string;
    /**
     * 本局玩家净变动，微元（1 个币种单位 = 1,000,000 微元），十进制整数字符串（`^-?[0-9]+$`），
     * 负数表示玩家净亏。用字符串是因为高面值币种的微元金额会越过 `number` 的安全整数范围，
     * 请用 `BigInt(net_change_micro)` 解析，展示时按 `currency` 的小数位换算。
     */
    net_change_micro: string;
    /** 本局币种代码（`^[A-Z]{3,5}$`），与 Seamless Webhook 里的 `currency` 同一取值 */
    currency: string;
    /** 服务端时间戳，Unix 毫秒 */
    ended_at: number;
}

/**
 * iframe 内部错误通知。trace_id 可用于跟工单对应。
 */
export interface IframeErrorPayload {
    code: string;
    trace_id?: string;
    message: string;
}

/**
 * 玩家在维护拦截屏点了「重试」：iframe 内的会话已不可恢复，要求 Partner 重新签发
 * launch URL 并重新挂载 iframe（旧 launch token 是一次性的，不能复用）。无 payload。
 */
export type IframeRetryRequestPayload = Record<string, never>;

/**
 * 玩家在 iframe 内点了「联系客服」。Partner 应打开自家客服入口。无 payload。
 */
export type IframeSupportRequestPayload = Record<string, never>;

/**
 * 玩家离开游戏（点「返回 {品牌}」或正常退出），Partner 应收起 iframe / 回到自家大厅。
 * iframe 发出后不等待父页回应，也没有回执。
 */
export interface IframeGameEndedPayload {
    game_id: string;
}

/**
 * 上行事件名 → payload 映射表。
 */
export interface UpEventMap {
    'iframe.ready': IframeReadyPayload;
    'iframe.size_change': IframeSizeChangePayload;
    'iframe.exit_request': IframeExitRequestPayload;
    'iframe.round_start': IframeRoundStartPayload;
    'iframe.round_end': IframeRoundEndPayload;
    'iframe.error': IframeErrorPayload;
    'iframe.retry_request': IframeRetryRequestPayload;
    'iframe.support_request': IframeSupportRequestPayload;
    'iframe.game_ended': IframeGameEndedPayload;
}

export type UpEventName = keyof UpEventMap;

/**
 * UpEventMap 键的运行时清单。popup wrapper 按它过滤转发，契约测试按它对账客户端。
 * `satisfies` + 下方的穷举断言保证它与 UpEventMap 两向一致：少列、多列都编译失败。
 */
export const UP_EVENT_NAMES = [
    'iframe.ready',
    'iframe.size_change',
    'iframe.exit_request',
    'iframe.round_start',
    'iframe.round_end',
    'iframe.error',
    'iframe.retry_request',
    'iframe.support_request',
    'iframe.game_ended',
] as const satisfies readonly UpEventName[];

type MissingUpEvents = Exclude<UpEventName, (typeof UP_EVENT_NAMES)[number]>;
const upEventsExhaustive: [MissingUpEvents] extends [never] ? true : MissingUpEvents = true;
void upEventsExhaustive;

// ============================================================================
// parent → iframe（下行，仅允许这些事件）
// ============================================================================

/**
 * 父页面容器尺寸变化，通知 iframe 内部重新布局。
 */
export interface ParentResizePayload {
    width: number;
    height: number;
}

/**
 * 父页面请求 iframe 关闭（用户在 Partner UI 上点击退出按钮）。
 * reason 供 iframe 侧埋点区分场景。
 */
export interface ParentCloseRequestPayload {
    reason: string;
}

/**
 * 页面可见性变化（基于 document.visibilityState）。
 * iframe 侧可据此暂停动画或降低帧率。
 */
export interface ParentVisibilityChangePayload {
    visible: boolean;
}

/** 父页面暂停 iframe（无 payload）。 */
export type ParentPausePayload = Record<string, never>;

/** 父页面恢复 iframe（无 payload）。 */
export type ParentResumePayload = Record<string, never>;

/**
 * 下行事件名 → payload 映射表，同时是 `send()` 的白名单：不在表里的事件名一律拒发。
 *
 * 注意：iframe 侧当前**没有消费任何下行事件**，发出去不会有效果；保留这组类型是为了
 * 协议已定的事件名不被随意占用。
 */
export interface DownEventMap {
    'parent.resize': ParentResizePayload;
    'parent.close_request': ParentCloseRequestPayload;
    'parent.visibility_change': ParentVisibilityChangePayload;
    'parent.pause': ParentPausePayload;
    'parent.resume': ParentResumePayload;
}

export type DownEventName = keyof DownEventMap;

/** DownEventMap 键的运行时清单，`send()` 按它做白名单校验。穷举约束同 UP_EVENT_NAMES。 */
export const DOWN_EVENT_NAMES = [
    'parent.resize',
    'parent.close_request',
    'parent.visibility_change',
    'parent.pause',
    'parent.resume',
] as const satisfies readonly DownEventName[];

type MissingDownEvents = Exclude<DownEventName, (typeof DOWN_EVENT_NAMES)[number]>;
const downEventsExhaustive: [MissingDownEvents] extends [never] ? true : MissingDownEvents = true;
void downEventsExhaustive;

/**
 * 下行事件白名单校验，`PartnerClient.send` 与 `PopupHandle.send` 共用。
 * 类型层已经约束了事件名，这里防的是 JS 调用方或 `as any` 绕过类型。
 */
export function assertSendableDownEvent(event: string): void {
    if (FORBIDDEN_DOWN_EVENTS.includes(event)) {
        throw new Error(
            `[@hashrace/partner-browser] forbidden event: ${event} — this event must not be sent from Partner page; route through Seamless Wallet / server-side channel instead.`,
        );
    }
    if (!(DOWN_EVENT_NAMES as readonly string[]).includes(event)) {
        throw new Error(
            `[@hashrace/partner-browser] unknown downstream event: ${event} — only ${DOWN_EVENT_NAMES.join(' / ')} may be sent.`,
        );
    }
}

// ============================================================================
// 禁止事件清单
// ============================================================================

/**
 * Partner 父页面绝对不允许向 iframe 发送的事件名。
 *
 * Seamless Wallet 架构下 Hashrace 永不持有玩家资金、永不信任父页面的资金或会话指令：
 *   - Financial：余额、押金、出款等资金动作必须走 Seamless Webhook S2S 通道，
 *               不允许通过浏览器端 postMessage 冒充
 *   - Session：登出、Token 刷新、强制下线等动作必须由 Hashrace 后端决定，
 *               父页面无权越过后端通知 iframe "你该登出了"
 *   - Game control：强制弃牌、离桌、坐下等游戏控制必须由 Hashrace 游戏引擎
 *                    基于规则触发，父页面无权强制玩家出牌
 *
 * 这些名字本来就不在 DownEventMap 白名单里，`send()` 无论如何都会拒发；单列出来是为了
 * 给出「这类指令只能走服务端」的明确报错，而不是笼统的「未知事件」。
 */
export const FORBIDDEN_DOWN_EVENTS: readonly string[] = [
    // 资金类
    'balance_refreshed',
    'deposit_done',
    'force_bet',
    'force_cashout',
    'set_balance',
    'withdraw_done',
    'bonus_granted',
    // 会话类
    'logout',
    'refresh_token',
    'switch_user',
    'force_reconnect',
    'revoke_session',
    // 游戏控制类
    'force_fold',
    'force_leave_table',
    'force_sit_out',
];

// ============================================================================
// 通用 Envelope
// ============================================================================

/**
 * postMessage 承载体统一结构。
 * E 为事件字面量字符串类型；P 为对应 payload 类型。
 */
export interface Envelope<E extends string, P> {
    channel: typeof CHANNEL;
    event: E;
    payload: P;
    nonce: string;
}
