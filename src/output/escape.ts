/**
 * Escapes text for use as HTML text content, the way the DOM serialises a text node: `&`, `<`
 * and `>`. It is not enough inside an attribute value, where quotes must be escaped too.
 */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
