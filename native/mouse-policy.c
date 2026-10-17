/*
 * Mouse activation policy for Kami's own Electron windows.
 *
 * Keep the Windows subclass procedure entirely native: a window procedure
 * can run while JavaScript/V8 cannot be entered (including native resize and
 * move loops). This DLL never calls JavaScript, hooks another process, changes
 * foreground focus, captures the mouse, or synthesizes input.
 */
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0601
#endif
#include <windows.h>
#include <commctrl.h>
#include <stdint.h>

/*
 * An address belonging to this loaded module avoids colliding with a subclass
 * ID chosen by Chromium or another component of the same process. The module
 * must remain loaded until process exit, including after explicit removal.
 */
static const unsigned char kami_mouse_policy_id = 0;

static BOOL kami_owns_window_on_this_thread(HWND window)
{
    DWORD process_id = 0;
    DWORD thread_id;

    if (window == NULL || !IsWindow(window)) {
        SetLastError(ERROR_INVALID_WINDOW_HANDLE);
        return FALSE;
    }
    thread_id = GetWindowThreadProcessId(window, &process_id);
    if (thread_id == 0) {
        SetLastError(ERROR_INVALID_WINDOW_HANDLE);
        return FALSE;
    }
    if (process_id != GetCurrentProcessId()) {
        SetLastError(ERROR_ACCESS_DENIED);
        return FALSE;
    }
    if (thread_id != GetCurrentThreadId()) {
        SetLastError(ERROR_INVALID_THREAD_ID);
        return FALSE;
    }
    return TRUE;
}

static LRESULT CALLBACK kami_mouse_policy_proc(
    HWND window, UINT message, WPARAM wparam, LPARAM lparam,
    UINT_PTR subclass_id, DWORD_PTR reference_data)
{
    (void)reference_data;

    if (message == WM_MOUSEACTIVATE) {
        /* Keep the window unfocused, but let Chromium receive this click. */
        return MA_NOACTIVATE;
    }
    if (message == WM_NCHITTEST) {
        LRESULT hit = DefSubclassProc(window, message, wparam, lparam);

        /* Electron's frameless edge hit tests can still advertise native
         * resizing. The renderer's own resize grip uses setBounds instead. */
        if (hit >= HTLEFT && hit <= HTBOTTOMRIGHT) {
            return HTCLIENT;
        }
        return hit;
    }
    if (message == WM_SYSCOMMAND && (wparam & 0xfff0u) == SC_SIZE) {
        /* Never enter Windows' modal sizing loop for these overlays. */
        return 0;
    }
    if (message == WM_NCDESTROY) {
        /* Detach only our own subclass; do not touch any other component. */
        RemoveWindowSubclass(window, kami_mouse_policy_proc, subclass_id);
    }
    return DefSubclassProc(window, message, wparam, lparam);
}

__declspec(dllexport) BOOL WINAPI KamiInstallMousePolicy(uintptr_t window_value)
{
    HWND window = (HWND)window_value;
    BOOL installed;

    if (!kami_owns_window_on_this_thread(window)) {
        return FALSE;
    }
    SetLastError(ERROR_SUCCESS);
    installed = SetWindowSubclass(
        window, kami_mouse_policy_proc,
        (UINT_PTR)&kami_mouse_policy_id, 0);
    if (!installed && GetLastError() == ERROR_SUCCESS) {
        SetLastError(ERROR_GEN_FAILURE);
    }
    return installed;
}

__declspec(dllexport) BOOL WINAPI KamiRemoveMousePolicy(uintptr_t window_value)
{
    HWND window = (HWND)window_value;
    DWORD_PTR reference_data = 0;
    BOOL removed;

    if (!kami_owns_window_on_this_thread(window)) {
        return FALSE;
    }
    /* Repeated cleanup is harmless, including after an explicit detach. */
    if (!GetWindowSubclass(window, kami_mouse_policy_proc,
                           (UINT_PTR)&kami_mouse_policy_id, &reference_data)) {
        SetLastError(ERROR_SUCCESS);
        return TRUE;
    }
    SetLastError(ERROR_SUCCESS);
    removed = RemoveWindowSubclass(
        window, kami_mouse_policy_proc, (UINT_PTR)&kami_mouse_policy_id);
    if (!removed && GetLastError() == ERROR_SUCCESS) {
        SetLastError(ERROR_GEN_FAILURE);
    }
    return removed;
}

__declspec(dllexport) unsigned int WINAPI KamiMousePolicyVersion(void)
{
    return 1;
}

/* No CRT, heap allocation, managed callbacks, or loader-time initialization. */
BOOL WINAPI DllMain(HINSTANCE instance, DWORD reason, LPVOID reserved)
{
    (void)instance;
    (void)reason;
    (void)reserved;
    return TRUE;
}
