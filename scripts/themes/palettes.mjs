/**
 * The theme presets, in one place. `npm run generate:themes` turns this file
 * into the three things that must agree:
 *   - src/core/theme/themes.json: the Intra page's own variables (--background,
 *     --card, --muted, --border...), applied by theme-manager.ts;
 *   - the daisyUI theme blocks between the GENERATED THEMES markers of
 *     src/core/styles/style.css: the same colours for the extension's widgets;
 *   - src/features/hub/settings/theme-options.ts: the swatches of the hub.
 * tests/themes.test.ts fails when one of them was edited by hand or when a
 * palette misses the contrast floor.
 *
 * Three kinds of entries:
 *   - PALETTES: full themes of our own (hex colours). Every surface carries the
 *     theme's hue, which is what the older presets lacked;
 *   - RETINTS: daisyUI built-ins whose surfaces were plain grey; they keep
 *     their accent and get tinted surfaces, on the page and in the widgets;
 *   - LEGACY: the presets that stay as daisyUI ships them (listed so that the
 *     hub keeps its order and labels; their page variables are left alone).
 *
 * Contrast floors (checked by the generator): body text 7:1 on the page
 * background, secondary text 4.5:1, text on the accent 4.5:1.
 */

/** @typedef {"dark" | "light"} Mode */

/**
 * @typedef {object} Palette
 * @property {string} id           data-theme name and stored PROFILE_THEME_PRESET value
 * @property {string} label        shown in the hub
 * @property {Mode} mode
 * @property {string} group        hub section
 * @property {string} base100      page background
 * @property {string} base200      cards
 * @property {string} base300      deepest surface (daisyUI base-300)
 * @property {string} surface      hover / muted fills
 * @property {string} border
 * @property {string} content      body text
 * @property {string} muted        secondary text
 * @property {string} primary      accent
 * @property {string} [primaryContent] text on the accent (derived when absent)
 * @property {string} secondary
 * @property {string} accent
 * @property {string} neutral
 * @property {string} info
 * @property {string} success
 * @property {string} warning
 * @property {string} error
 */

