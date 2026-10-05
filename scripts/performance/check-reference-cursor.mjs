import path from 'node:path';
import {localAcceptanceContext} from '../testing/acceptance-context.mjs';
import {checkReferenceCursorTransport} from '../testing/reference-cursor-contract.mjs';

export async function checkReferenceCursor(stack){
 const context=await localAcceptanceContext(stack.env),directory=path.join(context.registry.directory,'reference-cursor-transport');
 const report=await checkReferenceCursorTransport(directory);
 return {status:report.status,checks:report.checks,cleanup:report.cleanup,productionData:false,report:path.join(directory,'report.json')};
}
