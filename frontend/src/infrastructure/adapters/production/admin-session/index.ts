/** Shared short-lived administrator credentials for review and grouping writes.
 * The session cookie is HttpOnly; only the CSRF token is held in memory.
 */
let csrfToken: string | null = null;

export function getAdminCsrfToken(): string | null { return csrfToken; }
export function clearAdminCsrfToken(): void { csrfToken = null; }

export async function authenticateAdmin(code: string): Promise<{
  authorized: boolean;
  message?: string;
}> {
  try {
    const response = await fetch('/api/admin/verify', {
      method:'POST', credentials:'same-origin', cache:'no-store',
      headers:{'Content-Type':'application/json'}, body:JSON.stringify({code})
    });
    if (!response.ok) {
      let message = `Administrator authentication failed (${response.status})`;
      try {
        const detail = await response.json() as {detail?: string};
        if (typeof detail.detail === 'string') message = detail.detail;
      } catch { /* Keep HTTP status. */ }
      throw new Error(message);
    }
    const data = await response.json() as {authorized:boolean; csrfToken:string};
    csrfToken = data.authorized && data.csrfToken ? data.csrfToken : null;
    return {authorized:!!csrfToken};
  } catch (error) {
    csrfToken = null;
    return {authorized:false,
      message:error instanceof Error ? error.message : 'Administrator authentication unavailable'};
  }
}
