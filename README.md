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

**Actual (bug), two escalation levels — both device-verified:**

1. *Process-local zombie:* the log shows `show #1 rect h=400`,
   `geometry h=400` and `change len=0` handshake events, but no keyboard is
   rendered and touch is ignored; a USB keyboard still delivers text into
   the invisible session. Every later nx.js app in the same hbloader
   process inherits it.
2. *System applet crash:* a `show()` on the leaked session can crash the
   **system `swkbd` LibraryApplet itself** — Atmosphère crash report per
   attempt: `2001-0132`, `User Break` in process `swkbd`, always at the
   same module offset (`+0x196c2c`); the log then shows `geometry h=400`
   with **zero** `change` events. From that point every keyboard on the
   console is dead — hbmenu relaunch does NOT recover it; only a reboot
   does. (Killing the app from HOME with the keyboard attached triggers the
   same state.)

Nothing a later app does can heal either state: the leaked session was
never `swkbdInlineClose`d, and `hide()` cannot reach it.

**The leak is unconditional** (device-verified control, fresh boot): open
the keyboard, type, close it normally with **Send**, exit cleanly with
**Minus** — the next launch is still a zombie. The source explains why no
exit discipline can help:

- the `navigator.virtualKeyboard` getter creates the native keyboard on
  **first property access**;
- `nx_swkbd_create` immediately calls `swkbdInlineCreate` **and
  `swkbdInlineLaunchForLibraryApplet`** — the applet session is live from
  that moment, shown or not, for the whole app lifetime;
- `swkbdInlineClose` only ever runs in the V8 wrapper's GC finalizer,
  which the exit path never reaches.

So any app that merely *reads* `navigator.virtualKeyboard` (this repro
does, at boot) carries a live applet session to its death, and the next
NRO in the reused hbloader process inherits the corpse.

**A/B proof (device-verified)**: `swkbd-leak-repro-fixed.nro` is the
identical app packed against a runtime whose `main()` teardown runs
`swkbdInlineDisappear` + `swkbdInlineUpdate` + `swkbdInlineClose`
(`nx_swkbd_teardown()`). Same protocol, same console, same session: the
stock build zombies on every relaunch; the fixed build types on every
relaunch, with `[swkbd] inline applet closed at teardown` logged at each
exit. One runtime hook is the entire difference.

(Aside on `+`: while the keyboard is open, one `+` press is consumed by
the applet as OK/Send AND dispatches the runtime's `beforeunload` — whose
default exit the runtime's own keyboard guard then prevents. No teardown
runs on that press; it is not the cause. It does mean the exit combo needs
two presses while the keyboard is up.)

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
