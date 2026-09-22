import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { JSDOM, VirtualConsole } from 'jsdom';
import { DEFAULT_IFRAME_ALLOW, launchInPopup } from '../popup';

/**
 * window.open 被 stub 成受控的 fake popup：窗口层（closed / postMessage / close / focus）是 mock，
 * 但 `document` 是一份开了 runScripts 的真实 jsdom 文档——wrapper 的 DOM 装配与 relay 脚本
 * 会被真正解析、执行，回归用例据此检查实际生成的 DOM，而不是对 HTML 字符串做 toContain。
 *
 * relay 脚本跨窗口转发（iframe ↔ opener）依赖真实的多窗口 postMessage，jsdom 覆盖不了，
 * 留给真机浏览器联调。
 */

interface FakePopup {
    closed: boolean;
    postMessage: Mock;
    close: Mock;
    focus: Mock;
    document: Document;
    dom: JSDOM;
    /** wrapper 文档内脚本执行抛出的错误（语法错 / 运行时错都会落到这里） */
    scriptErrors: unknown[];
}

function makeFakePopup(): FakePopup {
    const scriptErrors: unknown[] = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', (err) => scriptErrors.push(err));
    const dom = new JSDOM('', { runScripts: 'dangerously', url: 'about:blank', virtualConsole });
    const popup: FakePopup = {
        closed: false,
        postMessage: vi.fn(),
        close: vi.fn(),
        focus: vi.fn(),
        document: dom.window.document,
        dom,
        scriptErrors,
    };
    // close() 副作用：把 closed 翻成 true
    popup.close.mockImplementation(() => {
        popup.closed = true;
    });
    return popup;
}

function wrapperIframe(popup: FakePopup): HTMLIFrameElement {
    const frames = popup.document.querySelectorAll('iframe');
    expect(frames).toHaveLength(1);
    return frames[0] as HTMLIFrameElement;
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
    lastPopup?.dom.window.close();
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

    it('mounts exactly one iframe with launch URL and default allow attribute', () => {
        launchInPopup({ launchUrl: 'https://app.hashrace.com/?launch=tok' });
        const iframe = wrapperIframe(lastPopup!);
        expect(iframe.getAttribute('src')).toBe('https://app.hashrace.com/?launch=tok');
        expect(iframe.getAttribute('allow')).toBe(DEFAULT_IFRAME_ALLOW);
        expect(lastPopup!.document.title).toBe('Hashrace');
    });

    it('iframeAllow custom value is set verbatim on the iframe', () => {
        launchInPopup({
            launchUrl: 'https://app.hashrace.com/?launch=t',
            iframeAllow: 'camera *',
        });
        expect(wrapperIframe(lastPopup!).getAttribute('allow')).toBe('camera *');
    });

    it('iframeAllow === "" omits allow attribute on iframe element', () => {
        launchInPopup({
            launchUrl: 'https://app.hashrace.com/?launch=t',
            iframeAllow: '',
        });
        expect(wrapperIframe(lastPopup!).hasAttribute('allow')).toBe(false);
    });

    // 守的回归：launchUrl / iframeAllow 曾被 JSON.stringify 后拼进 HTML 属性，
    // 带 `"` 的值逃出属性注入 onload，脚本在继承 opener origin 的 popup 里执行（Partner 域 XSS）。
    // 这里真正执行 wrapper 生成的文档，检查的是 DOM 结果而不是字符串。
    function expectNoInjection(popup: FakePopup): HTMLIFrameElement {
        const doc = popup.document;
        const iframe = wrapperIframe(popup);
        expect(iframe.onload).toBeNull();
        // 整份文档里不允许出现任何事件处理器属性
        for (const el of Array.from(doc.querySelectorAll('*'))) {
            expect(el.getAttributeNames().filter((n) => n.startsWith('on'))).toEqual([]);
        }
        iframe.dispatchEvent(new popup.dom.window.Event('load'));
        expect(doc.body.dataset.pwned).toBeUndefined();
        // relay 脚本仍然装上且执行无错（没有被骨架 / 注入破坏）
        expect(doc.querySelectorAll('script')).toHaveLength(1);
        expect(popup.scriptErrors).toEqual([]);
        return iframe;
    }

    it('launchUrl cannot break out of the iframe src attribute (XSS regression)', () => {
        const evilUrl =
            'https://127.0.0.1:9/game?launch=x"/onload=document.body.dataset.pwned=document.domain//';
        expect(launchInPopup({ launchUrl: evilUrl })).not.toBeNull();
        const iframe = expectNoInjection(lastPopup!);
        expect(iframe.getAttributeNames().sort()).toEqual(['allow', 'src', 'style']);
        expect(iframe.getAttribute('src')).toBe(new URL(evilUrl).href);
        expect(iframe.getAttribute('allow')).toBe(DEFAULT_IFRAME_ALLOW);
    });

    it('iframeAllow cannot break out of the iframe allow attribute (XSS regression)', () => {
        const evilAllow = 'fullscreen *" onload="document.body.dataset.pwned=1" x="';
        expect(launchInPopup({
            launchUrl: 'https://app.hashrace.com/?launch=x',
            iframeAllow: evilAllow,
        })).not.toBeNull();
        const iframe = expectNoInjection(lastPopup!);
        expect(iframe.getAttributeNames().sort()).toEqual(['allow', 'src', 'style']);
        expect(iframe.getAttribute('allow')).toBe(evilAllow);
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

    it('rejects downstream events outside DownEventMap', () => {
        const handle = launchInPopup({ launchUrl: 'https://app.hashrace.com/?launch=x' })!;
        const send = handle.send as unknown as (e: string, p: unknown) => void;
        expect(() => send('parent.balance_refreshed', {})).toThrow(/unknown downstream event/);
        expect(lastPopup!.postMessage).not.toHaveBeenCalled();
    });

    it('relay script executes without errors for a normal launch', () => {
        launchInPopup({ launchUrl: 'https://app.hashrace.com/?launch=x' });
        expect(lastPopup!.scriptErrors).toEqual([]);
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
            name: 'hashrace-game',
        });
        expect(openSpy.mock.calls[0][1]).toBe('hashrace-game');
    });

    it('DEFAULT_IFRAME_ALLOW exposes four B2B baseline permissions', () => {
        expect(DEFAULT_IFRAME_ALLOW).toBe(
            'web-share *; clipboard-write *; screen-wake-lock *; fullscreen *',
        );
    });
});
