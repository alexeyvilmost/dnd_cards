// Self-contained: this exact function is sent to Node over authenticated SSH,
// before any transferred source is executed. Tests execute the same parser.
export function unpackControlArchive(root,expected,commit){
  const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
  if(!/^sha256:[a-f0-9]{64}$/.test(expected)||!/^[a-f0-9]{40}$/.test(commit))throw Error('Invalid archive identity');
  if(fs.realpathSync(root)!==path.resolve(root)||fs.lstatSync(root).isSymbolicLink())throw Error('Unsafe attempt root');
  const archive=path.join(root,'control.tar'),size=fs.statSync(archive).size;
  if(size>2*1024**3||size%512)throw Error('Archive size bound');
  const fd=fs.openSync(archive,'r');
  const read=(offset,length)=>{const b=Buffer.alloc(length);if(fs.readSync(fd,b,0,length,offset)!==length)throw Error('Truncated archive');return b;};
  const number=field=>{const s=field.toString('ascii').replace(/\0.*$/,'').trim();if(!/^[0-7]+$/.test(s))throw Error('Invalid tar number');const n=parseInt(s,8);if(!Number.isSafeInteger(n))throw Error('Tar number bound');return n;};
  const utf8=buffer=>{const value=buffer.toString('utf8');if(!Buffer.from(value).equals(buffer))throw Error('Invalid tar UTF8');return value;};
  const name=buffer=>utf8(buffer.subarray(0,buffer.indexOf(0)<0?buffer.length:buffer.indexOf(0)));
  const pax=buffer=>{const fields={};for(let offset=0;offset<buffer.length;){const space=buffer.indexOf(32,offset);if(space<0)throw Error('Invalid PAX record');const raw=buffer.subarray(offset,space).toString('ascii');if(!/^[1-9]\d*$/.test(raw))throw Error('Invalid PAX size');const length=Number(raw),end=offset+length;if(end>buffer.length||end<=space+2||buffer[end-1]!==10)throw Error('Invalid PAX boundary');const record=utf8(buffer.subarray(space+1,end-1)),equal=record.indexOf('=');if(equal<1)throw Error('Invalid PAX key');const key=record.slice(0,equal);if(Object.hasOwn(fields,key))throw Error('Duplicate PAX key');fields[key]=record.slice(equal+1);offset=end;}return fields;};
  const validName=value=>value&&value.length<=4096&&!value.startsWith('/')&&!/[\\\x00-\x1f\x7f]/.test(value)&&!value.split('/').some(part=>['','.','..'].includes(part))&&!/^[A-Za-z]:/.test(value);
  const entries=[],seen=new Set();let offset=0,global=null,pending=null,total=0,ended=false;
  try{
    const digest=crypto.createHash('sha256');for(let pos=0;pos<size;pos+=65536)digest.update(read(pos,Math.min(65536,size-pos)));
    if('sha256:'+digest.digest('hex')!==expected)throw Error('Archive hash mismatch');
    while(offset<size){
      const header=read(offset,512);
      if(header.every(value=>value===0)){if(size-offset<1024)throw Error('Truncated tar end');for(let pos=offset;pos<size;pos+=65536)if(!read(pos,Math.min(65536,size-pos)).every(value=>value===0))throw Error('Trailing tar data');ended=true;break;}
      let check=0;for(let i=0;i<512;i++)check+=i>=148&&i<156?32:header[i];if(number(header.subarray(148,156))!==check)throw Error('Invalid tar checksum');
      const bytes=number(header.subarray(124,136)),type=String.fromCharCode(header[156]||48),body=offset+512;
      if(bytes>256*1024**2||body+bytes>size)throw Error('Tar entry bound');offset=body+Math.ceil(bytes/512)*512;
      if(type==='g'||type==='x'){
        if(bytes>1024*1024)throw Error('PAX bytes bound');const fields=pax(read(body,bytes));
        if(type==='g'){if(global||entries.length||pending||Object.keys(fields).some(key=>key!=='comment')||fields.comment!==commit)throw Error('Archive commit mismatch');global=fields;}
        else{if(pending||Object.keys(fields).some(key=>!['path','mtime','atime','ctime','size'].includes(key)))throw Error('Unsupported PAX metadata');pending=fields;}
        continue;
      }
      if(!['0','5'].includes(type))throw Error('Links/devices are forbidden in control archive');
      const prefix=name(header.subarray(345,500)),base=name(header.subarray(0,100));
      const resolved=(pending?.path??(prefix?prefix+'/'+base:base)).replace(/\/$/,'');
      if(pending?.size!==undefined&&String(bytes)!==pending.size)throw Error('PAX size differs');pending=null;
      if(!validName(resolved)||seen.has(resolved)||type==='5'&&bytes!==0)throw Error('Unsafe or duplicate archive path');
      seen.add(resolved);total+=bytes;if(total>2*1024**3||entries.length>=80000)throw Error('Archive contents bound');
      entries.push({name:resolved,bytes,offset:body,directory:type==='5',mode:number(header.subarray(100,108))});
    }
    if(!ended||!global||pending)throw Error('Incomplete git archive');
    const target=path.join(root,'control');fs.mkdirSync(target,{mode:0o700});
    for(const entry of entries){const destination=path.join(target,entry.name);if(entry.directory){fs.mkdirSync(destination,{mode:0o700,recursive:true});continue;}
      fs.mkdirSync(path.dirname(destination),{mode:0o700,recursive:true});const out=fs.openSync(destination,'wx',entry.mode&0o111?0o700:0o600);
      try{for(let pos=0;pos<entry.bytes;pos+=65536){const buffer=read(entry.offset+pos,Math.min(65536,entry.bytes-pos));let written=0;while(written<buffer.length)written+=fs.writeSync(out,buffer,written,buffer.length-written);}}finally{fs.closeSync(out);}
    }
    return {status:'unpacked',commit,files:entries.filter(entry=>!entry.directory).length};
  }finally{fs.closeSync(fd);}
}
