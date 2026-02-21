import { get } from 'svelte/store';
import { theme } from '../../stores/theme';
import { playBeep } from '../beep';
import QRCode from 'qrcode';

// Unicode half-block characters allow two QR module rows per text line,
// making the rendered code square and scannable.
const CHAR = {
    BOTH_DARK: '█',
    TOP_DARK: '▀',
    BOT_DARK: '▄',
    BOTH_LIGHT: ' ',
} as const;

/**
 * Render a boolean matrix (true = dark module) using half-block Unicode
 * characters so the QR code renders as a square in the monospace terminal.
 */
function renderQRMatrix(matrix: boolean[][]): string {
    const size = matrix.length;
    const lines: string[] = [];

    for (let row = 0; row < size; row += 2) {
        let line = '';
        for (let col = 0; col < size; col++) {
            const top = matrix[row][col];
            const bot = row + 1 < size ? matrix[row + 1][col] : false;

            if (top && bot) line += CHAR.BOTH_DARK;
            else if (top && !bot) line += CHAR.TOP_DARK;
            else if (!top && bot) line += CHAR.BOT_DARK;
            else line += CHAR.BOTH_LIGHT;
        }
        lines.push(line);
    }

    return lines.join('\n');
}

/**
 * Build a boolean[][] matrix from the qrcode library's internal representation.
 */
function buildMatrix(input: string): boolean[][] {
    const qr = QRCode.create(input, { errorCorrectionLevel: 'M' });
    const size = qr.modules.size;
    const data = qr.modules.data;
    const matrix: boolean[][] = [];

    for (let r = 0; r < size; r++) {
        const row: boolean[] = [];
        for (let c = 0; c < size; c++) {
            row.push(data[r * size + c] === 1);
        }
        matrix.push(row);
    }

    return matrix;
}

export const qrCommands = {
    qr: (args: string[]): string => {
        const currentTheme = get(theme);

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
            const matrix = buildMatrix(input);
            const art = renderQRMatrix(matrix);

            const displayInput = input.length > 60 ? input.slice(0, 57) + '…' : input;

            return [
                `<span style="color: var(--theme-cyan);">QR Code</span> <span style="color: var(--theme-green);">${displayInput}</span>`,
                `<pre style="font-family: monospace; line-height: 1.05; letter-spacing: 0; display: block; margin: 6px 0 0 0; color: var(--theme-white); background: var(--theme-background); padding: 6px 0 0 0; border-radius: 4px;">${art}</pre><span style="color: var(--theme-bright-black);">Scan with your phone camera to open the link</span>`,
            ].join('\n');
        } catch (err) {
            playBeep();
            return [
                `<span style="color: var(--theme-red); font-weight: bold;">qr: Failed to generate QR code</span>`,
                `<span style="color: var(--theme-yellow);">${String(err)}</span>`,
            ].join('\n');
        }
    },
};
