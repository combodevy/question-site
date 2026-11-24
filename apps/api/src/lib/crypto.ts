import crypto from 'node:crypto';
import zlib from 'node:zlib';

export const MAX_JSON_BYTES = 10 * 1024 * 1024;
export const MAX_AUTH_BYTES = 16 * 1024;

export function generateSalt(): string {
    return crypto.randomBytes(16).toString('hex');
}

/**
 * 与旧 Worker 100% 兼容的 PBKDF2-HMAC-SHA256 哈希实现（100,000 次迭代，16 字节盐解析与旧实现一致）。
 */
export async function hashPassword(password: string, saltHex: string): Promise<string> {
    const cleanHex = String(saltHex || '').match(/.{1,2}/g) || [];
    const saltBytes = Uint8Array.from(cleanHex.map((b) => parseInt(b, 16) || 0));
    return await new Promise((resolve, reject) => {
        crypto.pbkdf2(password, saltBytes, 100000, 32, 'sha256', (err, derived) => {
            if (err) reject(err);
            else resolve(derived.toString('hex'));
        });
    });
}

export function timingSafeEqualStr(a: string, b: string): boolean {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

export function sha256Hex(input: string): string {
    return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

export function randomTokenHex(bytes = 32): string {
    return crypto.randomBytes(bytes).toString('hex');
}

export interface JwtPayload {
    sub: string;
    username: string;
    role?: string;
    tv?: number;
    exp?: number;
    [key: string]: unknown;
}

export function signJwt(payload: JwtPayload, secret: string): string {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }), 'utf8').toString(
        'base64url'
    );
    const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const input = `${header}.${body}`;
    const sig = crypto.createHmac('sha256', secret).update(input, 'utf8').digest('base64url');
    return `${input}.${sig}`;
}

export function verifyJwt(token: string, secret: string): JwtPayload | null {
    if (!token || !secret) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, sigB64] = parts;
    const expectedSig = crypto
        .createHmac('sha256', secret)
        .update(`${headerB64}.${payloadB64}`, 'utf8')
        .digest('base64url');

    if (!timingSafeEqualStr(expectedSig, sigB64)) return null;

    try {
        const payload = JSON.parse(
            Buffer.from(payloadB64, 'base64url').toString('utf8')
        ) as JwtPayload;
        if (!payload || typeof payload !== 'object' || typeof payload.sub !== 'string') {
            return null;
        }
        if (typeof payload.exp === 'number' && payload.exp < Math.floor(Date.now() / 1000)) {
            return null;
        }
        return payload;
    } catch {
        return null;
    }
}

async function readStreamWithLimit(
    stream: ReadableStream<Uint8Array>,
    maxBytes: number
): Promise<Uint8Array | null> {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
                total += value.byteLength;
                if (total > maxBytes) {
                    try {
                        await reader.cancel();
                    } catch {
                        // ignore cancel failure
                    }
                    return null;
                }
                chunks.push(value);
            }
        }
    } finally {
        try {
            reader.releaseLock();
        } catch {
            // ignore
        }
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
        merged.set(c, offset);
        offset += c.byteLength;
    }
    return merged;
}

export async function readJsonBody<T = Record<string, unknown>>(
    request: Request,
    maxBytes = MAX_JSON_BYTES
): Promise<T | null> {
    try {
        const len = parseInt(request.headers.get('content-length') || '0', 10);
        if (Number.isFinite(len) && len > maxBytes) return null;

        const encoding = (request.headers.get('content-encoding') || '').toLowerCase();
        let rawBytes: Uint8Array | null = null;

        if (request.body && typeof request.body.getReader === 'function') {
            rawBytes = await readStreamWithLimit(request.body, maxBytes);
        } else {
            const ab = await request.arrayBuffer();
            if (ab.byteLength <= maxBytes) {
                rawBytes = new Uint8Array(ab);
            }
        }
        if (!rawBytes) return null;

        let text: string;
        if (encoding === 'gzip') {
            const gunzipped = zlib.gunzipSync(Buffer.from(rawBytes), { maxOutputLength: maxBytes });
            text = gunzipped.toString('utf8');
        } else {
            text = Buffer.from(rawBytes).toString('utf8');
        }
        if (text.length > maxBytes) return null;

        const body = JSON.parse(text);
        if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
        return body as T;
    } catch {
        return null;
    }
}
