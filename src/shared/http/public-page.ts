import { Router } from 'express';

/**
 * Gedeelde stijl voor publieke pagina's buiten de SPA (afmelden, mobiel uploaden). Wordt als los
 * bestand uitgeleverd (niet inline): de content-security-policy staat `style-src 'self'` toe maar
 * blokkeert inline `<style>`-blokken, dus een `<link>` naar hetzelfde origin is vereist.
 */
export const PUBLIC_PAGE_CSS = `
:root{--c-brand:#ff6a1a;--c-brand-strong:#e84d00;--c-ink:#241a12;--c-ink-soft:#5c5249;--c-muted:#7c7068;--c-bg:#faf6f1;--c-surface:#ffffff;--c-line:#e3d8cc;--c-danger:#b3261e;--c-ok:#2f9e44}
*{box-sizing:border-box}
body{font:1rem/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--c-ink);background:var(--c-bg);margin:0;padding:1.5rem 1rem 3rem}
main{max-width:34rem;margin:0 auto}
.card{background:var(--c-surface);border:1px solid var(--c-line);border-radius:12px;padding:1.5rem}
.brand{font-weight:800;letter-spacing:.04em;margin-bottom:1rem}
.brand span{color:var(--c-brand)}
h1{font-size:1.4rem;margin:0 0 .5rem}
p{margin:0 0 1rem}
.muted{color:var(--c-ink-soft)}
label{display:block;font-weight:600;margin:1rem 0 .35rem}
input[type=text],textarea{width:100%;font:inherit;padding:.6rem .7rem;border:2px solid var(--c-line);border-radius:8px;background:var(--c-surface);color:var(--c-ink)}
textarea{min-height:6rem;resize:vertical}
input[type=text]:focus-visible,textarea:focus-visible,button:focus-visible,input[type=checkbox]:focus-visible{outline:3px solid var(--c-ink);outline-offset:2px}
.checkbox{display:flex;align-items:flex-start;gap:.6rem;margin:1.25rem 0}
.checkbox input{width:1.4rem;height:1.4rem;flex:none;margin-top:.15rem}
.dropzone{border:2px dashed var(--c-line);border-radius:10px;padding:1.25rem;text-align:center;margin-top:.35rem}
.dropzone input{width:100%}
.filelist{list-style:none;padding:0;margin:.75rem 0 0;display:grid;gap:.4rem}
.filelist li{display:flex;justify-content:space-between;gap:.5rem;font-size:.9rem;background:var(--c-bg);border:1px solid var(--c-line);border-radius:6px;padding:.4rem .6rem}
button{font:inherit;font-weight:700;min-height:44px;width:100%;padding:0 1.5rem;border:2px solid var(--c-ink);border-radius:8px;background:var(--c-brand);color:var(--c-ink);cursor:pointer;margin-top:1rem}
button:hover{background:var(--c-brand-strong)}
button:disabled{opacity:.5;cursor:not-allowed}
.filelist button.btn-remove{width:auto;min-height:44px;min-width:44px;margin:0;padding:0 1rem;background:transparent;font-weight:600}
.filelist button.btn-remove:hover{background:var(--c-bg)}
.alert{border:2px solid var(--c-danger);color:var(--c-danger);border-radius:8px;padding:.75rem 1rem;margin:0 0 1rem;font-weight:600}
.success{border:2px solid var(--c-ok);color:var(--c-ok);border-radius:8px;padding:.75rem 1rem;margin:0 0 1rem;font-weight:600}
.hint{font-size:.85rem;color:var(--c-muted);margin-top:-.6rem}
`;

export const escapeHtml = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/** Basisopmaak voor elke publieke pagina buiten de SPA. */
export function publicPage(
  basePath: string,
  title: string,
  bodyHtml: string,
  scriptSrc?: string,
): string {
  const script = scriptSrc ? `<script src="${basePath}${scriptSrc}" defer></script>` : '';
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title><link rel="stylesheet" href="${basePath}/public.css">${script}</head><body><main><div class="brand" aria-hidden="true">SPARK<span>.</span></div><div class="card"><h1>${escapeHtml(title)}</h1>${bodyHtml}</div></main></body></html>`;
}

/** Levert de gedeelde stylesheet op `${basePath}/public.css`. Statisch, dus lang cachebaar. */
export function publicPageAssetsRouter(): Router {
  const r = Router();
  r.get('/public.css', (_req, res) => {
    res.set('Cache-Control', 'public, max-age=86400').type('text/css').send(PUBLIC_PAGE_CSS);
  });
  return r;
}
