import { useEffect, useRef } from 'react';
// 0.2.0 起 embedHashraceIframe 自动注入四项 allow 权限：
//   web-share / clipboard-write / screen-wake-lock / fullscreen
// （对齐 PG Soft / Pragmatic Play B2B 基线，详见 CHANGELOG）。
// 不想要这层默认值时传 iframeAllow: '' 或自定义字符串。
import { embedHashraceIframe, type PartnerClient } from '@hashrace/partner-browser';

/**
 * React 版 HashMach iframe 容器。
 * launchUrl 由 Partner 后端调用 HashMach /api/v1/partner/launch-session 获取后下发到前端。
 */
export function App({ launchUrl }: { launchUrl: string }) {
    const containerRef = useRef<HTMLDivElement>(null);
    const clientRef = useRef<PartnerClient | null>(null);

    useEffect(() => {
        if (!containerRef.current) return;
        const { client } = embedHashraceIframe({
            launchUrl,
            container: containerRef.current,
            onSecurityViolation: (reason, detail) => {
                console.warn('[SDK]', reason, detail);
            },
        });

        client.on('iframe.round_end', ({ net_change_minor, currency, round_id }) => {
            console.log(`round ${round_id} ended, net: ${net_change_minor} ${currency}`);
            // 此处可触发 Partner 自家钱包余额刷新 UI
        });

        client.on('iframe.exit_request', (_, ack) => {
            ack({ accepted: true });
            // 然后跳转 Partner 大厅或关闭弹窗
        });

        clientRef.current = client;
        return () => {
            client.dispose();
            clientRef.current = null;
        };
    }, [launchUrl]);

    return <div ref={containerRef} style={{ width: '100%', height: '600px' }} />;
}
