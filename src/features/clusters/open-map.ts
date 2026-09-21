/**
 * The way in to the cluster map dialog from the rest of the content script.
 *
 * The dialog (map-dialog.ts and map-dialog/*) is a chunk loaded on the first
 * open: the sidebar button, the Clusters link of the personal-info block, the
 * seat badge and the seat labels only need this wrapper. The dialog's own
 * `opening` guard still merges a double click, since both clicks end up in
 * the one module instance. A chunk that cannot be loaded (a tab left open
 * across an extension update) opens nothing and throws nothing into the page.
 */
export function openClusterDialog(opts?: { seatId?: string }): Promise<void> {
  return import("./map-dialog.ts")
    .then((mod) => mod.openClusterDialog(opts))
    .catch((err: unknown) => {
      console.warn("Better Intra: the cluster map could not be opened.", err);
    });
}
