import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { DEFAULT_IFRAME_ALLOW, launchInPopup } from '../popup';

/**
 * jsdom 对 window.open + document.write + 跨 window postMessage 实现不完整，
 * 这里通过 stub window.open 返回受控的 fake popup 对象做单测——验证
 * launchInPopup 在父页一侧的逻辑（URL 校验、popup blocker 处理、
 * 监听器 + 轮询装配、handle API、FORBIDDEN_DOWN_EVENTS 拦截、关闭轮询等）。
 *
 * wrapper script 内部的 relay 转发逻辑不在 jsdom 单测覆盖范围，留给真机
 * Chrome 联调（PLAN-134a Task 11）。
 */

interface FakeDocument {
    open: Mock;
    write: Mock;
    close: Mock;
}

interface FakePopup {
    closed: boolean;
    postMessage: Mock;
    close: Mock;
    focus: Mock;
    document: FakeDocument;
}

function makeFakePopup(): FakePopup {
    const popup: FakePopup = {
        closed: false,
        postMessage: vi.fn(),
        close: vi.fn(),
        focus: vi.fn(),
        document: {
            open: vi.fn(),
            write: vi.fn(),
            close: vi.fn(),
        },
    };
    // close() 副作用：把 closed 翻成 true
    popup.close.mockImplementation(() => {
        popup.closed = true;
    });
    return popup;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let openSpy: any;
let lastPopup: FakePopup | null;

beforeEach(() => {
    lastPopup = null;
    openSpy = vi.spyOn(window, 'open').mockImplementation(() => {
        lastPopup = makeFakePopup();
        return lastPopup as unknown as Window;
    });
    vi.useFakeTimers();
});

afterEach(() => {
    openSpy.mockRestore();
    vi.useRealTimers();
});

describe('launchInPopup', () => {
    it('throws on non-https / non-localhost launchUrl', () => {
        expect(() => launchInPopup({
            launchUrl: 'http://app.hashrace.com/?launch=x',
        })).toThrow(/https/i);
    });

    it('accepts http://localhost for dev', () => {
        const handle = launchInPopup({
            launchUrl: 'http://localhost:7456/?launch=abc',
        });
        expect(handle).not.toBeNull();
        expect(openSpy).toHaveBeenCalledTimes(1);
    });

    it('accepts valid https launchUrl', () => {
        const handle = launchInPopup({
            launchUrl: 'https://app.hashrace.com/?launch=abc',
        });
        expect(handle).not.toBeNull();
        expect(openSpy).toHaveBeenCalledTimes(1);
    });

    it('triggers onPopupBlocked + returns null when window.open returns null', () => {
        openSpy.mockReturnValueOnce(null);
        const onBlocked = vi.fn();
        const handle = launchInPopup({
            launchUrl: 'https://app.hashrace.com/?launch=x',
            onPopupBlocked: onBlocked,
        });
        expect(handle).toBeNull();
        expect(onBlocked).toHaveBeenCalledTimes(1);
    });

    it('writes wrapper HTML containing iframe with launch URL and default allow attribute', () => {
        launchInPopup({ launchUrl: 'https://app.hashrace.com/?launch=tok' });
        const popup = lastPopup!;
        expect(popup.document.write).toHaveBeenCalledOnce();
        const html = popup.document.write.mock.calls[0]![0] as string;
        expect(html).toContain('<iframe');
        expect(html).toContain('https://app.hashrace.com/?launch=tok');
        expect(html).toContain('web-share *');
        expect(html).toContain('clipboard-write *');
        expect(html).toContain('screen-wake-lock *');
        expect(html).toContain('fullscreen *');
    });

    it('iframeAllow custom value appears in wrapper HTML', () => {
        launchInPopup({
            launchUrl: 'https://app.hashrace.com/?launch=t',
            iframeAllow: 'camera *',
        });
        const html = lastPopup!.document.write.mock.calls[0]![0] as string;
        expect(html).toContain('camera *');
        expect(html).not.toContain(DEFAULT_IFRAME_ALLOW);
    });

    it('iframeAllow === "" omits allow attribute on iframe element', () => {
        launchInPopup({
            launchUrl: 'https://app.hashrace.com/?launch=t',
            iframeAllow: '',
        });
        const html = lastPopup!.document.write.mock.calls[0]![0] as string;
        expect(html).not.toContain(' allow=');
    });

    it('exposes PopupHandle API surface (on / off / send / close / focus / onClosed / dispose / closed)', () => {
        const handle = launchInPopup({ launchUrl: 'https://app.hashrace.com/?launch=x' })!;
        expect(typeof handle.on).toBe('function');
        expect(typeof handle.off).toBe('function');
        expect(typeof handle.send).toBe('function');
        expect(typeof handle.close).toBe('function');
        expect(typeof handle.focus).toBe('function');
        expect(typeof handle.onClosed).toBe('function');
        expect(typeof handle.dispose).toBe('function');
        expect(handle.closed).toBe(false);
    });

    it('forbids sending FORBIDDEN_DOWN_EVENTS via send()', () => {
        const handle = launchInPopup({ launchUrl: 'https://app.hashrace.com/?launch=x' })!;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const send = handle.send as unknown as (e: string, p: any) => void;
        expect(() => send('logout', {})).toThrow(/forbidden/);
        expect(() => send('set_balance', {})).toThrow(/forbidden/);
    });

    it('allows sending whitelisted downstream events via popup.postMessage', () => {
        const handle = launchInPopup({ launchUrl: 'https://app.hashrace.com/?launch=x' })!;
        handle.send('parent.resize', { width: 800, height: 600 });
        const popup = lastPopup!;
        expect(popup.postMessage).toHaveBeenCalledOnce();
        const call = popup.postMessage.mock.calls[0]!;
        const msg = call[0] as { channel: string; event: string; payload: unknown };
        expect(msg.channel).toBe('hashrace.v1-relay-down');
        expect(msg.event).toBe('parent.resize');
        expect(msg.payload).toEqual({ width: 800, height: 600 });
        expect(call[1]).toBe(window.location.origin);
    });

    it('triggers onClosed when popup.closed flips true (via close polling)', () => {
        const onClosed = vi.fn();
        const handle = launchInPopup({ launchUrl: 'https://app.hashrace.com/?launch=x' })!;
        handle.onClosed(onClosed);
        expect(onClosed).not.toHaveBeenCalled();
        lastPopup!.closed = true;
        vi.advanceTimersByTime(300);
        expect(onClosed).toHaveBeenCalledTimes(1);
        expect(handle.closed).toBe(true);
    });

    it('calls onSecurityViolation on relay message from wrong origin', () => {
        const onViolation = vi.fn();
        const handle = launchInPopup({
            launchUrl: 'https://app.hashrace.com/?launch=x',
            onSecurityViolation: onViolation,
        })!;
        const upHandler = vi.fn();
        handle.on('iframe.ready', upHandler);
        window.dispatchEvent(new MessageEvent('message', {
            data: { channel: 'hashrace.v1-relay', event: 'iframe.ready', payload: {}, nonce: 'n' },
            origin: 'https://evil.example.com',
            source: lastPopup as unknown as MessageEventSource,
        }));
        expect(onViolation).toHaveBeenCalledWith('relay_origin_mismatch', expect.any(Object));
        expect(upHandler).not.toHaveBeenCalled();
    });

    it('routes valid relay message to registered handler', () => {
        const handle = launchInPopup({ launchUrl: 'https://app.hashrace.com/?launch=x' })!;
        const upHandler = vi.fn();
        handle.on('iframe.ready', upHandler);
        window.dispatchEvent(new MessageEvent('message', {
            data: {
                channel: 'hashrace.v1-relay',
                event: 'iframe.ready',
                payload: { client_version: '1.0.0', protocol_version: 'hashrace.v1' },
                nonce: 'n1',
            },
            origin: window.location.origin,
            source: lastPopup as unknown as MessageEventSource,
        }));
        expect(upHandler).toHaveBeenCalledTimes(1);
        expect(upHandler.mock.calls[0]![0]).toEqual({
            client_version: '1.0.0',
            protocol_version: 'hashrace.v1',
        });
    });

    it('ack handler for iframe.exit_request posts hashrace.v1-relay-ack to popup', () => {
        const handle = launchInPopup({ launchUrl: 'https://app.hashrace.com/?launch=x' })!;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const exitHandler = vi.fn((_p: any, ack?: (a: { accepted: boolean }) => void) => {
            ack?.({ accepted: true });
        });
        handle.on('iframe.exit_request', exitHandler);
        window.dispatchEvent(new MessageEvent('message', {
            data: {
                channel: 'hashrace.v1-relay',
                event: 'iframe.exit_request',
                payload: { reason: 'user_back' },
                nonce: 'nx',
            },
            origin: window.location.origin,
            source: lastPopup as unknown as MessageEventSource,
        }));
        expect(exitHandler).toHaveBeenCalledTimes(1);
        const ackCall = lastPopup!.postMessage.mock.calls.find(
            (c) => (c[0] as { channel?: string }).channel === 'hashrace.v1-relay-ack',
        );
        expect(ackCall).toBeDefined();
        expect((ackCall![0] as { payload: unknown }).payload).toEqual({ accepted: true });
        expect((ackCall![0] as { nonce: string }).nonce).toBe('nx');
    });

    it('off() removes the handler', () => {
        const handle = launchInPopup({ launchUrl: 'https://app.hashrace.com/?launch=x' })!;
        const upHandler = vi.fn();
        handle.on('iframe.ready', upHandler);
        handle.off('iframe.ready');
        window.dispatchEvent(new MessageEvent('message', {
            data: {
                channel: 'hashrace.v1-relay',
                event: 'iframe.ready',
                payload: { client_version: '1.0.0', protocol_version: 'hashrace.v1' },
                nonce: 'n',
            },
            origin: window.location.origin,
            source: lastPopup as unknown as MessageEventSource,
        }));
        expect(upHandler).not.toHaveBeenCalled();
    });

    it('dispose() removes message listener and stops polling', () => {
        const handle = launchInPopup({ launchUrl: 'https://app.hashrace.com/?launch=x' })!;
        const upHandler = vi.fn();
        handle.on('iframe.ready', upHandler);
        handle.dispose();
        window.dispatchEvent(new MessageEvent('message', {
            data: {
                channel: 'hashrace.v1-relay',
                event: 'iframe.ready',
                payload: { client_version: '1.0.0', protocol_version: 'hashrace.v1' },
                nonce: 'n',
            },
            origin: window.location.origin,
            source: lastPopup as unknown as MessageEventSource,
        }));
        expect(upHandler).not.toHaveBeenCalled();
    });

    it('close() invokes popup.close()', () => {
        const handle = launchInPopup({ launchUrl: 'https://app.hashrace.com/?launch=x' })!;
        handle.close();
        expect(lastPopup!.close).toHaveBeenCalledTimes(1);
    });

    it('focus() invokes popup.focus()', () => {
        const handle = launchInPopup({ launchUrl: 'https://app.hashrace.com/?launch=x' })!;
        handle.focus();
        expect(lastPopup!.focus).toHaveBeenCalledTimes(1);
    });

    it('passes window.width/height to window.open features string', () => {
        launchInPopup({
            launchUrl: 'https://app.hashrace.com/?launch=x',
            window: { width: 1600, height: 900 },
        });
        const features = openSpy.mock.calls[0][2] as string;
        expect(features).toContain('width=1600');
        expect(features).toContain('height=900');
        expect(features).toContain('popup=yes');
    });

    it('passes name to window.open second arg', () => {
        launchInPopup({
            launchUrl: 'https://app.hashrace.com/?launch=x',
            name: 'hashmach-game',
        });
        expect(openSpy.mock.calls[0][1]).toBe('hashmach-game');
    });

    it('DEFAULT_IFRAME_ALLOW exposes four B2B baseline permissions', () => {
        expect(DEFAULT_IFRAME_ALLOW).toBe(
            'web-share *; clipboard-write *; screen-wake-lock *; fullscreen *',
        );
    });
});
