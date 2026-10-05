import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {startTestStack} from '../testing/stack.mjs';
import {runRequiredGo} from '../testing/required-go.mjs';

export async function checkWorkerAdmission(stack){
  return runRequiredGo(stack,{tests:[
    'TestWorkerAdmissionBoundsSharedClientsBeforeMarshal',
    'TestWorkerAdmissionCancellationAndEveryFailureRelease',
    'TestWorkerAdmissionConfigurationAndIdempotentRelease',
    'TestWorkerAdmissionRollbackAndReceiptRecovery',
  ]});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const stack=await startTestStack({profile:'integration',dbOnly:true});
  try{console.log(JSON.stringify({runId:stack.registry.runId,result:await checkWorkerAdmission(stack)}));}finally{await stack.cleanup();}
}
