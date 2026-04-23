/**
 * hashrace.v1 postMessage 协议——事件 Schema 与禁止事件清单。
 *
 * 本文件定义 Partner 父页面与 HashMach iframe 之间双向消息的结构化类型。
 * 所有消息都用 Envelope 包裹：`{ channel, event, payload, nonce }`。
 *
 * 约定：
 *   - channel：固定字面量 "hashrace.v1"，跨版本用 "hashrace.v2" 表示破坏性变更
 *   - event：分两个命名空间
 *       · "iframe.*"  — iframe → parent（上行）
 *       · "parent.*"  — parent → iframe（下行）
 *   - payload：每事件有专属 interface，不允许透传任意 JSON
 *   - nonce：UUID v4 字符串；ack 消息携带原始 nonce 以关联请求
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
 * iframe 请求退出（用户按返回键、会话过期、严重错误）。
 * Partner 必须在 5 秒内回 ack，否则 iframe 会兜底跳转到自家错误页。
 */
export interface IframeExitRequestPayload {
    reason: 'user_back' | 'session_expired' | 'error';
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
 * 净变动已经由 HashMach 通过 Seamless Webhook 写入 Partner 钱包；
 * Partner 收到此事件只需刷新余额 UI，不要自己做二次记账。
 */
export interface IframeRoundEndPayload {
    round_id: string;
    game_code: string;
    net_change_minor: number;
    currency: string;
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
 * 上行事件名 → payload 映射表。
 */
export interface UpEventMap {
    'iframe.ready': IframeReadyPayload;
    'iframe.size_change': IframeSizeChangePayload;
    'iframe.exit_request': IframeExitRequestPayload;
    'iframe.round_start': IframeRoundStartPayload;
    'iframe.round_end': IframeRoundEndPayload;
    'iframe.error': IframeErrorPayload;
}

export type UpEventName = keyof UpEventMap;

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
 * 下行事件名 → payload 映射表。
 */
export interface DownEventMap {
    'parent.resize': ParentResizePayload;
    'parent.close_request': ParentCloseRequestPayload;
    'parent.visibility_change': ParentVisibilityChangePayload;
    'parent.pause': ParentPausePayload;
    'parent.resume': ParentResumePayload;
}

export type DownEventName = keyof DownEventMap;

// ============================================================================
// 禁止事件清单
// ============================================================================

/**
 * Partner 父页面绝对不允许向 iframe 发送的事件名。
 *
 * Seamless Wallet 架构下 HashMach 永不持有玩家资金、永不信任父页面的资金或会话指令：
 *   - Financial：余额、押金、出款等资金动作必须走 Seamless Webhook S2S 通道，
 *               不允许通过浏览器端 postMessage 冒充
 *   - Session：登出、Token 刷新、强制下线等动作必须由 HashMach 后端决定，
 *               父页面无权越过后端通知 iframe "你该登出了"
 *   - Game control：强制弃牌、离桌、坐下等游戏控制必须由 HashMach Game 引擎
 *                    基于规则触发，父页面无权强制玩家出牌
 *
 * SDK `send()` 在运行时检测此清单并抛错，避免 Partner 侧误用。
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
