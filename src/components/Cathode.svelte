<!--
  Decorative CRT ("cathode") overlay. Every layer is always present in the DOM;
  which layers are visible and how they animate is controlled entirely by the
  `crt-*` classes applied to <html> by the cathode store (see app.css).
  The overlay is pointer-events:none so it never intercepts terminal input.
-->
<div class="crt-overlay" aria-hidden="true">
  <div class="crt-layer crt-layer-scanlines"></div>
  <div class="crt-layer crt-layer-mask"></div>
  <div class="crt-layer crt-layer-sweep"></div>
  <div class="crt-layer crt-layer-flicker"></div>
  <div class="crt-layer crt-layer-vignette"></div>
</div>
