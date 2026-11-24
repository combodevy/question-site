interface RateBucket {
    count: number;
    resetAt: number;
}

const buckets = new Map<string, RateBucket>();

export function checkRateLimit(
    key: string,
    max: number,
    windowMs: number
): { ok: boolean; retryAfter: number } {
    const now = Date.now();
    if (buckets.size > 10000) {
        for (const [k, v] of buckets) {
            if (now > v.resetAt) buckets.delete(k);
        }
        if (buckets.size > 50000) buckets.clear();
    }
    const rec = buckets.get(key);
    if (!rec || now > rec.resetAt) {
        buckets.set(key, { count: 1, resetAt: now + windowMs });
        return { ok: true, retryAfter: 0 };
    }
    rec.count += 1;
    if (rec.count > max) {
        return { ok: false, retryAfter: Math.max(1, Math.ceil((rec.resetAt - now) / 1000)) };
    }
    return { ok: true, retryAfter: 0 };
}

export function isRateBucketLocked(key: string, max: number): boolean {
    const rec = buckets.get(key);
    return Boolean(rec && rec.count >= max && Date.now() < rec.resetAt);
}

export function deleteRateBucket(key: string): void {
    buckets.delete(key);
}

export function clearAllRateBuckets(): void {
    buckets.clear();
}

export function clientIp(request: Request): string {
    const isLoopback = (ip: string | null | undefined) =>
        !ip || ip === '127.0.0.1' || ip === '::1' || ip === 'localhost';

    const cf = request.headers.get('cf-connecting-ip')?.trim();
    if (cf && !isLoopback(cf)) return cf;

    const realIp = request.headers.get('x-real-ip')?.trim();
    if (realIp && !isLoopback(realIp)) return realIp;

    const xff = request.headers.get('x-forwarded-for');
    if (xff) {
        const parts = xff
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
        for (let i = parts.length - 1; i >= 0; i -= 1) {
            if (!isLoopback(parts[i])) return parts[i];
        }
    }
    return realIp || (xff ? xff.split(',')[0].trim() : '127.0.0.1');
}
