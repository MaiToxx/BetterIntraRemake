/**
 * The friends widget's state: the shape every render function reads, and the
 * stored settings a new widget starts from. The single live instance, and the
 * handlers that mutate it, belong to the controller (friends.ui.ts).
 */
import { getConfig } from "../../core/config.ts";
import { getEffectiveTheme } from "../../core/theme/theme-manager.ts";
import type { FriendData } from "./friends-types.ts";
import { SORT_MODES, type SortDir, type SortMode } from "./friends-sort.ts";

/** What the panel displays. */
export interface WidgetData {
  open: boolean;
  loading: boolean;
  loadError: boolean;
  friends: FriendData[];
  sortBy: SortMode;
  sortDir: SortDir;
  onlineOnly: boolean;
  addInput: string;
  addLoading: boolean;
  addError: string;
  addOpen: boolean;
  lastFetch: number | null;
  theme: string;
  needsReconnect: boolean;
  notConnected: boolean;
  deleteMode: boolean;
  selected: string[];
  showCustomAvatars: boolean;
}

/** What the panel's controls call back into. */
export interface WidgetHandlers {
  onToggle: () => void;
  onRefresh: () => void;
  onSortChange: (mode: SortMode, dir: SortDir) => void;
  onToggleOnline: () => void;
  onDeleteMode: () => void;
  onToggleSelect: (login: string) => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onInputChange: (val: string) => void;
  onAdd: () => void;
  onToggleAdd: () => void;
  onConnect: () => void;
  /** A row swapped between the custom and the 42 avatar: re-render. */
  onAvatarToggle: () => void;
}

export interface WidgetState extends WidgetData, WidgetHandlers {}

/**
 * The state of a freshly mounted widget: closed, empty list, and the
 * connection status, theme, sort and filters read from the stored settings.
 */
export async function loadInitialData(): Promise<WidgetData> {
  const token = await getConfig("CLOUD_TOKEN");
  const authFailed = !!(await getConfig("CLOUD_AUTH_FAILED"));

  const effectiveTheme = await getEffectiveTheme();
  const presetKey = await getConfig("PROFILE_THEME_PRESET");
  const daisyTheme =
    presetKey !== "dark" && presetKey !== "light"
      ? presetKey
      : effectiveTheme === "light"
        ? "light"
        : "dark";

  const storedSort = await getConfig("FRIENDS_SORT_MODE");
  const sortBy: SortMode = SORT_MODES.includes(storedSort)
    ? storedSort
    : "level";
  const storedDir = await getConfig("FRIENDS_SORT_DIR");
  const sortDir: SortDir = storedDir === "asc" ? "asc" : "desc";

  return {
    open: false,
    loading: false,
    loadError: false,
    friends: [],
    sortBy,
    sortDir,
    onlineOnly: await getConfig("FRIENDS_ONLINE_ONLY"),
    addInput: "",
    addLoading: false,
    addError: "",
    addOpen: false,
    lastFetch: null,
    theme: daisyTheme,
    needsReconnect: !!token && authFailed,
    notConnected: !token,
    deleteMode: false,
    selected: [],
    showCustomAvatars: await getConfig("SHOW_CUSTOM_AVATARS_IN_FRIENDS"),
  };
}
