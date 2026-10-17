# Native overlay mouse policy

`mouse-policy.c` supplies the `WM_MOUSEACTIVATE` policy for Kami's own Electron
windows. It returns `MA_NOACTIVATE` so a click reaches the renderer without
activating the overlay. Native resize-edge hit results (`HTLEFT` through
`HTBOTTOMRIGHT`) become `HTCLIENT`, and `SC_SIZE` is blocked to keep Windows out
of its modal sizing loop. The renderer's custom resize grip still changes window
bounds. Other messages go directly to `DefSubclassProc`. The callback stays in C;
Windows never enters a JavaScript callback through this subclass.

The exported Windows x64 ABI is:

```c
BOOL __stdcall KamiInstallMousePolicy(uintptr_t window);
BOOL __stdcall KamiRemoveMousePolicy(uintptr_t window);
unsigned int __stdcall KamiMousePolicyVersion(void); /* returns 1 */
```

Both functions must be called on the owning window's thread, in its own process.
They reject null, destroyed, foreign-process and foreign-thread windows. A
private address in the DLL is used as the subclass ID. Repeated installation is
idempotent, and removal of an already detached live window succeeds. An invalid
window passed to removal fails; `WM_NCDESTROY` already removes the subclass.

Keep the DLL loaded for the process lifetime. Never unload it while a window
subclass may refer to its code, including during window destruction. There is
no global hook, game-window subclass, mouse capture, injected input, focus
transfer, heap allocation or JavaScript callback in this helper.

Build the x64 DLL with the pinned, checksummed Zig toolchain:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/build-overlay-native.ps1
```

This helper only needs the standard Windows DLL imports. `DllMain` is a trivial
entry point, allowing the build to omit the C runtime.

The host is Electron, whose activation context supplies Common Controls v6.
The subclass exports are unavailable in the legacy Common Controls context of
plain console Node; runtime ABI/loading tests therefore run in Electron.

The script writes `overlay/mouse-policy.win32-x64.dll` and a build metadata JSON
with source/compiler/DLL hashes. The loader checks the DLL hash and ABI. Both
generated files are ignored by Git and included in the portable package; the
compiler is only a build dependency and is not needed by end users.
