import { createPartnerClient, PartnerClient } from './client';
import { DEFAULT_IFRAME_ALLOW } from './popup';

/**
 * embedHashraceIframe 参数。
 */
export interface EmbedOptions {
    /**
     * Hashrace 后端返回的一次性启动 URL，形如 https://app.hashrace.com/lobby?launch=lt_xxx。
     * 必须是 HTTPS。Partner 后端用自己的 API Key 调 Hashrace 的 /api/v1/partner/launch-session
     * 获取该 URL，然后把 URL 下发到前端（不要把 API Key 下发到前端）。
     */
    launchUrl: string;
    /** iframe 挂载的容器 DOM 元素。 */
    container: HTMLElement;
    /** iframe 宽度，默认 "100%"。 */
    width?: string;
    /** iframe 高度，默认 "100%"。 */
    height?: string;
    /**
     * 覆盖默认的 child origin 白名单。
     * 默认从 launchUrl 解析出 origin 作为白名单。特殊多环境场景可显式传入一个或多个 origin。
     */
    expectedChildOrigin?: string | readonly string[];
    /** 安全违规回调，透传给底层 PartnerClient。 */
    onSecurityViolation?: (reason: string, detail: unknown) => void;
    /** iframe 的 title 属性（a11y 要求），默认 "Hashrace Game"。读屏软件会把它读给玩家听。 */
    title?: string;
    /**
     * iframe `allow` 属性值。默认 DEFAULT_IFRAME_ALLOW（与 PG Soft / Pragmatic Play
     * 等 B2B 厂商基线对齐：web-share / clipboard-write / screen-wake-lock / fullscreen）。
     * 传空字符串 `''` 可显式 opt-out（不设 allow 属性）；传自定义字符串可完全覆盖。
     */
    iframeAllow?: string;
}

/**
 * embedHashraceIframe 返回值。
 */
export interface EmbedResult {
    /** 新创建的 iframe 元素（已挂入 container）。 */
    iframe: HTMLIFrameElement;
    /** 与 iframe 配对的 PartnerClient。Partner 应在卸载前调用 client.dispose()。 */
    client: PartnerClient;
}

/**
 * 一站式创建 Hashrace iframe 并返回配对 PartnerClient。
 *
 * 默认配置：
 *   - HTTPS only：launchUrl 必须是 https，否则抛错
 *   - referrerpolicy=strict-origin-when-cross-origin：保护 Partner 内部 URL 不泄漏
 *   - allow=DEFAULT_IFRAME_ALLOW（四项 B2B 基线权限）：避免游戏内 navigator.share /
 *     clipboard / fullscreen / wakeLock 在 iframe 内静默失败
 *   - 不设 sandbox：Seamless 架构下 iframe 需要正常发 HTTPS 请求和 postMessage；
 *     Partner 若需额外限制请在返回的 iframe 元素上自行设置
 */
export function embedHashraceIframe(opts: EmbedOptions): EmbedResult {
    const url = new URL(opts.launchUrl);
    if (url.protocol !== 'https:') {
        throw new Error('[@hashrace/partner-browser] launchUrl must be https');
    }
    const origin = opts.expectedChildOrigin ?? url.origin;

    const iframe = document.createElement('iframe');
    iframe.src = opts.launchUrl;
    iframe.width = opts.width ?? '100%';
    iframe.height = opts.height ?? '100%';
    iframe.style.border = '0';
    iframe.title = opts.title ?? 'Hashrace Game';
    const allow = opts.iframeAllow ?? DEFAULT_IFRAME_ALLOW;
    if (allow) {
        iframe.setAttribute('allow', allow);
    }
    iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    opts.container.appendChild(iframe);

    const client = createPartnerClient({
        iframe,
        expectedChildOrigin: origin,
        onSecurityViolation: opts.onSecurityViolation,
    });
    return { iframe, client };
}
