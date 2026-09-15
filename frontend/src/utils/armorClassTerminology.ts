/** Display-only localization. Certified records, IDs and history are unchanged. */
export function armorClassTerminology(text: string): string {
  return text.replace(/(?<![\p{L}\p{N}_])КЗ(?![\p{L}\p{N}_])/gu,'КД')
    .replace(/\bArmor Class\b/g,'КД')
    .replace(/(?<!\p{L})[Кк]ласс(?:а|у|ом|е)? [Зз]ащиты(?!\p{L})/gu,'КД');
}
