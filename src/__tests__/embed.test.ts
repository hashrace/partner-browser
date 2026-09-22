import { describe, it, expect, beforeEach } from 'vitest';
import { embedHashraceIframe } from '../embed';
import { DEFAULT_IFRAME_ALLOW } from '../popup';

describe('embedHashraceIframe', () => {
    beforeEach(() => { document.body.innerHTML = ''; });

    it('creates iframe with correct default attributes and appends to container', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const { iframe } = embedHashraceIframe({
            launchUrl: 'https://app.hashrace.com/lobby?launch=lt_abc',
            container,
        });
        expect(iframe.src).toBe('https://app.hashrace.com/lobby?launch=lt_abc');
        expect(iframe.getAttribute('referrerpolicy')).toBe('strict-origin-when-cross-origin');
        const allowAttr = iframe.getAttribute('allow') ?? '';
        expect(allowAttr).toBe(DEFAULT_IFRAME_ALLOW);
        expect(allowAttr).toContain('web-share');
        expect(allowAttr).toContain('clipboard-write');
        expect(allowAttr).toContain('screen-wake-lock');
        expect(allowAttr).toContain('fullscreen');
        expect(iframe.title).toBe('Hashrace Game');
        expect(iframe.parentElement).toBe(container);
    });

    it('rejects non-https launchUrl', () => {
        const container = document.createElement('div');
        expect(() => embedHashraceIframe({
            launchUrl: 'http://app.hashrace.com/lobby?launch=x',
            container,
        })).toThrow(/https/i);
    });

    it('rejects malformed launchUrl', () => {
        const container = document.createElement('div');
        expect(() => embedHashraceIframe({
            launchUrl: 'not a url',
            container,
        })).toThrow();
    });

    it('returns client with expectedChildOrigin derived from launchUrl', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const { client } = embedHashraceIframe({
            launchUrl: 'https://app-staging.hashrace.com/lobby?launch=lt',
            container,
        });
        expect(typeof client.on).toBe('function');
        expect(typeof client.send).toBe('function');
        expect(typeof client.dispose).toBe('function');
    });

    it('respects custom width/height/title', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const { iframe } = embedHashraceIframe({
            launchUrl: 'https://app.hashrace.com/lobby',
            container,
            width: '1024px',
            height: '768px',
            title: 'Custom Game Title',
        });
        expect(iframe.width).toBe('1024px');
        expect(iframe.height).toBe('768px');
        expect(iframe.title).toBe('Custom Game Title');
    });

    it('allows overriding expectedChildOrigin explicitly', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const { client } = embedHashraceIframe({
            launchUrl: 'https://app.hashrace.com/lobby',
            container,
            expectedChildOrigin: 'https://app-eu.hashrace.com',
        });
        expect(typeof client.on).toBe('function');
    });

    it('iframeAllow custom value fully overrides default', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const { iframe } = embedHashraceIframe({
            launchUrl: 'https://app.hashrace.com/lobby',
            container,
            iframeAllow: 'camera *; microphone *',
        });
        expect(iframe.getAttribute('allow')).toBe('camera *; microphone *');
    });

    it('iframeAllow === "" opts out of allow attribute entirely', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const { iframe } = embedHashraceIframe({
            launchUrl: 'https://app.hashrace.com/lobby',
            container,
            iframeAllow: '',
        });
        expect(iframe.hasAttribute('allow')).toBe(false);
    });
});