/** @type {Palette[]} */
export const PALETTES = [
  // ---- dark ------------------------------------------------------------
  {
    id: "deep42", label: "42 Deep", mode: "dark", group: "Dark · Palettes",
    base100: "#0f1c1f", base200: "#0b1518", base300: "#081012", surface: "#16292d", border: "#1d363b",
    content: "#d6ecec", muted: "#8fb3b5", primary: "#00babc", primaryContent: "#041314",
    secondary: "#5ee3e5", accent: "#ffd166", neutral: "#1d363b",
    info: "#4cc9f0", success: "#52d69a", warning: "#ffb454", error: "#ff6b6b",
  },
  {
    id: "catppuccin", label: "Catppuccin", mode: "dark", group: "Dark · Palettes",
    base100: "#1e1e2e", base200: "#181825", base300: "#11111b", surface: "#313244", border: "#313244",
    content: "#cdd6f4", muted: "#a6adc8", primary: "#cba6f7", primaryContent: "#1e1e2e",
    secondary: "#f5c2e7", accent: "#94e2d5", neutral: "#45475a",
    info: "#89b4fa", success: "#a6e3a1", warning: "#f9e2af", error: "#f38ba8",
  },
  {
    id: "tokyonight", label: "Tokyo Night", mode: "dark", group: "Dark · Palettes",
    base100: "#1a1b26", base200: "#16161e", base300: "#101014", surface: "#292e42", border: "#292e42",
    content: "#c0caf5", muted: "#a9b1d6", primary: "#7aa2f7", primaryContent: "#16161e",
    secondary: "#bb9af7", accent: "#7dcfff", neutral: "#3b4261",
    info: "#7dcfff", success: "#9ece6a", warning: "#e0af68", error: "#f7768e",
  },
  {
    id: "gruvbox", label: "Gruvbox", mode: "dark", group: "Dark · Palettes",
    base100: "#282828", base200: "#1d2021", base300: "#141617", surface: "#3c3836", border: "#3c3836",
    content: "#ebdbb2", muted: "#a89984", primary: "#fabd2f", primaryContent: "#282828",
    secondary: "#fe8019", accent: "#8ec07c", neutral: "#504945",
    info: "#83a598", success: "#b8bb26", warning: "#fe8019", error: "#fb4934",
  },
  {
    id: "rosepine", label: "Rosé Pine", mode: "dark", group: "Dark · Palettes",
    base100: "#191724", base200: "#1f1d2e", base300: "#26233a", surface: "#26233a", border: "#403d52",
    content: "#e0def4", muted: "#908caa", primary: "#ebbcba", primaryContent: "#191724",
    secondary: "#c4a7e7", accent: "#9ccfd8", neutral: "#403d52",
    info: "#9ccfd8", success: "#3e8fb0", warning: "#f6c177", error: "#eb6f92",
  },
  {
    id: "nordnight", label: "Nord Night", mode: "dark", group: "Dark · Palettes",
    base100: "#2e3440", base200: "#292e39", base300: "#242933", surface: "#3b4252", border: "#3b4252",
    content: "#eceff4", muted: "#b0b8c6", primary: "#88c0d0", primaryContent: "#2e3440",
    secondary: "#81a1c1", accent: "#b48ead", neutral: "#434c5e",
    info: "#81a1c1", success: "#a3be8c", warning: "#ebcb8b", error: "#bf616a",
  },
  {
    id: "everforest", label: "Everforest", mode: "dark", group: "Dark · Palettes",
    base100: "#2d353b", base200: "#272e33", base300: "#232a2e", surface: "#343f44", border: "#3d484d",
    content: "#d3c6aa", muted: "#a3ada5", primary: "#a7c080", primaryContent: "#232a2e",
    secondary: "#83c092", accent: "#dbbc7f", neutral: "#475258",
    info: "#7fbbb3", success: "#a7c080", warning: "#e69875", error: "#e67e80",
  },
  {
    id: "kanagawa", label: "Kanagawa", mode: "dark", group: "Dark · Palettes",
    base100: "#1f1f28", base200: "#16161d", base300: "#121218", surface: "#2a2a37", border: "#363646",
    content: "#dcd7ba", muted: "#a6a69c", primary: "#7e9cd8", primaryContent: "#16161d",
    secondary: "#957fb8", accent: "#e6c384", neutral: "#363646",
    info: "#7fb4ca", success: "#98bb6c", warning: "#ffa066", error: "#e46876",
  },
  {
    id: "onedark", label: "One Dark", mode: "dark", group: "Dark · Palettes",
    base100: "#282c34", base200: "#21252b", base300: "#1b1f23", surface: "#2c313a", border: "#3e4451",
    content: "#c8ccd4", muted: "#9aa1ad", primary: "#61afef", primaryContent: "#1b1f23",
    secondary: "#c678dd", accent: "#56b6c2", neutral: "#3e4451",
    info: "#61afef", success: "#98c379", warning: "#e5c07b", error: "#e06c75",
  },
  {
    id: "solarized", label: "Solarized", mode: "dark", group: "Dark · Palettes",
    base100: "#002b36", base200: "#00212b", base300: "#001a22", surface: "#073642", border: "#0b4250",
    content: "#c3cccc", muted: "#8fa3a6", primary: "#2aa198", primaryContent: "#001a22",
    secondary: "#268bd2", accent: "#b58900", neutral: "#073642",
    info: "#268bd2", success: "#859900", warning: "#cb4b16", error: "#dc322f",
  },
  {
    id: "espresso", label: "Espresso", mode: "dark", group: "Dark · Palettes",
    base100: "#1f1915", base200: "#19140f", base300: "#120e0a", surface: "#2b221c", border: "#3a2e25",
    content: "#eadccb", muted: "#b5a18e", primary: "#d9a066", primaryContent: "#1f1915",
    secondary: "#c47a5a", accent: "#9fbf8f", neutral: "#3a2e25",
    info: "#7fa7c9", success: "#9fbf8f", warning: "#e0b04f", error: "#d9665b",
  },
  {
    id: "aurora", label: "Aurora", mode: "dark", group: "Dark · Palettes",
    base100: "#141226", base200: "#0f0d1e", base300: "#0a0915", surface: "#1f1c38", border: "#2a2650",
    content: "#e3defa", muted: "#a8a1cf", primary: "#8b7bff", primaryContent: "#0f0d1e",
    secondary: "#ff7ac6", accent: "#4de1c1", neutral: "#2a2650",
    info: "#62b6ff", success: "#4de1c1", warning: "#ffc46b", error: "#ff6b8a",
  },

  // ---- light -----------------------------------------------------------
  {
    id: "latte", label: "Latte", mode: "light", group: "Light · Palettes",
    base100: "#eff1f5", base200: "#e6e9ef", base300: "#dce0e8", surface: "#dfe2ea", border: "#ccd0da",
    content: "#3b3d52", muted: "#5c5f77", primary: "#8839ef", primaryContent: "#ffffff",
    secondary: "#ea76cb", accent: "#179299", neutral: "#bcc0cc",
    info: "#1e66f5", success: "#40a02b", warning: "#df8e1d", error: "#d20f39",
  },
  {
    id: "solarlight", label: "Solarized Light", mode: "light", group: "Light · Palettes",
    base100: "#fdf6e3", base200: "#eee8d5", base300: "#e4dcc4", surface: "#efe8d3", border: "#ded6bf",
    content: "#3b4d53", muted: "#52656b", primary: "#1d6fa8", primaryContent: "#fdf6e3",
    secondary: "#2aa198", accent: "#b58900", neutral: "#93a1a1",
    info: "#268bd2", success: "#859900", warning: "#cb4b16", error: "#dc322f",
  },
  {
    id: "gruvlight", label: "Gruvbox Light", mode: "light", group: "Light · Palettes",
    base100: "#fbf1c7", base200: "#f2e5bc", base300: "#ebdbb2", surface: "#efe2b9", border: "#d5c4a1",
    content: "#3c3836", muted: "#665c54", primary: "#9d5c0d", primaryContent: "#fbf1c7",
    secondary: "#af3a03", accent: "#427b58", neutral: "#d5c4a1",
    info: "#076678", success: "#79740e", warning: "#af3a03", error: "#9d0006",
  },
  {
    id: "dawn", label: "Rosé Dawn", mode: "light", group: "Light · Palettes",
    base100: "#faf4ed", base200: "#f4ede4", base300: "#f2e9e1", surface: "#efe6dc", border: "#dfdad9",
    content: "#464261", muted: "#615d79", primary: "#9e5066", primaryContent: "#fffaf3",
    secondary: "#907aa9", accent: "#56949f", neutral: "#dfdad9",
    info: "#286983", success: "#3e7f8a", warning: "#ea9d34", error: "#b4637a",
  },
  {
    id: "everlight", label: "Everforest Light", mode: "light", group: "Light · Palettes",
    base100: "#fdf6e3", base200: "#f4f0d9", base300: "#efebd4", surface: "#eeead2", border: "#e0dcc7",
    content: "#3f4a50", muted: "#5f6b66", primary: "#5c6b00", primaryContent: "#fdf6e3",
    secondary: "#35a77c", accent: "#dfa000", neutral: "#e6e2cc",
    info: "#3a94c5", success: "#8da101", warning: "#f57d26", error: "#f85552",
  },
  {
    id: "sakura", label: "Sakura", mode: "light", group: "Light · Palettes",
    base100: "#fdf3f6", base200: "#f9e6ec", base300: "#f2d6df", surface: "#f5dde5", border: "#ecc8d4",
    content: "#3d1f2a", muted: "#7d5262", primary: "#c2366b", primaryContent: "#fff5f8",
    secondary: "#b77fd1", accent: "#f29e4c", neutral: "#ecc8d4",
    info: "#5b8def", success: "#4caf7d", warning: "#e59a2f", error: "#d64545",
  },
  {
    id: "sage", label: "Sage", mode: "light", group: "Light · Palettes",
    base100: "#f4f7f2", base200: "#e9efe5", base300: "#dde6d7", surface: "#e3eadd", border: "#cfdac7",
    content: "#243221", muted: "#566751", primary: "#44713b", primaryContent: "#f4f7f2",
    secondary: "#8a9a5b", accent: "#c08b4a", neutral: "#cfdac7",
    info: "#4a7fa3", success: "#4f7f45", warning: "#c08b4a", error: "#b5524a",
  },
  {
    id: "lavender", label: "Lavender", mode: "light", group: "Light · Palettes",
    base100: "#f6f4fc", base200: "#eeeaf8", base300: "#e3ddf3", surface: "#e8e3f6", border: "#d6ceee",
    content: "#2b2247", muted: "#5e5484", primary: "#6547c9", primaryContent: "#f6f4fc",
    secondary: "#d65fa6", accent: "#3fa7a0", neutral: "#d6ceee",
    info: "#4d7ee8", success: "#3fa77a", warning: "#d99a33", error: "#d6505f",
  },
  {
    id: "dune", label: "Dune", mode: "light", group: "Light · Palettes",
    base100: "#f8f2e9", base200: "#f0e6d8", base300: "#e6d8c5", surface: "#ebdfcd", border: "#dac9b2",
    content: "#3a2e21", muted: "#6c5b49", primary: "#a8531f", primaryContent: "#fff8f0",
    secondary: "#8c6a4a", accent: "#4f8a83", neutral: "#dac9b2",
    info: "#3f7fa8", success: "#5c8a3f", warning: "#c9901f", error: "#b8432f",
  },
  {
    id: "mist", label: "Mist", mode: "light", group: "Light · Palettes",
    base100: "#f0f6f8", base200: "#e3eef2", base300: "#d5e4ea", surface: "#dbe8ee", border: "#c6d9e1",
    content: "#1b2f37", muted: "#4d6570", primary: "#176a88", primaryContent: "#f0f6f8",
    secondary: "#3fa7a0", accent: "#e0875a", neutral: "#c6d9e1",
    info: "#1c7a9c", success: "#3f9a6a", warning: "#d4912e", error: "#c9483f",
  },
];

