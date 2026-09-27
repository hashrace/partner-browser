/**
 * 严格 origin 匹配，仅支持精确字符串比对。
 *
 * Partner 父页面必须校验 `window.addEventListener('message')` 事件的 `origin` 字段，
 * 否则任何网站都能向 iframe 宿主发消息冒充 Hashrace。本函数封装正确做法，
 * 拒绝 null/undefined、拒绝字面 "null"（浏览器对 data: / file: 等不透明来源返回此值）。
 *
 * 不支持通配符——父页面一侧的 allowlist 通常就一两个确定 origin（prod / staging）。
 * iframe 侧（游戏客户端）不做任何白名单或通配符匹配：它把嵌入方 origin 取为
 * `location.ancestorOrigins[0]`（取不到再用 `document.referrer` 的 origin），出站只发给它、
 * 进站只收它的，都取不到就不发。与本函数无关。
 */
export function isExpectedOrigin(
    actual: string | undefined,
    expected: string | readonly string[],
): boolean {
    if (!actual || actual === 'null') return false;
    const list = Array.isArray(expected) ? expected : [expected];
    return list.includes(actual);
}
