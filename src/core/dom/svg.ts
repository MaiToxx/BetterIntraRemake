/**
 * Turn one of our bundled SVG icons (imported with `?raw`) into a DOM node.
 *
 * The project never injects HTML strings into the page (no innerHTML,
 * insertAdjacentHTML or outerHTML), even for our own trusted assets: parsing
 * the markup as an SVG document and importing the resulting element gives the
 * same icon without an HTML-injection sink anywhere in the code base, so a
 * future change cannot quietly route other data through the same call.
 */

/**
 * Parse `markup` (a single <svg> element) and return it ready to insert, with
 * optional attributes applied (e.g. width/height). Returns null when the
 * markup is not a valid SVG document, so a broken asset shows no icon instead
 * of throwing.
 */
export function svgFromMarkup(
  markup: string,
  attributes: Record<string, string> = {},
): SVGSVGElement | null {
  const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== "svg" || doc.getElementsByTagName("parsererror").length) {
    return null;
  }
  const svg = document.importNode(root, true) as unknown as SVGSVGElement;
  for (const [name, value] of Object.entries(attributes)) svg.setAttribute(name, value);
  return svg;
}

/** Append a bundled icon to `parent`; a no-op when the markup is invalid. */
export function appendSvg(
  parent: Element,
  markup: string,
  attributes?: Record<string, string>,
): SVGSVGElement | null {
  const svg = svgFromMarkup(markup, attributes);
  if (svg) parent.appendChild(svg);
  return svg;
}
