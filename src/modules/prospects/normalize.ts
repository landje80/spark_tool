const LEGAL_SUFFIXES = /\b(b\.?v\.?|n\.?v\.?|v\.?o\.?f\.?|vof|holding|group|groep|nederland|nl)\b/g;

/** Genormaliseerde bedrijfsnaam voor vergelijking: kleine letters, geen diakrieten/leestekens/rechtsvormen. */
export function normalizeCompanyName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' en ')
    .replace(LEGAL_SUFFIXES, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Domein zonder protocol, www, pad en poort. Geeft null bij ongeldige invoer. */
export function normalizeDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const host = url.hostname
      .toLowerCase()
      .replace(/^www\d*\./, '')
      .replace(/\.$/, '');
    return host.includes('.') ? host : null;
  } catch {
    return null;
  }
}

/** Canonieke socialmedia-URL: https, zonder www/query/fragment/trailing slash. */
export function normalizeSocialUrl(input: string): string | null {
  try {
    const url = new URL(input.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase().replace(/^(www|m|nl-nl)\./, '');
    const path = url.pathname.replace(/\/+$/, '').toLowerCase();
    return `https://${host}${path}`;
  } catch {
    return null;
  }
}

/** Telefoonnummer als cijfers, met +31 als 0 aan het begin. Null als er te weinig cijfers zijn. */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  let digits = input.replace(/[^\d+]/g, '');
  if (digits.startsWith('00')) digits = `+${digits.slice(2)}`;
  if (digits.startsWith('0')) digits = `+31${digits.slice(1)}`;
  return digits.replace(/\D/g, '').length >= 9 ? digits : null;
}

export function normalizeCity(city: string | null | undefined): string | null {
  const c = city?.trim().replace(/\s+/g, ' ');
  return c ? c : null;
}
