// A corpus of script-injection payloads and the checks that rendered output contains none of
// what they try to plant. Each payload runs `effect` if it ever executes; unit tests use a
// global canary, the browser tests a dialog.

declare global {
  interface Window {
    /** The canary the default payloads set if they ever run. */
    __x?: unknown;
  }
}

/** Payloads that try to run `effect` from rendered HTML. */
export function xssCorpus(effect = 'window.__x=1'): string[] {
  return [
    // Event handlers and elements that run script.
    `<img src=x onerror=${effect}>`,
    `<img/src/onerror=${effect}>`,
    `<svg onload=${effect}>`,
    `<svg><script>${effect}</script></svg>`,
    `<script>${effect}</script>`,
    `<iframe srcdoc="<script>${effect}</script>"></iframe>`,
    `<iframe src="javascript:${effect}"></iframe>`,
    `<object data="javascript:${effect}"></object>`,
    `<embed src="javascript:${effect}">`,
    `<details open ontoggle=${effect}>x</details>`,
    `<video><source onerror=${effect}></video>`,
    `<body onload=${effect}>`,
    `<input onfocus=${effect} autofocus>`,
    `<form action="javascript:${effect}"><button>go</button></form>`,
    `<button formaction="javascript:${effect}">go</button>`,
    `<math><a xlink:href="javascript:${effect}">x</a></math>`,
    // Links to script and data URLs.
    `<a href="javascript:${effect}">x</a>`,
    `<a href=" javascript:${effect}">x</a>`,
    `<a href="JaVaScRiPt:${effect}">x</a>`,
    `<a href="java&#x09;script:${effect}">x</a>`,
    `<a href="&#106;avascript:${effect}">x</a>`,
    `<a href="data:text/html,<script>${effect}</script>">x</a>`,
    `<a href="vbscript:msgbox(1)">x</a>`,
    // Styles that load or run something.
    `<span style="background:url(javascript:${effect})">x</span>`,
    `<span style="background-image: url(https://evil.example/x.png)">x</span>`,
    `<div style="width: expression(${effect})">x</div>`,
    `<span style="color: red; background: url('https://evil.example/x')">x</span>`,
    `<span style="color:\\72 ed;background:u\\72l(x)">x</span>`,
    `<style>*{background:url(https://evil.example/x)}</style>`,
    `<link rel=stylesheet href="https://evil.example/x.css">`,
    `<base href="javascript:${effect}//">`,
    `<meta http-equiv="refresh" content="0;url=javascript:${effect}">`,
    // Attribute breakouts.
    `"><img src=x onerror=${effect}>`,
    `'><svg onload=${effect}>`,
    `<span title="x" onmouseover="${effect}">x</span>`,
    `<span class="x" onclick=${effect}>x</span>`,
    `<span style="color:red" onfocus=${effect} tabindex=0 autofocus>x</span>`,
    `<a href="https://ok.example/" target="_self" onclick="${effect}">ok</a>`,
    // Mutation XSS: markup that changes meaning when it is serialised and parsed again.
    `<noscript><p title="</noscript><img src=x onerror=${effect}>">`,
    `<svg></p><style><a id="</style><img src=1 onerror=${effect}>">`,
    `<math><mtext><table><mglyph><style><img src=x onerror=${effect}>`,
    `<form><math><mtext></form><form><mglyph><style></math><img src onerror=${effect}>`,
    `<svg><style><img src=x onerror=${effect}></style></svg>`,
    `<template><img src=x onerror=${effect}></template>`,
    `<textarea><img src=x onerror=${effect}></textarea>`,
    `<title><img src=x onerror=${effect}></title>`,
    `<xmp><img src=x onerror=${effect}></xmp>`,
    `<!--<img src=x onerror=${effect}>-->`,
    `<listing>&lt;img src=x onerror=${effect}&gt;</listing>`,
    // Tap actions are never read from markup.
    `<span data-cmd="rm -rf ~" data-action="run">x</span>`,
    ...OVERLAY_PAYLOADS,
  ];
}

/** Invisible links laid over the prompt, so that any tap on the terminal would open them. */
export const OVERLAY_PAYLOADS: readonly string[] = [
  `<a href="https://evil.example/" style="position:absolute;inset:0;opacity:0">x</a>`,
  `<a href="https://evil.example/" style="position:relative;inset:200px auto auto 0;display:block;height:200px;opacity:0">x</a>`,
  `<a href="https://evil.example/" style="display:block;padding-bottom:600px;margin-bottom:-600px;opacity:0">x</a>`,
];

/** Elements that must never appear in rendered output. */
const FORBIDDEN_ELEMENTS = [
  'script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'svg', 'math', 'style', 'link', 'meta',
  'base', 'template', 'img', 'video', 'audio', 'source', 'form', 'input', 'textarea', 'noscript', 'details',
];

const URL_ATTRIBUTES = ['href', 'src', 'action', 'formaction', 'xlink:href', 'srcdoc', 'data', 'background', 'poster'];

/** Lower case, with whitespace and control characters removed, the way a URL parser reads a scheme. */
function scheme(value: string): string {
  return value.replace(/[\s\u0000-\u001f]+/g, '').toLowerCase();
}

/**
 * Every problem found under `root`: event handlers, active elements, script URLs, style loads,
 * and positioning that could lay output over the prompt.
 */
export function activeContent(root: ParentNode): string[] {
  const problems: string[] = [];
  for (const name of FORBIDDEN_ELEMENTS) {
    if (root.querySelector(name) !== null) problems.push(`<${name}> element`);
  }
  for (const element of Array.from(root.querySelectorAll('*'))) {
    for (const { name, value } of Array.from(element.attributes)) {
      const lower = name.toLowerCase();
      if (lower.startsWith('on')) problems.push(`${lower} on <${element.localName}>`);
      if (URL_ATTRIBUTES.includes(lower) && /^(?:javascript|data|vbscript):/.test(scheme(value))) {
        problems.push(`${lower}="${value}" on <${element.localName}>`);
      }
      if (lower === 'style' && /url\(|expression|javascript:|\\|position\s*:|inset\s*:/i.test(value)) {
        problems.push(`style="${value}" on <${element.localName}>`);
      }
      if (lower.startsWith('data-')) {
        problems.push(`${lower} on <${element.localName}>`);
      }
    }
  }
  return problems;
}
