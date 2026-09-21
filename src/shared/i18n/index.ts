import { nl, type Messages } from './nl.js';

// Meertaligheid later: registreer extra talen hier en kies op basis van gebruikersvoorkeur.
const catalogs: Record<string, Messages> = { nl };

export function t(locale = 'nl'): Messages {
  return catalogs[locale] ?? nl;
}
export { nl };
