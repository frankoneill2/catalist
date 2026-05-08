// IBM Carbon icons (32×32 viewBox). Carbon is the icon system for this app.
// To add an icon: copy its <svg> *body* (without the wrapping <svg>, transparent rect,
// or <defs>) from https://github.com/carbon-design-system/carbon/tree/main/packages/icons/src/svg/32
// and add it below. Do not introduce other icon families.

const SVG_NS = 'http://www.w3.org/2000/svg';

const PATHS = {
  // Status / checkbox family
  'checkbox': '<path d="M26,4H6A2,2,0,0,0,4,6V26a2,2,0,0,0,2,2H26a2,2,0,0,0,2-2V6A2,2,0,0,0,26,4ZM6,26V6H26V26Z"/>',
  'checkbox--indeterminate': '<rect x="10" y="14" width="12" height="4"/><path d="M26,4H6A2,2,0,0,0,4,6V26a2,2,0,0,0,2,2H26a2,2,0,0,0,2-2V6A2,2,0,0,0,26,4ZM6,26V6H26V26Z"/>',
  'checkbox--checked': '<path d="M26,4H6A2,2,0,0,0,4,6V26a2,2,0,0,0,2,2H26a2,2,0,0,0,2-2V6A2,2,0,0,0,26,4ZM6,26V6H26V26Z"/><polygon points="14 21.5 9 16.54 10.59 15 14 18.35 21.41 11 23 12.58 14 21.5"/>',

  // Star
  'star': '<path d="M16,6.52l2.76,5.58.46,1,1,.15,6.16.89L22,18.44l-.75.73.18,1,1.05,6.13-5.51-2.89L16,23l-.93.49L9.56,26.34l1-6.13.18-1L10,18.44,5.58,14.09l6.16-.89,1-.15.46-1L16,6.52M16,2l-4.55,9.22L1.28,12.69l7.36,7.18L6.9,30,16,25.22,25.1,30,23.36,19.87l7.36-7.17L20.55,11.22Z"/>',
  'star--filled': '<path d="M16,2l-4.55,9.22L1.28,12.69l7.36,7.18L6.9,30,16,25.22,25.1,30,23.36,19.87l7.36-7.17L20.55,11.22Z"/>',

  // Chevrons
  'chevron--right': '<polygon points="22 16 12 26 10.6 24.6 19.2 16 10.6 7.4 12 6"/>',
  'chevron--down':  '<polygon points="16 22 6 12 7.4 10.6 16 19.2 24.6 10.6 26 12"/>',
  'chevron--left':  '<polygon points="10 16 20 6 21.4 7.4 12.8 16 21.4 24.6 20 26"/>',
  'chevron--up':    '<polygon points="16 10 26 20 24.6 21.4 16 12.8 7.4 21.4 6 20"/>',

  // Arrows
  'arrow--left':  '<polygon points="14 26 15.41 24.59 7.83 17 28 17 28 15 7.83 15 15.41 7.41 14 6 4 16 14 26"/>',

  // Actions
  'add':       '<polygon points="17 15 17 8 15 8 15 15 8 15 8 17 15 17 15 24 17 24 17 17 24 17 24 15"/>',
  'subtract':  '<rect x="8" y="15" width="16" height="2"/>',
  'close':     '<polygon points="17.4141 16 24 9.4141 22.5859 8 16 14.5859 9.4143 8 8 9.4141 14.5859 16 8 22.5859 9.4143 24 16 17.4141 22.5859 24 24 22.5859 17.4141 16"/>',
  'checkmark': '<polygon points="13 24 4 15 5.414 13.586 13 21.171 26.586 7.586 28 9 13 24"/>',

  // Updates feed
  'send--alt':         '<path d="M27.71,4.29a1,1,0,0,0-1.05-.23l-22,8a1,1,0,0,0,0,1.87l9.6,3.84,3.84,9.6A1,1,0,0,0,19,28h0a1,1,0,0,0,.92-.66l8-22A1,1,0,0,0,27.71,4.29ZM19,24.2l-2.79-7L21,12.41,19.59,11l-4.83,4.83L7.8,13,25.33,6.67Z"/>',
  'chat':              '<path d="M17.74,30,16,29l4-7h6a2,2,0,0,0,2-2V8a2,2,0,0,0-2-2H6A2,2,0,0,0,4,8V20a2,2,0,0,0,2,2h9v2H6a4,4,0,0,1-4-4V8A4,4,0,0,1,6,4H26a4,4,0,0,1,4,4V20a4,4,0,0,1-4,4H21.16Z"/><rect x="8" y="10" width="16" height="2"/><rect x="8" y="16" width="10" height="2"/>',
  'document':          '<path d="M25.7,9.3l-7-7C18.5,2.1,18.3,2,18,2H8C6.9,2,6,2.9,6,4v24c0,1.1,0.9,2,2,2h16c1.1,0,2-0.9,2-2V10C26,9.7,25.9,9.5,25.7,9.3z M18,4.4l5.6,5.6H18V4.4z M24,28H8V4h8v6c0,1.1,0.9,2,2,2h6V28z"/><rect x="10" y="22" width="12" height="2"/><rect x="10" y="16" width="12" height="2"/>',
  'undo':              '<path d="M20,10H7.8149l3.5874-3.5859L10,5,4,11,10,17l1.4023-1.4146L7.8179,12H20a6,6,0,0,1,0,12H12v2h8a8,8,0,0,0,0-16Z"/>',
  'reset':             '<path d="M18,28A12,12,0,1,0,6,16v6.2L2.4,18.6,1,20l6,6,6-6-1.4-1.4L8,22.2V16H8A10,10,0,1,1,18,26Z"/>',
  'checkmark--filled': '<path d="M16,2A14,14,0,1,0,30,16,14,14,0,0,0,16,2ZM14,21.5908l-5-5L10.5906,15,14,18.4092,21.41,11l1.5957,1.5859Z"/>',

  // Misc UI
  'menu':                     '<rect x="4" y="6" width="24" height="2"/><rect x="4" y="24" width="24" height="2"/><rect x="4" y="12" width="24" height="2"/><rect x="4" y="18" width="24" height="2"/>',
  'overflow-menu--vertical':  '<circle cx="16" cy="8" r="2"/><circle cx="16" cy="16" r="2"/><circle cx="16" cy="24" r="2"/>',
  'filter':                   '<path d="M18,28H14a2,2,0,0,1-2-2V18.41L4.59,11A2,2,0,0,1,4,9.59V6A2,2,0,0,1,6,4H26a2,2,0,0,1,2,2V9.59A2,2,0,0,1,27.41,11L20,18.41V26A2,2,0,0,1,18,28ZM6,6V9.59l8,8V26h4V17.59l8-8V6Z"/>',
  'search':                   '<path d="M29,27.5859l-7.5521-7.5521a11.0177,11.0177,0,1,0-1.4141,1.4141L27.5859,29ZM4,13a9,9,0,1,1,9,9A9.01,9.01,0,0,1,4,13Z"/>',
  'settings':                 '<path d="M27,16.76c0-.25,0-.5,0-.76s0-.51,0-.77l1.92-1.68A2,2,0,0,0,29.3,11L26.94,7a2,2,0,0,0-1.73-1,2,2,0,0,0-.64.1l-2.43.82a11.35,11.35,0,0,0-1.31-.75l-.51-2.52a2,2,0,0,0-2-1.61H13.64a2,2,0,0,0-2,1.61l-.51,2.52a11.48,11.48,0,0,0-1.32.75L7.43,6.06A2,2,0,0,0,6.79,6,2,2,0,0,0,5.06,7L2.7,11a2,2,0,0,0,.41,2.51L5,15.24c0,.25,0,.5,0,.76s0,.51,0,.77L3.11,18.45A2,2,0,0,0,2.7,21L5.06,25a2,2,0,0,0,1.73,1,2,2,0,0,0,.64-.1l2.43-.82a11.35,11.35,0,0,0,1.31.75l.51,2.52a2,2,0,0,0,2,1.61h4.72a2,2,0,0,0,2-1.61l.51-2.52a11.48,11.48,0,0,0,1.32-.75l2.42.82a2,2,0,0,0,.64.1,2,2,0,0,0,1.73-1L29.3,21a2,2,0,0,0-.41-2.51ZM25.21,24l-3.43-1.16a8.86,8.86,0,0,1-2.71,1.57L18.36,28H13.64l-.71-3.55a9.36,9.36,0,0,1-2.7-1.57L6.79,24,4.43,20l2.72-2.4a8.9,8.9,0,0,1,0-3.13L4.43,12,6.79,8l3.43,1.16a8.86,8.86,0,0,1,2.71-1.57L13.64,4h4.72l.71,3.55a9.36,9.36,0,0,1,2.7,1.57L25.21,8,27.57,12l-2.72,2.4a8.9,8.9,0,0,1,0,3.13L27.57,20Z"/><path d="M16,22a6,6,0,1,1,6-6A5.94,5.94,0,0,1,16,22Zm0-10a3.91,3.91,0,0,0-4,4,3.91,3.91,0,0,0,4,4,3.91,3.91,0,0,0,4-4A3.91,3.91,0,0,0,16,12Z"/>',
  'edit':                     '<rect x="2" y="26" width="28" height="2"/><path d="M25.4,9c0.8-0.8,0.8-2,0-2.8c0,0,0,0,0,0l-3.6-3.6c-0.8-0.8-2-0.8-2.8,0c0,0,0,0,0,0l-15,15V24h6.4L25.4,9z M20.4,4L24,7.6l-3,3L17.4,7L20.4,4z M6,22v-3.6l10-10l3.6,3.6l-10,10H6z"/>',
  'trash-can':                '<rect x="12" y="12" width="2" height="12"/><rect x="18" y="12" width="2" height="12"/><path d="M4,6V8H6V28a2,2,0,0,0,2,2H24a2,2,0,0,0,2-2V8h2V6ZM8,28V8H24V28Z"/><rect x="12" y="2" width="8" height="2"/>',
  'user':                     '<path d="M16,4a5,5,0,1,1-5,5,5,5,0,0,1,5-5m0-2a7,7,0,1,0,7,7A7,7,0,0,0,16,2Z"/><path d="M26,30H24V25a5,5,0,0,0-5-5H13a5,5,0,0,0-5,5v5H6V25a7,7,0,0,1,7-7h6a7,7,0,0,1,7,7Z"/>',
};

