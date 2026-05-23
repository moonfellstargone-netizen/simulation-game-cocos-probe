import { createFinding } from './createFinding.mjs';

export function scanTextRules({ file, text, rules }) {
  const findings = [];
  for (const phrase of rules.required ?? []) {
    if (!text.includes(phrase)) {
      findings.push(createFinding('error', 'REQUIRED_TEXT_MISSING', file, `missing required phrase: ${phrase}`, { expected: phrase, why: rules.why }));
    }
  }
  for (const phrase of rules.forbiddenCurrent ?? []) {
    if (phrase && text.includes(phrase)) {
      findings.push(createFinding('error', 'FORBIDDEN_CURRENT_TEXT', file, 'current context document contains stale marker', { actual: phrase, why: rules.why }));
    }
  }
  return findings;
}
