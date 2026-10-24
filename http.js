export async function getJson(url, { headers = {}, timeoutMs = 15000 } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: ctl.signal });
    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      /* non-JSON body */
    }
    return { status: res.status, ok: res.ok, body, headers: res.headers, text: text.slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}
