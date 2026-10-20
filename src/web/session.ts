/**
 * Pure hulpfuncties voor het afhandelen van een verlopen sessie (geen React, geen window): zo zijn ze te testen.
 * De server heeft een eigen sessie (8 uur inactiviteit, 12 uur absoluut) los van de Microsoft-sessie; een tabblad
 * dat lang openstaat merkt dat pas bij de volgende API-aanroep (401).
 */

/** Alleen paden binnen de app (zelfde regels als `safeReturnTo` op de server) en nooit de loginpagina zelf. */
export function safeReturn(
  base: string,
  value: string | null | undefined,
  fallback = `${base}/dashboard`,
): string {
  if (typeof value !== 'string') return fallback;
  if (!value.startsWith(`${base}/`) || value.startsWith('//') || value.includes('\\'))
    return fallback;
  const login = `${base}/login`;
  if (value === login || value.startsWith(`${login}?`) || value.startsWith(`${login}/`))
    return fallback;
  return value;
}

/** De inlogpagina met een melding en de terugkeerpagina (het pad waar de gebruiker was). */
export function loginPageUrl(base: string, currentPath: string): string {
  return `${base}/login?expired=1&returnTo=${encodeURIComponent(safeReturn(base, currentPath))}`;
}
