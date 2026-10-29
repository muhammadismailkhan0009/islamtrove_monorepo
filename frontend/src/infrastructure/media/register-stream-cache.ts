/** Registration never blocks application startup or the first Play click.
 * Service workers require HTTPS (localhost is treated as secure).
 * When unsupported, the same-origin range endpoint still streams normally. */
export function registerPersistentAudioCache(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator) ||
      !globalThis.isSecureContext) return;
  void navigator.serviceWorker.register('/stream-cache-sw.js', { scope: '/' })
    .then(() => navigator.serviceWorker.ready)
    .catch(error => console.warn('Persistent audio cache unavailable; streaming remains enabled.', error));
}
