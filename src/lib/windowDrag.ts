import type { PointerEvent as ReactPointerEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

const noDragSelector = [
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "summary",
  "[contenteditable='true']",
  "[role='button']",
  "[role='link']",
  "[data-tauri-no-drag-region]",
].join(",");

export function isWindowDragTarget(target: EventTarget | null, currentTarget: EventTarget | null) {
  if (!(target instanceof Element) || !(currentTarget instanceof Element)) {
    return false;
  }

  return currentTarget.contains(target) && !target.closest(noDragSelector);
}

let lastDragClickTime = 0;

export function handleWindowDragPointerDown(event: ReactPointerEvent<HTMLElement>) {
  if (event.button !== 0 || event.defaultPrevented || !isWindowDragTarget(event.target, event.currentTarget)) {
    return;
  }

  const now = Date.now();
  if (now - lastDragClickTime < 500) {
    lastDragClickTime = 0;
    void getCurrentWindow().toggleMaximize();
    return;
  }

  lastDragClickTime = now;
  void Promise.resolve(getCurrentWindow().startDragging()).catch(() => undefined);
}
