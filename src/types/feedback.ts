export type ToastType = "success" | "error" | "info" | "warning";

/** A single button on a toast -- "Show in folder" on a finished job. One, not a
 *  list: a toast that needs two decisions is a dialog. */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastState {
  /** A uuid rather than `Date.now()`: two jobs finishing in the same
   *  millisecond used to collide, and this is now a React key. */
  id: string;
  type: ToastType;
  message: string;
  /** When it should leave on its own. Held on the toast so several can expire
   *  independently instead of sharing one timer. */
  expiresAt: number;
  action?: ToastAction;
}
