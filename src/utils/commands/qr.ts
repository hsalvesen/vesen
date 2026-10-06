import { encodeText, toText } from '../../lib/qr';
import { escapeHtml } from '../../output/escape';
import { playBeep } from '../beep';

/**
 * Encode `input` and draw it in half-block characters (dark modules as glyphs, no quiet zone),
 * two module rows per line so the code comes out square in the monospace terminal.
 */
function renderQr(input: string): string {
    const symbol = encodeText(input, { ecc: 'M' });
    return toText(symbol, { style: 'utf8i', margin: 0 }).join('\n');
}

export const qrCommands = {
    qr: (args: string[]): string => {
        if (args.length === 0) {
            playBeep();
            return [
                `<span style="color: var(--theme-cyan); font-weight: bold;">qr</span> - Generate a QR code from a URL or text`,
                `<span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> qr <span style="color: var(--theme-green);">[url or text]</span>`,
                `<span style="color: var(--theme-red); font-weight: bold;">Examples:</span>`,
                `&nbsp;&nbsp;qr https://github.com/hsalvesen/vesen`,
                `&nbsp;&nbsp;qr https://example.com`,
                `&nbsp;&nbsp;qr hello-world`,
            ].join('\n');
        }

        let input = args.join(' ');

        // Auto-prepend https:// if the input looks like a domain (has a dot, no scheme)
        if (
            !input.startsWith('http://') &&
            !input.startsWith('https://') &&
            !input.startsWith('mailto:') &&
            /^[a-zA-Z0-9]/.test(input) &&
            input.includes('.')
        ) {
            input = 'https://' + input;
        }

        try {
            const art = renderQr(input);

            const displayInput = input.length > 60 ? input.slice(0, 57) + '…' : input;

            return [
                `<span style="color: var(--theme-cyan);">QR Code</span> <span style="color: var(--theme-green);">${escapeHtml(displayInput)}</span>`,
                `<pre class="art" style="margin: 6px 0 0 0; color: var(--theme-white); background: var(--theme-background); padding-top: 6px; border-radius: 4px;">${art}</pre><span style="color: var(--theme-bright-black);">Scan with your phone camera to open the link</span>`,
            ].join('\n');
        } catch (err) {
            playBeep();
            return [
                `<span style="color: var(--theme-red); font-weight: bold;">qr: Failed to generate QR code</span>`,
                `<span style="color: var(--theme-yellow);">${escapeHtml(String(err))}</span>`,
            ].join('\n');
        }
    },
};
