import { describe, it, expect } from 'vitest';
import { isExpectedOrigin } from '../origin';

describe('isExpectedOrigin', () => {
    it('matches exact origin', () => {
        expect(isExpectedOrigin('https://app.hashrace.com', ['https://app.hashrace.com'])).toBe(true);
    });

    it('accepts single string expected (non-array)', () => {
        expect(isExpectedOrigin('https://app.hashrace.com', 'https://app.hashrace.com')).toBe(true);
    });

    it('rejects different scheme', () => {
        expect(isExpectedOrigin('http://app.hashrace.com', ['https://app.hashrace.com'])).toBe(false);
    });

    it('rejects different host', () => {
        expect(isExpectedOrigin('https://evil.com', ['https://app.hashrace.com'])).toBe(false);
    });

    it('matches any of multiple', () => {
        const list = ['https://app.hashrace.com', 'https://app-staging.hashrace.com'];
        expect(isExpectedOrigin('https://app-staging.hashrace.com', list)).toBe(true);
    });

    it('rejects null string origin', () => {
        expect(isExpectedOrigin('null', ['https://app.hashrace.com'])).toBe(false);
    });

    it('rejects undefined origin', () => {
        expect(isExpectedOrigin(undefined, ['https://app.hashrace.com'])).toBe(false);
    });

    it('rejects empty string origin', () => {
        expect(isExpectedOrigin('', ['https://app.hashrace.com'])).toBe(false);
    });
});