/**
 * daisyUI built-ins whose surfaces were plain grey (or, for Forest, grey with
 * a red cast): same accent, surfaces tinted with a hue that suits the theme.
 * `hue`/`sat` drive the surface ramp; the accent comes from themes.json.
 * @type {{ id: string, mode: Mode, hue: number, sat: number }[]}
 */
export const RETINTS = [
  { id: "emerald", mode: "light", hue: 150, sat: 30 },
  { id: "corporate", mode: "light", hue: 220, sat: 30 },
  { id: "fantasy", mode: "light", hue: 280, sat: 28 },
  { id: "garden", mode: "light", hue: 345, sat: 22 },
  { id: "cmyk", mode: "light", hue: 195, sat: 30 },
  { id: "autumn", mode: "light", hue: 25, sat: 35 },
  { id: "acid", mode: "light", hue: 75, sat: 40 },
  { id: "bumblebee", mode: "light", hue: 48, sat: 50 },
  { id: "forest", mode: "dark", hue: 140, sat: 14 },
];

/**
 * The presets kept as daisyUI (or style.css) defines them, in hub order.
 * @type {{ id: string, label: string, mode: Mode, group: string }[]}
 */
export const LEGACY = [
  { id: "dark", label: "Default Dark", mode: "dark", group: "Dark" },
  { id: "neon", label: "Neon", mode: "dark", group: "Dark" },
  { id: "synthwave", label: "Synthwave", mode: "dark", group: "Dark" },
  { id: "forest", label: "Forest", mode: "dark", group: "Dark" },
  { id: "halloween", label: "Halloween", mode: "dark", group: "Dark" },
  { id: "dracula", label: "Dracula", mode: "dark", group: "Dark" },
  { id: "night", label: "Night", mode: "dark", group: "Dark" },
  { id: "sunset", label: "Sunset", mode: "dark", group: "Dark" },
  { id: "luxury", label: "Luxury", mode: "dark", group: "Dark" },
  { id: "cyberpunk", label: "Cyberpunk", mode: "dark", group: "Dark" },
  { id: "dim", label: "Arthur", mode: "dark", group: "Dark" },
  { id: "black", label: "Black", mode: "dark", group: "Dark" },
  { id: "coffee", label: "Aubergine", mode: "dark", group: "Dark" },
  { id: "aqua", label: "Aqua", mode: "dark", group: "Dark" },
  { id: "light", label: "Default Light", mode: "light", group: "Light" },
  { id: "cupcake", label: "Cupcake", mode: "light", group: "Light" },
  { id: "bumblebee", label: "Bumblebee", mode: "light", group: "Light" },
  { id: "emerald", label: "Emerald", mode: "light", group: "Light" },
  { id: "corporate", label: "Corporate", mode: "light", group: "Light" },
  { id: "retro", label: "Retro", mode: "light", group: "Light" },
  { id: "valentine", label: "Valentine", mode: "light", group: "Light" },
  { id: "garden", label: "Garden", mode: "light", group: "Light" },
  { id: "lofi", label: "Lofi", mode: "light", group: "Light" },
  { id: "pastel", label: "Pastel", mode: "light", group: "Light" },
  { id: "fantasy", label: "Fantasy", mode: "light", group: "Light" },
  { id: "wireframe", label: "Wireframe", mode: "light", group: "Light" },
  { id: "cmyk", label: "Cmyk", mode: "light", group: "Light" },
  { id: "autumn", label: "Autumn", mode: "light", group: "Light" },
  { id: "acid", label: "Acid", mode: "light", group: "Light" },
  { id: "lemonade", label: "Lemonade", mode: "light", group: "Light" },
  { id: "winter", label: "Winter", mode: "light", group: "Light" },
  { id: "nord", label: "Nord", mode: "light", group: "Light" },
  { id: "caramellatte", label: "Caramellatte", mode: "light", group: "Light" },
  { id: "silk", label: "Silk", mode: "light", group: "Light" },
  { id: "soap", label: "Soap", mode: "light", group: "Light" },
  { id: "citrus", label: "Citrus", mode: "light", group: "Light" },
];

/** Hub section order. */
export const GROUPS = ["Dark", "Dark · Palettes", "Light", "Light · Palettes"];
