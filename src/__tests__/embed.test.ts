import { describe, it, expect, beforeEach } from 'vitest';
import { embedHashraceIframe } from '../embed';

describe('embedHashraceIframe', () => {
    beforeEach(() => { document.body.innerHTML = ''; });

    it('creates iframe with correct attributes and appends to container', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const { iframe } = embedHashraceIframe({
            launchUrl: 'https://app.hashrace.com/lobby?launch=lt_abc',
            container,
        });
        expect(iframe.src).toBe('https://app.hashrace.com/lobby?launch=lt_abc');
        expect(iframe.getAttribute('referrerpolicy')).toBe('strict-origin-when-cross-origin');
        const allowAttr = iframe.getAttribute('allow') ?? '';
        expect(allowAttr).toContain('payment');
        expect(allowAttr).toContain('fullscreen');
        expect(iframe.title).toBe('HashMach Game');
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
});
