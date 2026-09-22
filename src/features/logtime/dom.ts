import { DASHBOARD_CARD_SELECTOR } from "../../core/intra/selectors.ts";

export function findLogtimeMount(): HTMLElement | null {
  const legacy = Array.from(
    document.querySelectorAll<HTMLElement>(DASHBOARD_CARD_SELECTOR),
  ).find((c) => (c.textContent || "").toUpperCase().includes("LOGTIME"));
  if (legacy?.parentElement) return legacy.parentElement;

  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>("main div[class*='grid']"),
  );
  return (
    candidates.find(
      (el) => el.children.length > 2 && el.offsetParent !== null,
    ) || null
  );
}

export function hideOldLogtime(): void {
  document.querySelectorAll<HTMLElement>(DASHBOARD_CARD_SELECTOR).forEach((c) => {
    if ((c.textContent || "").toUpperCase().includes("LOGTIME"))
      c.style.display = "none";
  });
}

export function setupScrollHandlers(scrollWrapper: HTMLElement): () => void {
  let isDown = false;
  let startX: number;
  let scrollLeft: number;

  const onMouseDown = (e: MouseEvent) => {
    isDown = true;
    startX = e.pageX - scrollWrapper.offsetLeft;
    scrollLeft = scrollWrapper.scrollLeft;
  };

  const stop = () => {
    isDown = false;
  };

  const onMouseMove = (e: MouseEvent) => {
    if (!isDown) return;
    const x = e.pageX - scrollWrapper.offsetLeft;
    const walk = (x - startX) * 1.7;
    scrollWrapper.scrollLeft = scrollLeft - walk;
  };

  // The strip only takes the wheel while it can still move that way: at
  // either end the event goes on to the page, which otherwise could not be
  // scrolled with the pointer over a 400px-tall calendar. A trackpad's
  // horizontal swipe is left to the native overflow-x.
  const onWheel = (e: WheelEvent) => {
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.deltaY === 0) return;
    const max = scrollWrapper.scrollWidth - scrollWrapper.clientWidth;
    const canMove =
      (e.deltaY > 0 && scrollWrapper.scrollLeft < max - 1) ||
      (e.deltaY < 0 && scrollWrapper.scrollLeft > 0);
    if (!canMove) return;
    e.preventDefault();
    scrollWrapper.scrollLeft += e.deltaY;
  };

  scrollWrapper.addEventListener("mousedown", onMouseDown);
  scrollWrapper.addEventListener("mouseleave", stop);
  scrollWrapper.addEventListener("mouseup", stop);
  scrollWrapper.addEventListener("mousemove", onMouseMove);
  scrollWrapper.addEventListener("wheel", onWheel, { passive: false });

  return () => {
    scrollWrapper.removeEventListener("mousedown", onMouseDown);
    scrollWrapper.removeEventListener("mouseleave", stop);
    scrollWrapper.removeEventListener("mouseup", stop);
    scrollWrapper.removeEventListener("mousemove", onMouseMove);
    scrollWrapper.removeEventListener("wheel", onWheel);
  };
}
