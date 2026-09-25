import { useState, useRef } from 'react';
import { launchInPopup, type PopupHandle } from '@hashrace/partner-browser';

/**
 * React 版 Hashrace popup 启动器。
 *
 * 关键约束：launchInPopup 必须在 user gesture 同步路径（onClick 内）调用，
 * 否则浏览器会拦截 popup。useEffect 内调用会被 popup blocker 抓住。
 */
export function PopupApp({ launchUrl }: { launchUrl: string }) {
    const [status, setStatus] = useState<string>('未启动');
    const [active, setActive] = useState<boolean>(false);
    const handleRef = useRef<PopupHandle | null>(null);

    const onClick = (): void => {
        const handle = launchInPopup({
            launchUrl,
            window: { width: 1280, height: 720 },
            onPopupBlocked: () => setStatus('弹窗被浏览器拦截，请允许后重试'),
            onSecurityViolation: (reason, detail) => console.warn('[SDK]', reason, detail),
        });
        if (!handle) return;

        handleRef.current = handle;
        setActive(true);
        setStatus('游戏窗口已启动');

        handle.on('iframe.round_end', ({ net_change_micro, currency, round_id }) => {
            console.log(`round ${round_id} net=${net_change_micro} micro ${currency}`);
            // 此处可触发 Partner 自家钱包余额刷新 UI
        });
        handle.on('iframe.exit_request', (_, ack) => ack({ accepted: true }));
        handle.onClosed(() => {
            setActive(false);
            setStatus('游戏窗口已关闭');
            handleRef.current = null;
        });
    };

    return (
        <div style={{ font: '14px system-ui', padding: 24, maxWidth: 600 }}>
            <h1>Hashrace 游戏（popup 模式）</h1>
            <button onClick={onClick} disabled={active} style={{ padding: '10px 20px', fontSize: 16 }}>
                {active ? '游戏运行中…' : '运行游戏'}
            </button>
            <div style={{ marginTop: 16, padding: 12, background: '#f5f5f5', borderRadius: 4 }}>
                {status}
            </div>
        </div>
    );
}
