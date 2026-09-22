/**
 * 游戏客户端（hashmach-client 仓）实际发送的上行事件清单：事件名 → payload 顶层字段。
 *
 * 对应客户端的发送点（全部经 PostMessageChannel.post 走 hashrace.v1 信封）：
 *   - assets/scripts/core/App.ts               iframe.ready / iframe.retry_request / iframe.support_request
 *   - assets/scripts/core/auth/LogoutService.ts iframe.exit_request
 *   - assets/scripts/game/GameManager.ts        iframe.game_ended
 *
 * 客户端新增 / 删除 / 改名一个上行事件，或改了 payload 字段，必须同步改这里——
 * contract.test.ts 会拿它与 SDK 的 UpEventMap 双向对账；兄弟目录有客户端仓时，
 * 还会直接扫客户端源码核对这份清单本身没有过期。
 */
export const CLIENT_UP_EVENTS: Readonly<Record<string, readonly string[]>> = {
    'iframe.ready': ['client_version', 'protocol_version'],
    'iframe.exit_request': ['reason'],
    'iframe.retry_request': [],
    'iframe.support_request': [],
    'iframe.game_ended': ['game_id'],
};

/**
 * SDK 已定义、协议已定，但客户端当前没有任何发送点的上行事件。
 * 列在这里是如实记账（README 里同样标注「当前未接」），不是豁免：
 * 客户端接上其中一个后，它必须从这里挪进 CLIENT_UP_EVENTS，否则对账红。
 */
export const SDK_ONLY_NOT_YET_SENT: readonly string[] = [
    'iframe.size_change',
    'iframe.round_start',
    'iframe.round_end',
    'iframe.error',
];
