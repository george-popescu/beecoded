// Shared lexical eligibility, independent of parser support and result limits.
export function isTestSourcePath(filePath) {
  if (!/\.(?:[cm]?[jt]sx?|php|py|rb|go|rs|java|kt|swift|cs)$/i.test(filePath)) return false;
  return /(?:^|\/)(?:__tests__|tests?|specs?)(?:\/|$)/i.test(filePath)
    || /\.(?:test|spec)\.[^.]+$/i.test(filePath)
    || /(?:Test\.php|_test\.(?:go|py)|test_[^/]+\.py)$/i.test(filePath);
}