/**
 * Build an SVG element for a Carbon icon.
 * @param {string} name - icon key from PATHS
 * @param {object} [opts]
 * @param {number} [opts.size=16] - rendered pixel size (viewBox stays 32×32)
 * @param {string} [opts.label] - aria-label; if omitted icon is aria-hidden
 * @param {string} [opts.className] - extra class names
 * @returns {SVGElement}
 */
export function icon(name, opts = {}) {
  const body = PATHS[name];
  if (!body) {
    console.warn(`[icons] unknown Carbon icon: ${name}`);
    return document.createTextNode('');
  }
  const size = opts.size || 16;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 32 32');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'currentColor');
  svg.classList.add('cb-icon');
  if (opts.className) {
    for (const c of opts.className.split(/\s+/).filter(Boolean)) svg.classList.add(c);
  }
  if (opts.label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', opts.label);
  } else {
    svg.setAttribute('aria-hidden', 'true');
  }
  svg.innerHTML = body;
  return svg;
}

/**
 * Inline SVG markup as a string. Useful for one-off insertion via innerHTML.
 * Prefer `icon()` when building DOM.
 */
export function iconString(name, opts = {}) {
  const body = PATHS[name];
  if (!body) return '';
  const size = opts.size || 16;
  const a11y = opts.label
    ? `role="img" aria-label="${opts.label.replace(/"/g, '&quot;')}"`
    : 'aria-hidden="true"';
  const cls = `cb-icon${opts.className ? ' ' + opts.className : ''}`;
  return `<svg xmlns="${SVG_NS}" viewBox="0 0 32 32" width="${size}" height="${size}" fill="currentColor" class="${cls}" ${a11y}>${body}</svg>`;
}

/** Set/replace an existing element's child to display a Carbon icon. */
export function setIcon(el, name, opts = {}) {
  if (!el) return;
  el.replaceChildren(icon(name, opts));
}

export const ICON_NAMES = Object.freeze(Object.keys(PATHS));
