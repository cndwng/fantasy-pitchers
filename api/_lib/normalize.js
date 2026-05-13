const COMBINING_MARKS = /[̀-ͯ]/g;

export function normalizeName(name) {
  if (!name) return '';
  return name
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}
