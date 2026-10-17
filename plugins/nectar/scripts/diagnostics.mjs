export function redactDiagnostic(value) {
  return String(value ?? '')
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1<redacted>@')
    .replace(/\bauthorization\s*[:=]\s*Bearer\s+[^\s,;]+/gi, 'authorization=<redacted>')
    .replace(
    /\b(password|passwd|(?:access_|refresh_|id_)?token|secret|api[_-]?key|authorization)["']?\s*[:=]\s*(?:"[^"\r\n]*(?:"|$)|'[^'\r\n]*(?:'|$)|[^\s,;]+)/gim,
    '$1=<redacted>',
  );
}
