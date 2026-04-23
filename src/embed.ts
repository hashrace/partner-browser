import { createPartnerClient, PartnerClient } from './client';

/**
 * embedHashraceIframe 参数。
 */
export interface EmbedOptions {
    /**
     * HashMach 后端返回的一次性启动 URL，形如 https://app.hashrace.com/lobby?launch=lt_xxx。
     * 必须是 HTTPS。Partner 后端应用自己的 API Key 调 HashMach 的 /api/v1/partner/launch-session
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
    /** iframe 的 title 属性（a11y 要求），默认 "HashMach Game"。 */
    title?: string;
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
 * 一站式创建 HashMach iframe 并返回配对 PartnerClient。
 *
 * 默认配置：
 *   - HTTPS only：launchUrl 必须是 https，否则抛错
 *   - referrerpolicy=strict-origin-when-cross-origin：保护 Partner 内部 URL 不泄漏
 *   - allow=payment; fullscreen：允许 Payment Request API + 全屏
 *   - 不设 sandbox：Seamless 架构下 iframe 需要正常发 HTTPS 请求和 postMessage；
 *     Partner 若需额外限制请在返回的 iframe 元素上自行设置
 */
export function embedHashraceIframe(opts: EmbedOptions): EmbedResult {
    const url = new URL(opts.launchUrl);
    if (url.protocol !== 'https:') {
        throw new Error('[@hashrace/partner-sdk] launchUrl must be https');
    }
    const origin = opts.expectedChildOrigin ?? url.origin;

    const iframe = document.createElement('iframe');
    iframe.src = opts.launchUrl;
    iframe.width = opts.width ?? '100%';
    iframe.height = opts.height ?? '100%';
    iframe.style.border = '0';
    iframe.title = opts.title ?? 'HashMach Game';
    // Payment Request API 部分 Partner 场景需要；fullscreen 支持全屏游戏
    iframe.setAttribute('allow', 'payment; fullscreen');
    iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    opts.container.appendChild(iframe);

    const client = createPartnerClient({
        iframe,
        expectedChildOrigin: origin,
        onSecurityViolation: opts.onSecurityViolation,
    });
    return { iframe, client };
}
