// Health clocks are transport metadata, not immutable image identity. Every
// other field (including unknown future provenance fields) remains bound.
export function writerHealthIdentity(value,component){
 if(component==='frontend')return value;
 if(!value||Array.isArray(value)||value.status!=='ok'||(value.timestamp!==undefined&&!Number.isSafeInteger(value.timestamp)))throw Error('Invalid healthy image identity envelope');
 const {status,timestamp,...identity}=value;return identity;
}
export const historyWriterPolicy=Object.freeze({compactReceipts:false,imageJobs:false,frozenCatalogs:false});
