/**
 * HTML rendering.
 *
 * ESCAPING IS THE DEFAULT AND UNESCAPING IS A DELIBERATE ACT. Every value
 * interpolated into the `html` template is escaped; the only way to inject
 * markup is to wrap it in `raw()`, which is greppable. The tracker holds text
 * copied verbatim out of requirement documents and commit messages, so this is
 * not theoretical.
 */

const RAW = Symbol('raw-html');

export const esc = (value) => {
  if (value === null || value === undefined) return '';
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
};

export const raw = (value) => ({ [RAW]: String(value ?? '') });

const render = (value) => {
  if (value === null || value === undefined || value === false) return '';
  if (Array.isArray(value)) return value.map(render).join('');
  if (typeof value === 'object' && RAW in value) return value[RAW];
  return esc(value);
};

export const html = (strings, ...values) =>
  raw(strings.reduce((acc, part, index) => acc + part + render(values[index]), ''));

/** Renders text that may contain paragraphs, preserving line breaks only. */
export const paragraphs = (text) =>
  raw(
    String(text ?? '')
      .split(/\n{2,}/)
      .filter((block) => block.trim().length > 0)
      .map((block) => `<p>${esc(block).replaceAll('\n', '<br>')}</p>`)
      .join(''),
  );

export const toString = (node) => (node === null || node === undefined ? '' : render(node));
