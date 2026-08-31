# swkbd-leak-repro

Minimal on-device reproduction for an [nx.js](https://github.com/TooTallNate/nx.js)
bug: **the inline software keyboard's LibraryApplet session is never closed
on the runtime's exit path.** `swkbdInlineClose` is only called from the V8
wrapper's GC finalizer, which does not run on exit (`+`, `Switch.exit()`,
applet exit request). hbloader reuses the process for the next NRO, so the
leaked applet session outlives the app — the next nx.js launch gets a
"zombie" keyboard: it reports geometry and emits `change` events, but
renders nothing and ignores touch.

Stock runtime, no fork patches: this NRO embeds the released
`nxjs.nro` from nx.js **v1.0.0-beta.6** (the app bundle is plain canvas +
`navigator.virtualKeyboard`; ~100 lines, no sockets, no WASM).

## Repro (2 minutes)

Console: Atmosphère + hbmenu (tested: Atmosphère 1.11.2, firmware 21.1).

1. hbmenu → `swkbd-leak-repro`. Press **X** — the keyboard renders. Type a
   few characters (`change #N len=1,2,3…` lines appear).
2. Press **+** once. It is **consumed by the open applet** as Decide/submit
   (`submit` is logged, the keyboard closes, the app keeps running). This is
   symptom #1: the exit combo is masked while the applet is open.
3. Press **+** again — the app exits. The inline session from step 1 was
   never `swkbdInlineClose`d.
4. hbmenu → `swkbd-leak-repro` again (same hbloader process). Press **X**.

**Expected:** keyboard renders, typing works.

**Actual (bug):** the log shows `show #1 rect h=400`, `geometry h=400` and
two `change len=0` handshake events — but **no keyboard is rendered and
touch is ignored**. A USB keyboard still delivers text into the invisible
session. Every later nx.js app in this hbloader process gets the same
zombie, and — device-verified — exiting one of those later apps cleanly
(**Minus**, which calls `hide()` and settles before `Switch.exit()`) does
NOT heal the process: the leaked session was never `swkbdInlineClose`d and
nothing in a later app can close it. Recovery requires relaunching hbmenu
(fresh process).

Control (run from a FRESH hbmenu process, before any leak): X → type →
close the keyboard (Send) → exit with **Minus** → relaunch → X. Whether
this stays healthy tells whether the leak needs a session alive at exit or
merely one ever created; the close-only-in-finalizer root cause predicts
even this control may eventually zombie. Record the result.

A harsher variant — killing the app from HOME with the keyboard attached —
has left the system `swkbd` applet itself crashed (`2001-0132`) until
reboot.

Log: `sdmc:/switch/swkbd-leak-repro.log` (every keyboard event, plus
`keyboard open at exit (LEAK)` when an exit leaks the session).

## Proposed fix

Track the live keyboard in `source/software-keyboard.cc` and, in `main()`
teardown before service exits, run `swkbdInlineDisappear` +
`swkbdInlineUpdate` + `swkbdInlineClose` (a `nx_swkbd_teardown()` hook).

Note: `vk.cursorIndex = 0` before `show()` in this app works around a
separate swkbd bug (sessions after the first submit discard text) so the
leak can be observed in isolation.

## Build

```sh
bun run build            # esbuild src/main.ts -> romfs/main.js
# pack a self-contained NRO against the released stock runtime:
#   put the release nxjs.nro next to the nx.js `nro` builder and run it
#   with --fat, or install the runtime on SD and pack slim.
```
