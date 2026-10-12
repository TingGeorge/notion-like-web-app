/** Small Lucide-style SVGs for the vanilla DOM node views (the React layer uses lucide-react). */

function svg(inner: string, size = 16): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`
}

export const icons = {
  chevronRight: (s = 16) => svg('<path d="m9 18 6-6-6-6"/>', s),
  triangle: (s = 10) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 10 10" aria-hidden="true" focusable="false"><path d="M2 0.5v9l7-4.5z" fill="currentColor"/></svg>`,
  chevronDown: (s = 16) => svg('<path d="m6 9 6 6 6-6"/>', s),
  copy: (s = 16) =>
    svg(
      '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
      s,
    ),
  check: (s = 16) => svg('<path d="M20 6 9 17l-5-5"/>', s),
  file: (s = 16) =>
    svg('<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>', s),
  fileText: (s = 16) =>
    svg(
      '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
      s,
    ),
  image: (s = 16) =>
    svg(
      '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
      s,
    ),
  plus: (s = 16) => svg('<path d="M5 12h14"/><path d="M12 5v14"/>', s),
  download: (s = 16) =>
    svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>', s),
  info: (s = 16) => svg('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>', s),
}
