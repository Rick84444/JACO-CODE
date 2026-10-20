import React, { useRef, useState } from 'react';
import { Paperclip, FolderPlus, X, Loader2 } from 'lucide-react';
import { readAuraResponse } from '../lib/auraApi.mjs';
type Item={id:string;files:Array<{path:string;format:string}>};
export function AttachmentPicker({items,onChange,onBusy,disabled}:{items:Item[];onChange:(items:Item[])=>void;onBusy:(busy:boolean)=>void;disabled:boolean}) {
  const fileRef=useRef<HTMLInputElement>(null),folderRef=useRef<HTMLInputElement>(null);
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const upload=async(list:FileList|null)=>{
    if(!list?.length||busy)return;
    setBusy(true);onBusy(true);setNotice('');
    const uploaded:Item[]=[];
    try {
      const all=Array.from(list),files=all.filter(f=>!/(^|\/)(\.git|\.env(?:\.[^/]*)?|\.jaco|node_modules|dist|credentials?|secrets?)(\/|$|\.)/i.test(f.webkitRelativePath||f.name));
      if(!files.length)throw Error('Inga tillåtna filer valdes.');
      if(files.some(f=>f.size>6000000))throw Error('En fil är större än 6 MB. Välj en mindre fil.');
      const chunks:File[][]=[];let current:File[]=[],bytes=0;
      for(const file of files){if(current.length&&(current.length>=200||bytes+file.size>6000000)){chunks.push(current);current=[];bytes=0;}current.push(file);bytes+=file.size;}
      if(current.length)chunks.push(current);
      if(items.length+chunks.length>16)throw Error('Mappen är för stor för ett meddelande. Välj en undermapp (högst 16 grupper med 200 filer eller 6 MB per grupp).');
      for(const [index,chunk] of chunks.entries()) {
        setNotice(`Sparar grupp ${index+1} av ${chunks.length}…`);
        const payload=await Promise.all(chunk.map(file=>new Promise<{path:string;base64:string}>((resolve,reject)=>{
          const reader=new FileReader();reader.onerror=()=>reject(Error('Filen kunde inte läsas: '+file.name));
          reader.onload=()=>resolve({path:file.webkitRelativePath||file.name,base64:String(reader.result).split(',')[1]||''});reader.readAsDataURL(file);
        })));
        const data=await fetch('/api/aura/workbench/attachments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({files:payload})}).then(readAuraResponse);
        uploaded.push(data.attachment);onChange([...items,...uploaded]);
      }
      setNotice(`${files.length} filer sparade som kopior.${all.length!==files.length?` ${all.length-files.length} system-, bygg- eller hemlighetsfiler uteslöts.`:''}`);
    }catch(error:any){setNotice((uploaded.length?`${uploaded.length} grupper sparade. Resten kunde inte bifogas: `:'')+error.message);}finally{setBusy(false);onBusy(false);if(fileRef.current)fileRef.current.value='';if(folderRef.current)folderRef.current.value='';}
  };
  return <section className="cognitive-attachments" aria-label="Bilagor">
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" disabled={disabled||busy} onClick={()=>fileRef.current?.click()}><Paperclip size={14}/>Bifoga filer</button>
      <button type="button" disabled={disabled||busy} onClick={()=>folderRef.current?.click()}><FolderPlus size={14}/>Bifoga mapp</button>
      {busy&&<span role="status"><Loader2 size={14} className="animate-spin"/>Sparar filer…</span>}
    </div>
    <input ref={fileRef} type="file" multiple hidden onChange={e=>void upload(e.target.files)}/>
    <input ref={folderRef} type="file" multiple hidden {...{webkitdirectory:''}} onChange={e=>void upload(e.target.files)}/>
    {items.map(item=><div key={item.id} className="flex items-center gap-2"><details><summary>{item.files.length} filer · {item.files[0]?.path.split('/')[0]}</summary><ul>{item.files.map(file=><li key={file.path}>{file.path}{file.format==='binary'?' · lagrad, texttolkning saknas':''}</li>)}</ul></details><button type="button" disabled={disabled||busy} aria-label="Ta bort bilaga från meddelandet" onClick={()=>onChange(items.filter(i=>i.id!==item.id))}><X size={14}/></button></div>)}
    {notice&&<p role="status">{notice}</p>}
    {!!items.length&&<p>Textfiler kan läsas av agenten. Uppladdning ger tillgång till kopiorna; originalen ändras inte.</p>}
  </section>;
}
