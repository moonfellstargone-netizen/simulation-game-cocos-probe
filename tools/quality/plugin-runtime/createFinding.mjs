export function createFinding(severity, code, file, message, extra = {}) {
  return { severity, code, file, message, ...extra };
}

export function addRequiredPhrase(findings, text, phrase, file, code, message = `missing required phrase: ${phrase}`) {
  if (!text.includes(phrase)) {
    findings.push(createFinding('error', code, file, message, { expected: phrase }));
  }
}
