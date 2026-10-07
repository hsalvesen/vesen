import { commandHelp } from '../helpTexts';
import { playBeep } from '../beep';
import { fetchTextCapped, fetchWithTimeout, isNetError } from '../../services/net';
import { escapeHtml } from '../../output/escape';
import { cancelledNotice, errorLine } from '../notice';

// Per-request deadlines (docs/plan/02-architecture-and-contracts.md, section 4).
const CURL_TIMEOUT_MS = 10000;
const SPEEDTEST_TIMEOUT_MS = 15000;

// curl reads at most this much of a body (docs/plan/designs/shell-architecture.md), and shows
// at most CURL_MAX_CHARS of it.
const CURL_MAX_BYTES = 1024 * 1024;
const CURL_MAX_CHARS = 10000;

const inSeconds = (ms: number) => `${ms / 1000} s`;

const wasCancelled = (error: unknown, signal?: AbortSignal) =>
  Boolean(signal?.aborted) || (isNetError(error) && error.kind === 'abort');

function curlFailure(error: unknown, host: string): string {
  if (isNetError(error)) {
    switch (error.kind) {
      case 'timeout':
        return `curl: (28) Operation timed out after ${CURL_TIMEOUT_MS} milliseconds`;
      case 'offline':
        return `curl: (6) Could not resolve host: ${host} (you appear to be offline)`;
      case 'cors':
        // DNS, TLS, refused connections and missing CORS headers all reach the page as the same
        // TypeError, so curl cannot tell them apart.
        return `curl: (7) ${host}: blocked by CORS or unreachable (the browser does not say which)`;
      case 'network':
        return `curl: (7) Failed to connect to ${host}`;
    }
  }
  return `curl: (56) Failure when receiving data from ${host}`;
}

function speedtestFailure(error: unknown): string {
  if (!isNetError(error)) return 'speedtest: the test failed. Try again later.';
  switch (error.kind) {
    case 'timeout':
      return `speedtest: ${error.host} did not respond within ${inSeconds(SPEEDTEST_TIMEOUT_MS)}.`;
    case 'offline':
      return 'speedtest: you appear to be offline.';
    case 'http':
      return `speedtest: ${error.host} returned HTTP ${error.status}.`;
    default:
      return `speedtest: could not reach ${error.host}.`;
  }
}

