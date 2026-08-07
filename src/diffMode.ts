// Which body a diffed file gets, and which toolbar controls come with it.
//
// SVG is the one rendered type where the picture is lossy: a changed viewBox, a
// renamed id, a stroke tweak below visual threshold, or a rewritten path with
// identical output are all invisible. So SVG alone gets a rendered/source toggle.
// Raster images have no readable source — git only says "Binary files ... differ" —
// so they get no toggle; a control that leads nowhere is worse than none.
const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|avif|ico|bmp)$/i
const SVG_RE = /\.svg$/i

export type DiffMode = {
  body: 'image' | 'text'
  richToggle: boolean // Rendered | Source
  splitToggle: boolean // Unified | Split — nothing to split in an image body
}

export function diffMode(file: string, rich: boolean): DiffMode {
  const svg = SVG_RE.test(file)
  const image = IMAGE_RE.test(file) && (rich || !svg)
  return { body: image ? 'image' : 'text', richToggle: svg, splitToggle: !image }
}

// SVG fetches its patch even in rendered mode, so flipping the toggle needs no
// round trip. One extra `git diff` on one small file is cheaper than a stall.
export function needsPatch(file: string): boolean {
  return !IMAGE_RE.test(file) || SVG_RE.test(file)
}
