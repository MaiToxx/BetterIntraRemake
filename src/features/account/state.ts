import type { PushFailure } from "./account.ts";

export interface ButtonState {
  loading: boolean;
  success: boolean;
  error: boolean;
  text: string;
}

/**
 * What the popup knows about the worker: "checking" until the first answer
 * of this open (the card is painted from storage before any request),
 * "online" once it answered, "offline" when it did not.
 */
export type CloudStatus = "checking" | "online" | "offline";

export interface AccountState {
  login: string | null;
  token: string;
  /** Last count the worker gave, this open or a previous one; null before any. */
  activeSessions: number | null;
  cloud: CloudStatus;
  needsReconnect: boolean;
  /** A sign-in started from this popup has not ended yet. */
  signingIn: boolean;
  /** Why the last sign-in from this popup failed, shown under its button. */
  loginError: string;
  /** SIGNIN_DISCLOSURE_ACCEPTED, read from storage on every render. */
  disclosureAccepted: boolean;
  /** The sign-in notice is on screen in place of the card. */
  disclosureOpen: boolean;
  /** Why the last push failed (any caller), until one succeeds. */
  pushFailure: PushFailure | null;
  buttons: {
    push: ButtonState;
    pull: ButtonState;
  };
}

export function createInitialState(): AccountState {
  return {
    login: null,
    token: "",
    activeSessions: null,
    cloud: "checking",
    needsReconnect: false,
    signingIn: false,
    loginError: "",
    disclosureAccepted: false,
    disclosureOpen: false,
    pushFailure: null,
    buttons: {
      push: {
        loading: false,
        success: false,
        error: false,
        text: "Push Settings",
      },
      pull: {
        loading: false,
        success: false,
        error: false,
        text: "Pull Settings",
      },
    },
  };
}

export function resetButtonState(
  state: AccountState,
  button: "push" | "pull",
  text: string,
) {
  state.buttons[button] = {
    loading: false,
    success: false,
    error: false,
    text,
  };
}
