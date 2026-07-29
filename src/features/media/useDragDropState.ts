import { useFileDrop } from "./useDragDrop";

/** Named separately so tool screens read as one call, not two concepts. */
export const useDragDropState = (onDrop: (paths: string[]) => void) =>
  useFileDrop(onDrop);
