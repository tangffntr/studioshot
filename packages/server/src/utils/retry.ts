/**
 * server/utils/retry.ts — 带指数退避的重试工具
 * 用于适配器调用（网络错误/限流自动重试，参数错误不重试）
 */

/** 判断错误是否值得重试（网络/超时/限流，非参数/认证错误） */
export function isRetryableError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  // 可重试：网络、超时、限流(429)、服务端(500/502/503)、连接重置
  return (
    msg.includes("network") ||
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("econnreset") ||
    msg.includes("enetunreach") ||
    msg.includes("429") ||
    msg.includes("rate limit") ||
    msg.includes("502") ||
    msg.includes("503") ||
    msg.includes("504") ||
    msg.includes("service unavailable") ||
    msg.includes("bad gateway") ||
    msg.includes("fetch failed")
  );
}

/**
 * 带重试的执行
 * @param fn 待执行函数
 * @param maxRetries 最大重试次数（默认 2）
 * @param baseDelay 基础延迟 ms（默认 2000，指数退避）
 */
export async function withRetry<T>(fn: () => Promise<T>, maxRetries = 2, baseDelay = 2000): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === maxRetries || !isRetryableError(err)) throw err;
      const delay = baseDelay * Math.pow(2, attempt); // 2s, 4s, 8s
      console.log(`[retry] 第${attempt + 1}次重试（${delay}ms 后），错误: ${(err as Error).message?.slice(0, 80)}`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
