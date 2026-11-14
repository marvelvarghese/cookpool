// Spliteco's stylesheet, scoped to one wrapper (money-inside MN-8). Cookpool
// shows Spliteco's own screens inside its Money tab; their stylesheet uses
// short global class names (.hdr, .stack, .btn) and element rules (a, button)
// that would restyle Cookpool. `scopeCss` puts every rule under `.spx`, turns
// `:root`, `html` and `body` into the wrapper itself, leaves @keyframes alone,
// and drops the light theme's rules: inside Cookpool, Money is Deep ocean.
//
// Plain JavaScript (with scope-css.d.mts) so the generator script and the
// tests share it. Dependency-free.

/** Split `css` into top-level blocks: `{ head, body }` for rules and at-rules, comments dropped. */
function blocks(css) {
  const out = [];
  let i = 0;
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  while (i < src.length) {
    const open = src.indexOf("{", i);
    if (open === -1) break;
    const head = src.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (j < src.length && depth > 0) {
      if (src[j] === "{") depth++;
      else if (src[j] === "}") depth--;
      j++;
    }
    out.push({ head, body: src.slice(open + 1, j - 1) });
    i = j;
  }
  return out;
}

/** One selector under the scope. */
function scopeSelector(sel, scope) {
  const s = sel.trim();
  if (s === ":root" || s === "html" || s === "body") return scope;
  if (s === "*") return `${scope}, ${scope} *`;
  return `${scope} ${s}`;
}

/** `css` with every rule under `scope`; null for a rule the scope drops. */
export function scopeCss(css, scope = ".spx") {
  const out = [];
  for (const { head, body } of blocks(css)) {
    if (head.startsWith("@keyframes") || head.startsWith("@font-face")) {
      out.push(`${head} {${body}}`);
      continue;
    }
    if (head.startsWith("@media") || head.startsWith("@supports")) {
      out.push(`${head} {\n${scopeCss(body, scope)}\n}`);
      continue;
    }
    const sels = head
      .split(",")
      .map((x) => x.trim())
      .filter((x) => x && !x.includes('[data-theme="light"]'));
    if (sels.length === 0) continue;
    const scoped = [...new Set(sels.flatMap((x) => scopeSelector(x, scope).split(", ")))];
    out.push(`${scoped.join(", ")} {${body}}`);
  }
  return out.join("\n");
}
