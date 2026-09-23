export type Pane = "rail" | "list";

export const PANES_KEY = "superfer.panes";

// Runs in <head> before first paint so stored widths never flash the defaults.
export const RESTORE_PANES = `try{var p=JSON.parse(localStorage.getItem(${JSON.stringify(PANES_KEY)})||"{}"),s=document.documentElement.style;["rail","list"].forEach(function(k){if(typeof p[k]==="number")s.setProperty("--"+k+"-w",p[k]+"px")})}catch(e){}`;

export function readPanes(): Partial<Record<Pane, number>> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PANES_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as Partial<Record<Pane, number>>) : {};
  } catch {
    return {};
  }
}

export function writePane(pane: Pane, width: number | null) {
  try {
    const panes = readPanes();
    if (width === null) delete panes[pane];
    else panes[pane] = width;
    localStorage.setItem(PANES_KEY, JSON.stringify(panes));
  } catch {
    // Storage blocked: the width still applies for this page view.
  }
}
