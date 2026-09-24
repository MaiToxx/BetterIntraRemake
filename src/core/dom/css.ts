/**
 * Tag for a stylesheet written as a template literal: css`...`.
 *
 * WHY a tag that does nothing: the build (scripts/collapse-lit-templates.ts)
 * finds these literals by it, drops the tag and ships the text without its
 * comments and indentation, which only a reader of the source needs. Left
 * untagged, every comment and indent of the style blocks shipped in
 * content.js. Unbuilt (the tests), it returns what the untagged literal
 * would.
 */
export function css(strings: TemplateStringsArray, ...values: unknown[]): string {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += String(values[i]) + strings[i + 1];
  return out;
}
