import type {
  DownloadItem,
  DownloadStatus,
  ProgressPayload,
} from "./types";

export interface DownloadState {
  items: DownloadItem[];
  activeId: string | null;
  selectedId: string | null;
  isCancelling: boolean;
}

type TerminalDownloadStatus = Extract<
  DownloadStatus,
  "failed" | "cancelled"
>;

export type DownloadAction =
  | { type: "add"; item: DownloadItem }
  | { type: "progress"; payload: ProgressPayload; id?: string }
  | {
      type: "complete";
      id: string;
      filePath?: string;
      name?: string;
    }
  | {
      type: "set_terminal";
      id: string;
      status: TerminalDownloadStatus;
    }
  | { type: "finish" }
  | { type: "select"; id: string | null }
  | { type: "remove"; id: string }
  | { type: "cancelling"; value: boolean };

export function downloadReducer(
  state: DownloadState,
  action: DownloadAction,
): DownloadState {
  switch (action.type) {
    case "add":
      return {
        items: [action.item, ...state.items],
        activeId: action.item.id,
        selectedId: action.item.id,
        isCancelling: false,
      };

    case "progress": {
      const id = action.id ?? state.activeId;
      if (!id) return state;

      return {
        ...state,
        items: state.items.map((item) =>
          item.id === id
            ? {
                ...item,
                status: "downloading",
                progress: action.payload.percent,
                size: action.payload.size,
                speed: action.payload.speed,
                eta: action.payload.eta,
              }
            : item,
        ),
      };
    }

    case "complete":
      return {
        ...state,
        items: state.items.map((item) =>
          item.id === action.id
            ? {
                ...item,
                name: action.name ?? item.name,
                filePath: action.filePath,
                status: "completed",
                progress: 100,
                speed: "—",
                eta: "—",
              }
            : item,
        ),
      };

    case "set_terminal":
      return {
        ...state,
        items: state.items.map((item) =>
          item.id === action.id
            ? {
                ...item,
                status: action.status,
                speed: "—",
                eta: "—",
              }
            : item,
        ),
      };

    case "finish":
      return {
        ...state,
        activeId: null,
        isCancelling: false,
      };

    case "select":
      return { ...state, selectedId: action.id };

    case "remove":
      if (action.id === state.activeId) return state;
      return {
        ...state,
        items: state.items.filter((item) => item.id !== action.id),
        selectedId:
          state.selectedId === action.id ? null : state.selectedId,
      };

    case "cancelling":
      return { ...state, isCancelling: action.value };
  }
}
