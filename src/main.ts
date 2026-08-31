/**
 * swkbd-leak-repro — minimal reproduction for nx.js (stock runtime):
 * the inline software keyboard's LibraryApplet session is never closed on
 * the runtime's exit path (`swkbdInlineClose` only runs in the V8 wrapper's
 * GC finalizer). hbloader reuses the same process for the next NRO, so a
 * keyboard session that is alive at exit outlives the app: the next launch
 * gets a "zombie" keyboard that reports geometry and emits change events
 * but renders nothing and ignores touch.
 *
 * No sockets, no WASM — canvas UI + navigator.virtualKeyboard only.
 * Controls: X or tap = open keyboard · Minus = clean exit.
 * Note: while the inline applet is open, "+" is consumed by the applet as
 * Decide/submit — it cannot exit the app until the keyboard is closed.
 */
const LOG = "sdmc:/switch/swkbd-leak-repro.log";
const boot = Date.now();
const lines: string[] = [];
function log(line: string) {
  const msg = `${((Date.now() - boot) / 1000).toFixed(2)}s ${line}`;
  try { Switch.appendFileSync(LOG, msg + "\n"); } catch { /* SD unavailable */ }
  lines.push(msg);
  if (lines.length > 20) lines.shift();
}

const ctx = (screen as any).getContext("2d");
const vk: any = (navigator as any).virtualKeyboard;
let vkUp = false, hiddenAt = 0, opens = 0, changes = 0, frames = 0;

function render() {
  const inset = vk?.boundingRect?.height ?? 0;
  ctx.fillStyle = "#0b0f14"; ctx.fillRect(0, 0, screen.width, screen.height);
  ctx.fillStyle = "#4ade80"; ctx.font = '22px "Geist Mono", monospace'; ctx.textBaseline = "top";
  ctx.fillText(`swkbd-leak-repro  opens=${opens} changes=${changes}`, 14, 12);
  ctx.fillStyle = "#94a3b8"; ctx.font = '18px "Geist Mono", monospace';
  ctx.fillText("X/tap: keyboard   Minus: clean exit   (+ with keyboard open = submit, twice = leak exit)", 14, 42);
  ctx.fillStyle = "#e2e8f0";
  lines.forEach((l, i) => ctx.fillText(l.slice(0, 110), 14, 80 + i * 24));
  const by = screen.height - inset - 40;
  ctx.fillStyle = "#10161d"; ctx.fillRect(0, by, screen.width, 40);
  ctx.fillStyle = "#e2e8f0";
  ctx.fillText(vkUp ? `> ${String(vk?.value ?? "")}` : "idle — press X", 14, by + 8);
}

function open() {
  if (!vk || vkUp || Date.now() - hiddenAt < 700) return;
  vk.type = 0; vk.okButtonText = "Send"; vk.maxLength = 200; vk.value = "";
  // Workaround for the SEPARATE cursor bug (sessions after the first submit
  // discard text): reset the cursor before every show. Keeps this repro
  // focused on the applet-leak bug alone.
  try { vk.cursorIndex = 0; } catch { /* older runtime */ }
  vk.show(); vkUp = true; opens++;
  log(`show #${opens} rect h=${vk.boundingRect?.height ?? "?"}`);
}

if (vk) {
  vk.addEventListener("change", () => { changes++; log(`change #${changes} len=${String(vk.value ?? "").length}`); });
  vk.addEventListener("submit", () => { vkUp = false; hiddenAt = Date.now(); log(`submit "${String(vk.value ?? "").slice(0, 40)}"`); });
  vk.addEventListener("cancel", () => { vkUp = false; hiddenAt = Date.now(); log("cancel"); });
  vk.addEventListener("geometrychange", () => {
    const h = vk.boundingRect?.height ?? 0;
    log(`geometry h=${h}`);
    if (h <= 0) { if (vkUp) hiddenAt = Date.now(); vkUp = false; }
  });
} else {
  log("navigator.virtualKeyboard MISSING");
}

let moved = 0, startY = -1, touchWithKb = false;
(screen as any).addEventListener("touchstart", (e: any) => { touchWithKb = vkUp; moved = 0; startY = e.touches?.[0]?.screenY ?? -1; });
(screen as any).addEventListener("touchmove", (e: any) => { const y = e.touches?.[0]?.screenY; if (typeof y === "number" && startY >= 0) moved = Math.max(moved, Math.abs(y - startY)); });
(screen as any).addEventListener("touchend", () => { if (!touchWithKb && moved < 40) open(); });
// NOTE: "+" fires beforeunload even when the exit is then PREVENTED by the
// runtime's own keyboard guard (VirtualKeyboard.show installs a preventExit
// beforeunload listener; the applet consumes the same press as OK/Send). So
// this line alone does not mean the app exited — the run's last line does.
addEventListener("beforeunload", () => { log(`beforeunload (plus) frames=${frames} vkUp=${vkUp}${vkUp ? " — exit prevented by keyboard guard" : " — exiting"}`); });

let last = new Set<number>();
function frame() {
  frames++;
  const gp = (navigator as any).getGamepads?.()?.[0];
  if (gp) {
    const now = new Set<number>();
    for (let i = 0; i < gp.buttons.length; i++) if (gp.buttons[i].pressed) now.add(i);
    for (const i of now) if (!last.has(i)) {
      if (i === 3 /* X */) open();
      if (i === 8 /* Minus */) {
        log("minus -> clean exit");
        if (vkUp) { try { vk.hide(); } catch { /* */ } }
        setTimeout(() => Switch.exit(), 300);
        return;
      }
    }
    last = now;
  }
  render();
  requestAnimationFrame(frame);
}
log(`boot on nx.js ${(Switch as any).version?.nxjs ?? "?"}`);
requestAnimationFrame(frame);
