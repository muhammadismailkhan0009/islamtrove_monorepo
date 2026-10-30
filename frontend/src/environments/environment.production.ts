/** Production uses the same-origin /api/* path via frontend Nginx. No separate API domain or public backend port. */
export const DC_ADAPTER_MODE: 'mock' | 'production' = 'production';
