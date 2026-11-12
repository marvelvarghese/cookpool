/**
 * The sign-in pages, `/login` and its pages (Can't sign in?): Cookpool's own,
 * not the admin console's (cookpool-revamp RV-18). The root providers force
 * the admin theme light there, so <html> never carries its `dark` class.
 */
export function isSignInPath(pathname: string | null): boolean {
  return pathname === "/login" || (pathname?.startsWith("/login/") ?? false);
}
