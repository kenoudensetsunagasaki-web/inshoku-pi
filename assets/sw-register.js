// Registers the offline service worker. Fails silently on browsers/contexts
// that don't support it (e.g. some in-app webviews) — the app still works,
// it just won't cache for offline use there.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("Service worker registration failed:", err);
    });
  });
}
