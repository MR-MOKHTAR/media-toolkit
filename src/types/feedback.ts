export type ToastType = "success" | "error" | "info" | "warning";

export interface ToastState {
  id: number;
  type: ToastType;
  message: string;
}
