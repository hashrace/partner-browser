/**
 * 生成下行消息的 nonce。
 *
 * crypto.randomUUID 只在安全上下文（HTTPS / localhost）里存在：Partner 在 http 测试环境
 * 或旧 WebView 里嵌入时它是 undefined，直接调用会让 send() 抛 TypeError、那条下行消息
 * 发不出去。nonce 只用于配对与去重，不承担安全语义，退化成随机串即可。
 */
export function makeNonce(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return 'r' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