export const networkCommands = {
  // A direct fetch: the browser allows it only when the site sends CORS headers, and curl says so
  // when it does not. An owned proxy is planned (docs/plan/07-stock-and-proxy.md).
  curl: async (args: string[], signal?: AbortSignal) => {
    if (args.length === 0) {
      return commandHelp.curl;
    }

    let url = args[0];

    // Add protocol if missing
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }

    let target: URL;
    try {
      target = new URL(url);
    } catch {
      playBeep();
      return errorLine('curl: (3) URL rejected: Malformed input to a URL function');
    }
    const host = target.host;

    // The browser blocks http:// from an https page as mixed content; that is not the site's doing.
    if (target.protocol === 'http:' && typeof location !== 'undefined' && location.protocol === 'https:') {
      playBeep();
      return errorLine(`curl: (1) http:// is blocked on an https page; try ${target.href.replace(/^http:/, 'https:')}`);
    }

    let data: string;
    let truncated: boolean;
    try {
      // Like curl without -f, an HTTP error status still prints the body.
      ({ text: data, truncated } = await fetchTextCapped(url, {
        signal,
        timeoutMs: CURL_TIMEOUT_MS,
        throwHttpErrors: false,
        maxBytes: CURL_MAX_BYTES,
      }));
    } catch (error) {
      if (wasCancelled(error, signal)) return cancelledNotice('curl');
      playBeep();
      return errorLine(curlFailure(error, host));
    }

    if (truncated || data.length > CURL_MAX_CHARS) {
      data = data.substring(0, CURL_MAX_CHARS) + '\n\n[Output truncated - content too long]';
    }

    // Wraps at the edge of the screen, whatever its width.
    return `<pre style="color: var(--role-fg); white-space: pre-wrap; word-wrap: break-word; word-break: break-word; max-width: 100%; overflow-wrap: break-word;">${escapeHtml(data)}</pre>`;
  },

  speedtest: async (args: string[], signal?: AbortSignal, status?: (text: string | null) => void) => {
    const downUrl = 'https://speed.cloudflare.com/__down';
    const upUrl = 'https://speed.cloudflare.com/__up';

    // The deadline covers each request until its response arrives. A slow download body is not
    // cut off, so slow links still get a result; cancelling stops it. Time-bounded samples are Phase 4.
    const measureDownload = async (bytes: number) => {
      const url = `${downUrl}?bytes=${bytes}&ts=${Date.now()}`;
      const t0 = performance.now();
      const res = await fetchWithTimeout(url, { cache: 'no-store', signal, timeoutMs: SPEEDTEST_TIMEOUT_MS });
      const blob = await res.blob();
      const t1 = performance.now();
      const seconds = Math.max((t1 - t0) / 1000, 0.001);
      const mbps = (bytes * 8) / seconds / 1e6;
      return { seconds, mbps, bytes: blob.size || bytes };
    };

    const measureUploadBeacon = async (bytes: number) => {
      const chunkSize = 64 * 1024;
      let remaining = bytes;
      let sent = 0;
      const t0 = performance.now();
      while (remaining > 0) {
        const size = Math.min(remaining, chunkSize);
        const ab = new ArrayBuffer(size);
        new Uint8Array(ab).fill(0);
        const ok = navigator.sendBeacon(upUrl, ab);
        if (!ok) break;
        sent += size;
        remaining -= size;
        await new Promise((r) => setTimeout(r, 0));
      }
      const t1 = performance.now();
      const seconds = Math.max((t1 - t0) / 1000, 0.001);
      const mbps = (sent * 8) / seconds / 1e6;
      return { seconds, mbps, bytes: sent };
    };

    const measureUpload = async (bytes: number) => {
      const chunkSize = 64 * 1024;
      const chunks: Uint8Array[] = [];
      let remaining = bytes;

      while (remaining > 0) {
        const size = Math.min(remaining, chunkSize);
        const chunk = new Uint8Array(size);
        try {
          crypto.getRandomValues(chunk);
        } catch {}
        chunks.push(chunk);
        remaining -= size;
      }

      const parts: ArrayBuffer[] = chunks.map((c) => {
        const ab = new ArrayBuffer(c.byteLength);
        new Uint8Array(ab).set(c);
        return ab;
      });
      const payload = new Blob(parts, { type: 'application/octet-stream' });

      const t0 = performance.now();
      try {
        const fd = new FormData();
        fd.append('file', payload, 'upload.bin');
        await fetchWithTimeout(upUrl, {
          method: 'POST',
          body: fd,
          mode: 'no-cors',
          cache: 'no-store',
          signal,
          timeoutMs: SPEEDTEST_TIMEOUT_MS,
          referrerPolicy: 'no-referrer'
        });
      } catch (error) {
        if (wasCancelled(error, signal)) throw error;
        return measureUploadBeacon(bytes);
      }
      const t1 = performance.now();
      const seconds = Math.max((t1 - t0) / 1000, 0.001);
      const mbps = (bytes * 8) / seconds / 1e6;
      return { seconds, mbps, bytes };
    };

    const measureLatency = async (count: number) => {
      const samples: number[] = [];
      for (let i = 0; i < count; i++) {
        const url = `${downUrl}?bytes=1&ts=${Date.now()}&i=${i}`;
        const t0 = performance.now();
        await fetchWithTimeout(url, { cache: 'no-store', signal, timeoutMs: SPEEDTEST_TIMEOUT_MS });
        const t1 = performance.now();
        samples.push(t1 - t0);
      }
      const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
      const min = Math.min(...samples);
      const max = Math.max(...samples);
      return { avg, min, max };
    };

    try {
      const lines: string[] = [];

      lines.push(`<span style="color: var(--role-accent);">Cloudflare Speed Test</span>`);

      status?.('measuring the download speed…');
      const downloadSizes = [5 * 1024 * 1024, 10 * 1024 * 1024, 25 * 1024 * 1024];
      const downloadSamples: number[] = [];
      for (const size of downloadSizes) {
        const m = await measureDownload(size);
        downloadSamples.push(m.mbps);
      }
      const dAvg = downloadSamples.reduce((a, b) => a + b, 0) / downloadSamples.length;
      lines.push(`<span style="color: var(--role-ok);">Download:</span> ${dAvg.toFixed(1)} Mbps (avg of ${downloadSamples.length} samples)`);

      status?.('measuring the upload speed…');
      const uploadSizes = [64 * 1024, 256 * 1024, 1 * 1024 * 1024];
      const uploadSamples: number[] = [];
      let uploadErrors = 0;
      for (const size of uploadSizes) {
        try {
          const m = await measureUpload(size);
          uploadSamples.push(m.mbps);
        } catch (error) {
          if (wasCancelled(error, signal)) throw error;
          uploadErrors++;
          // continue collecting other samples
        }
      }
      if (uploadSamples.length > 0) {
        const uAvg = uploadSamples.reduce((a, b) => a + b, 0) / uploadSamples.length;
        const note = uploadErrors > 0 ? ` (some samples blocked)` : '';
        lines.push(`<span style="color: var(--role-link);">Upload:</span> ${uAvg.toFixed(1)} Mbps (avg of ${uploadSamples.length} samples)${note}`);
      } else {
        lines.push(`<span style="color: var(--role-link);">Upload:</span> unavailable due to browser/network restrictions`);
      }

      status?.('measuring the latency…');
      const lat = await measureLatency(10);
      lines.push(`<span style="color: var(--role-warn);">Ping:</span> avg ${lat.avg.toFixed(0)} ms, min ${lat.min.toFixed(0)} ms, max ${lat.max.toFixed(0)} ms`);

      status?.(null);
      return `<div>${lines.join('<br>')}</div>`;
    } catch (error) {
      status?.(null);
      if (wasCancelled(error, signal)) return cancelledNotice('speedtest');
      playBeep();
      return errorLine(speedtestFailure(error));
    }
  }
}
