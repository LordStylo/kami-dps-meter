import koffi from 'koffi';

// RegisterHotKey and PeekMessage run on the capture worker's same Windows thread.
// No keyboard hook or keystroke recording is used.
export function createCubeHotkeys(onAction) {
  let api, enabled = false, state = { enabled: false, found: false, opened: false, error: null };
  const ids = { found: 0x4b31, opened: 0x4b32 };
  function native() {
    if (api) return api;
    if (process.platform !== 'win32') throw Error('Global kısayollar Windows gerektirir.');
    const lib = koffi.load('user32.dll');
    koffi.struct('CubeHotkeyMessage', { hwnd: 'void *', message: 'uint32', wParam: 'uintptr', lParam: 'intptr',
      time: 'uint32', x: 'int32', y: 'int32', lPrivate: 'uint32' });
    api = {
      register: lib.func('bool __stdcall RegisterHotKey(void *hwnd, int id, uint32 modifiers, uint32 key)'),
      unregister: lib.func('bool __stdcall UnregisterHotKey(void *hwnd, int id)'),
      peek: lib.func('bool __stdcall PeekMessageW(_Out_ CubeHotkeyMessage *msg, void *hwnd, uint32 min, uint32 max, uint32 remove)'),
    };
    return api;
  }
  function disable() {
    if (api) for (const [key, id] of Object.entries(ids)) if (state[key]) api.unregister(null, id);
    enabled = false; state = { enabled: false, found: false, opened: false, error: null };
  }
  return {
    status: () => ({ ...state }),
    setEnabled(value) {
      if (value === enabled) return;
      if (!value) { disable(); return; }
      enabled = true;
      try {
        const a = native(), modifiers = 0x4000 | 0x0002 | 0x0004; // no repeat + Ctrl + Shift
        const found = a.register(null, ids.found, modifiers, 0x77); // F8
        const opened = a.register(null, ids.opened, modifiers, 0x78); // F9
        state = { enabled: true, found, opened, error: found && opened ? null : 'Bir kısayol başka uygulamada kullanımda; aşağıdaki düğmeleri kullan.' };
      } catch (error) { state = { enabled: true, found: false, opened: false, error: error.message }; }
    },
    poll() {
      if (!enabled || !api) return;
      for (let n = 0; n < 20; n++) {
        const msg = {}; if (!api.peek(msg, null, 0x0312, 0x0312, 1)) break;
        for (const [action, id] of Object.entries(ids)) if (Number(msg.wParam) === id && state[action]) onAction(action);
      }
    },
    close: disable,
  };
}
