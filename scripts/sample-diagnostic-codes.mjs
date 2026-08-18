export function diagnosticCodeSet(text) {
  return [...new Set(text.match(/VEL\d+/gu) ?? [])].sort();
}

export function compareDiagnosticCodeSets(quotedOutput, producedDiagnostics) {
  const quoted = diagnosticCodeSet(quotedOutput);
  const produced = diagnosticCodeSet(producedDiagnostics);
  return {
    quoted,
    produced,
    missing: quoted.filter((code) => !produced.includes(code)),
    unexpected: produced.filter((code) => !quoted.includes(code)),
  };
}
