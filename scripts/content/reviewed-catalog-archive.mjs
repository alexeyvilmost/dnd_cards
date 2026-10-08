import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

/** Guarded content repairs use a protected external archive, never untracked DDL. */
export function archiveReviewedCatalog({archivePath,sourceCommit,backupId,operation,payload}) {
  if (!archivePath||!path.isAbsolute(archivePath)||!/^\w[\w-]*$/.test(operation)
    || !/^[a-f0-9]{40}$/.test(sourceCommit??'')||!backupId||/[\r\n]/.test(backupId)) {
    throw Error('Apply requires an absolute archive path, exact source commit and protected backup ID');
  }
  const directory=fs.statSync(path.dirname(archivePath));
  if (!directory.isDirectory()||(process.platform!=='win32'&&(directory.mode&0o077))) throw Error('Catalog archive directory must be private');
  const payloadHash='sha256:'+createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const record={schemaVersion:1,operation,sourceCommit,backupId,payloadHash,payload};
  const bytes=JSON.stringify(record,null,2)+'\n';
  if(fs.existsSync(archivePath)) {
    if (fs.lstatSync(archivePath).isSymbolicLink()||fs.readFileSync(archivePath,'utf8')!==bytes) throw Error('Catalog archive identity changed');
    if(process.platform!=='win32'&&(fs.statSync(archivePath).mode&0o077))throw Error('Catalog archive must be private');
  } else {
    const fd=fs.openSync(archivePath,'wx',0o600);
    try {fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
  }
  return {sourceCommit,backupId,payloadHash};
}

export function catalogArchiveOptions(argv) {
  const option=name=>{const at=argv.indexOf(name);return at>=0?argv[at+1]:undefined;};
  return {archivePath:option('--archive'),sourceCommit:option('--source-commit'),backupId:option('--backup-id')};
}
