/**
 * Shortcuts editor (Shortcuts tab): the list of custom links, drawn by
 * shortcuts.ui.ts. It stores the whole list under SHORTCUTS_LINKS itself,
 * debounced while a field is being typed in.
 */
import { render } from "lit-html";
import {
  getStoredLinks,
  extractLinksFromForm,
  renderShortcutsSettings,
  type ShortcutLink,
} from "../../shortcuts/shortcuts.ui.ts";

export function renderShortcutsPanel(): HTMLElement {
  const container = document.createElement("div");
  container.setAttribute("data-shortcuts-panel", "true");
  let links: ShortcutLink[] = [];

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const save = async () => {
    links = extractLinksFromForm(container);
    await chrome.storage.local.set({
      SHORTCUTS_LINKS: JSON.stringify(links),
    });
  };
  const debouncedSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => save(), 300);
  };

  const update = () => {
    render(
      renderShortcutsSettings(
        links,
        () => {
          if (links.length < 8) {
            links = [
              ...links,
              { name: "", url: "", color: "#7dd3fc", emoji: "" },
            ];
            update();
          }
        },
        async (idx) => {
          links = links.filter((_, i) => i !== idx);
          await chrome.storage.local.set({
            SHORTCUTS_LINKS: JSON.stringify(links),
          });
          update();
        },
        () => debouncedSave(),
        () => update(),
        (from, to) => {
          const newLinks = [...links];
          const [moved] = newLinks.splice(from, 1);
          newLinks.splice(to, 0, moved);
          links = newLinks;
          setTimeout(() => update(), 0);
        },
      ),
      container,
    );
  };

  getStoredLinks().then((storedLinks) => {
    links = storedLinks;
    update();
  });

  return container;
}
