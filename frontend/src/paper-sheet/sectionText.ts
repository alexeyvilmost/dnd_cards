import { paperIdentityEntries } from './identity';
import { calculateSheet, type PaperSheetDocument, type SheetCalculation } from './model';
import { paperEntityToken } from './references';

/** Export the same generated entries shown on the sheet, followed by user-owned text. */
export function paperSectionText(doc: PaperSheetDocument, key: string, calculations: SheetCalculation = calculateSheet(doc)): string {
  const generated = key === 'features' || key === 'traits' ? paperIdentityEntries(doc, key, calculations).map(paperEntityToken) : [];
  return [...generated, doc.sections[key]?.text ?? ''].filter(Boolean).join('\n');
}
