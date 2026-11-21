import { create } from "zustand";

export type DropHandler = (paths: string[]) => void | Promise<void>;

export function isPdfPath(path: string): boolean {
  return /\.pdf$/i.test(path);
}

export function isImagePath(path: string): boolean {
  return /\.(jpe?g|png|webp|tiff?|bmp)$/i.test(path);
}

export function isP12Path(path: string): boolean {
  return /\.(p12|pfx)$/i.test(path);
}

export function isPdfOrImagePath(path: string): boolean {
  return isPdfPath(path) || isImagePath(path);
}

interface DragDropState {
  isDraggingFiles: boolean;
  draggedPaths: string[];
  activeDropHint: string | null;
  handler: DropHandler | null;
  setDragging: (dragging: boolean, paths?: string[]) => void;
  registerHandler: (handler: DropHandler, hint: string) => () => void;
}

export const useDragDropStore = create<DragDropState>((set, get) => ({
  isDraggingFiles: false,
  draggedPaths: [],
  activeDropHint: null,
  handler: null,

  setDragging: (dragging, paths) =>
    set((state) => ({
      isDraggingFiles: dragging,
      draggedPaths: dragging ? (paths ?? state.draggedPaths) : [],
    })),

  registerHandler: (handler, hint) => {
    set({ handler, activeDropHint: hint });
    return () => {
      if (get().handler === handler) {
        set({ handler: null, activeDropHint: null });
      }
    };
  },
}));
