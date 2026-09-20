/** Loopback-only MVP. No public deployment until user authentication is added. */
export function isLoopback(hostname: string): boolean {
  return ["127.0.0.1", "localhost", "[::1]", "::1"].includes(hostname.toLowerCase());
}

export function localRequestOrigin(host: string | null): string | null {
  if (!host || !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/.test(host.toLowerCase())) return null;
  try {
    const parsed = new URL(`http://${host}`);
    return isLoopback(parsed.hostname) ? parsed.origin : null;
  } catch { return null; }
}
