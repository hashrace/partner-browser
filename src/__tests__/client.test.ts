import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPartnerClient } from '../client';

function makeIframe(): HTMLIFrameElement {
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    return iframe;
}

describe('createPartnerClient', () => {
    beforeEach(() => { document.body.innerHTML = ''; });

    it('dispatches on(iframe.ready) for matching origin + source', () => {
        const iframe = makeIframe();
        const client = createPartnerClient({ iframe, expectedChildOrigin: 'https://app.hashrace.com' });
        const handler = vi.fn();
        client.on('iframe.ready', handler);

        window.dispatchEvent(new MessageEvent('message', {
            data: {
                channel: 'hashrace.v1',
                event: 'iframe.ready',
                payload: { client_version: '1.0.0', protocol_version: 'hashrace.v1' },
                nonce: 'n1',
            },
            origin: 'https://app.hashrace.com',
            source: iframe.contentWindow,
        }));

        expect(handler).toHaveBeenCalledOnce();
        expect(handler.mock.calls[0][0]).toMatchObject({ client_version: '1.0.0' });
    });

    it('ignores messages from wrong origin', () => {
        const iframe = makeIframe();
        const violations: unknown[] = [];
        const client = createPartnerClient({
            iframe,
            expectedChildOrigin: 'https://app.hashrace.com',
            onSecurityViolation: (reason, detail) => violations.push({ reason, detail }),
        });
        const handler = vi.fn();
        client.on('iframe.ready', handler);

        window.dispatchEvent(new MessageEvent('message', {
            data: { channel: 'hashrace.v1', event: 'iframe.ready', payload: {}, nonce: 'n1' },
            origin: 'https://evil.com',
            source: iframe.contentWindow,
        }));
        expect(handler).not.toHaveBeenCalled();
        expect(violations.length).toBe(1);
    });

    it('ignores messages from wrong channel', () => {
        const iframe = makeIframe();
        const client = createPartnerClient({ iframe, expectedChildOrigin: 'https://app.hashrace.com' });
        const handler = vi.fn();
        client.on('iframe.round_end', handler);

        window.dispatchEvent(new MessageEvent('message', {
            data: { channel: 'other.v1', event: 'iframe.round_end', payload: {}, nonce: 'n' },
            origin: 'https://app.hashrace.com',
            source: iframe.contentWindow,
        }));
        expect(handler).not.toHaveBeenCalled();
    });

    it('ignores messages from different source window', () => {
        const iframe = makeIframe();
        const other = makeIframe();
        const client = createPartnerClient({ iframe, expectedChildOrigin: 'https://app.hashrace.com' });
        const handler = vi.fn();
        client.on('iframe.ready', handler);

        window.dispatchEvent(new MessageEvent('message', {
            data: { channel: 'hashrace.v1', event: 'iframe.ready', payload: {}, nonce: 'n' },
            origin: 'https://app.hashrace.com',
            source: other.contentWindow,
        }));
        expect(handler).not.toHaveBeenCalled();
    });

    it('ignores messages with no data', () => {
        const iframe = makeIframe();
        const client = createPartnerClient({ iframe, expectedChildOrigin: 'https://app.hashrace.com' });
        const handler = vi.fn();
        client.on('iframe.ready', handler);

        window.dispatchEvent(new MessageEvent('message', {
            data: undefined,
            origin: 'https://app.hashrace.com',
            source: iframe.contentWindow,
        }));
        expect(handler).not.toHaveBeenCalled();
    });

    it('send throws on forbidden event', () => {
        const iframe = makeIframe();
        const client = createPartnerClient({ iframe, expectedChildOrigin: 'https://app.hashrace.com' });
        expect(() => (client as unknown as { send: (e: string, p: unknown) => void }).send('deposit_done', { amount: 1000 }))
            .toThrow(/forbidden event/i);
    });

    // 守的回归：send() 曾只查 FORBIDDEN_DOWN_EVENTS（不带命名空间），任何 `parent.*` 自造事件都能发出去。
    it('send throws on events outside DownEventMap and posts nothing', () => {
        const iframe = makeIframe();
        const post = vi.fn();
        Object.defineProperty(iframe, 'contentWindow', { value: { postMessage: post }, writable: true });
        const client = createPartnerClient({ iframe, expectedChildOrigin: 'https://app.hashrace.com' });
        const send = (client as unknown as { send: (e: string, p: unknown) => void }).send;
        expect(() => send('parent.set_balance', { amount: 1 })).toThrow(/unknown downstream event: parent\.set_balance/);
        expect(() => send('iframe.ready', {})).toThrow(/unknown downstream event/);
        expect(post).not.toHaveBeenCalled();
    });

    it('send posts envelope with correct structure', () => {
        const iframe = makeIframe();
        const post = vi.fn();
        Object.defineProperty(iframe, 'contentWindow', { value: { postMessage: post }, writable: true });
        const client = createPartnerClient({ iframe, expectedChildOrigin: 'https://app.hashrace.com' });

        client.send('parent.resize', { width: 800, height: 600 });
        expect(post).toHaveBeenCalledOnce();
        const [envelope, target] = post.mock.calls[0];
        expect(envelope).toMatchObject({
            channel: 'hashrace.v1',
            event: 'parent.resize',
            payload: { width: 800, height: 600 },
        });
        expect(envelope.nonce).toMatch(/[0-9a-f-]{36}/);
        expect(target).toBe('https://app.hashrace.com');
    });

    it('send picks first origin from array as target', () => {
        const iframe = makeIframe();
        const post = vi.fn();
        Object.defineProperty(iframe, 'contentWindow', { value: { postMessage: post }, writable: true });
        const client = createPartnerClient({
            iframe,
            expectedChildOrigin: ['https://app.hashrace.com', 'https://app-staging.hashrace.com'],
        });

        client.send('parent.pause', {});
        const [, target] = post.mock.calls[0];
        expect(target).toBe('https://app.hashrace.com');
    });

    it('ack on iframe.exit_request carries original nonce', () => {
        const iframe = makeIframe();
        const postCalls: unknown[] = [];
        Object.defineProperty(iframe, 'contentWindow', {
            value: { postMessage: (m: unknown) => postCalls.push(m) },
            writable: true,
        });
        const client = createPartnerClient({ iframe, expectedChildOrigin: 'https://app.hashrace.com' });

        client.on('iframe.exit_request', (_payload, ack) => {
            ack!({ accepted: true });
        });

        window.dispatchEvent(new MessageEvent('message', {
            data: {
                channel: 'hashrace.v1',
                event: 'iframe.exit_request',
                payload: { reason: 'user_back' },
                nonce: 'N1',
            },
            origin: 'https://app.hashrace.com',
            source: iframe.contentWindow,
        }));

        expect(postCalls.length).toBe(1);
        expect(postCalls[0]).toMatchObject({
            channel: 'hashrace.v1',
            event: 'iframe.exit_request.ack',
            nonce: 'N1',
            payload: { accepted: true },
        });
    });

    it('handler thrown error is reported via onSecurityViolation', () => {
        const iframe = makeIframe();
        const violations: unknown[] = [];
        const client = createPartnerClient({
            iframe,
            expectedChildOrigin: 'https://app.hashrace.com',
            onSecurityViolation: (reason, detail) => violations.push({ reason, detail }),
        });

        client.on('iframe.ready', () => { throw new Error('boom'); });

        window.dispatchEvent(new MessageEvent('message', {
            data: { channel: 'hashrace.v1', event: 'iframe.ready', payload: {}, nonce: 'n' },
            origin: 'https://app.hashrace.com',
            source: iframe.contentWindow,
        }));
        expect(violations.length).toBe(1);
        expect((violations[0] as { reason: string }).reason).toBe('handler_error');
    });

    it('off removes individual listener', () => {
        const iframe = makeIframe();
        const client = createPartnerClient({ iframe, expectedChildOrigin: 'https://app.hashrace.com' });
        const handler = vi.fn();
        client.on('iframe.ready', handler);
        client.off('iframe.ready');

        window.dispatchEvent(new MessageEvent('message', {
            data: { channel: 'hashrace.v1', event: 'iframe.ready', payload: {}, nonce: 'n' },
            origin: 'https://app.hashrace.com',
            source: iframe.contentWindow,
        }));
        expect(handler).not.toHaveBeenCalled();
    });

    it('dispose removes all listeners', () => {
        const iframe = makeIframe();
        const client = createPartnerClient({ iframe, expectedChildOrigin: 'https://app.hashrace.com' });
        const handler = vi.fn();
        client.on('iframe.ready', handler);
        client.dispose();

        window.dispatchEvent(new MessageEvent('message', {
            data: { channel: 'hashrace.v1', event: 'iframe.ready', payload: {}, nonce: 'n' },
            origin: 'https://app.hashrace.com',
            source: iframe.contentWindow,
        }));
        expect(handler).not.toHaveBeenCalled();
    });

    it('uses DEFAULT_CHILD_ORIGIN when expectedChildOrigin omitted', () => {
        const iframe = makeIframe();
        const client = createPartnerClient({ iframe });
        const handler = vi.fn();
        client.on('iframe.ready', handler);

        window.dispatchEvent(new MessageEvent('message', {
            data: { channel: 'hashrace.v1', event: 'iframe.ready', payload: {}, nonce: 'n' },
            origin: 'https://app.hashrace.com',
            source: iframe.contentWindow,
        }));
        expect(handler).toHaveBeenCalledOnce();
    });
});
