// jsdom 在部分 Node 版本缺 crypto.randomUUID，补 polyfill 以便测试断言 nonce 格式。
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto || typeof globalThis.crypto.randomUUID !== 'function') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).crypto = webcrypto;
}
