import React, { useRef, useState } from 'react';
import { Paperclip, FolderPlus, X, Loader2 } from 'lucide-react';
import { readAuraResponse } from '../lib/auraApi.mjs';
import { useOptionalUiLanguage } from '../i18n/UiLanguage';
type Item={id:string;files:Array<{path:string;format:string}>};
export function AttachmentPicker({items,onChange,onBusy,disabled}:{items:Item[];onChange:(items:Item[])=>void;onBusy:(busy:boolean)=>void;disabled:boolean}) {
  const {tr}=useOptionalUiLanguage();
  const fileRef=useRef<HTMLInputElement>(null),folderRef=useRef<HTMLInputElement>(null);
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const upload=async(list:FileList|null)=>{
    if(!list?.length||busy)return;
    setBusy(true);onBusy(true);setNotice('');
    const uploaded:Item[]=[];
    try {
      const all=Array.from(list),files=all.filter(f=>!/(^|\/)(\.git|\.env(?:\.[^/]*)?|\.jaco|node_modules|dist|credentials?|secrets?)(\/|$|\.)/i.test(f.webkitRelativePath||f.name));
      if(!files.length)throw Error('No permitted files were selected.');
      if(files.some(f=>f.size>6000000))throw Error(tr('En fil är större än 6 MB. Välj en mindre fil.','A file is larger than 6 MB. Choose a smaller file.'));
      const chunks:File[][]=[];let current:File[]=[],bytes=0;
      for(const file of files){if(current.length&&(current.length>=200||bytes+file.size>6000000)){chunks.push(current);current=[];bytes=0;}current.push(file);bytes+=file.size;}
      if(current.length)chunks.push(current);
      if(items.length+chunks.length>16)throw Error(tr('Mappen är för stor för ett meddelande. Välj en undermapp (högst 16 grupper om 200 filer eller 6 MB per grupp).','The folder is too large for one message. Choose a subfolder (at most 16 groups of 200 files or 6 MB per group).'));
      for(const [index,chunk] of chunks.entries()) {
        setNotice(`Saving group ${index+1} of ${chunks.length}…`);
        const payload=await Promise.all(chunk.map(file=>new Promise<{path:string;base64:string}>((resolve,reject)=>{
          const reader=new FileReader();reader.onerror=()=>reject(Error('The file could not be read: '+file.name));
          reader.onload=()=>resolve({path:file.webkitRelativePath||file.name,base64:String(reader.result).split(',')[1]||''});reader.readAsDataURL(file);
        })));
        const data=await fetch('/api/aura/workbench/attachments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({files:payload})}).then(readAuraResponse);
        uploaded.push(data.attachment);onChange([...items,...uploaded]);
      }
      setNotice(`${files.length} files saved as copies.${all.length!==files.length?` ${all.length-files.length} system, build or secret files were excluded.`:''}`);
    }catch(error:any){setNotice((uploaded.length?tr(`${uploaded.length} grupper sparades. Resten kunde inte bifogas: `,`${uploaded.length} groups saved. The rest could not be attached: `):'')+error.message);}finally{setBusy(false);onBusy(false);if(fileRef.current)fileRef.current.value='';if(folderRef.current)folderRef.current.value='';}
  };
  return <section className="cognitive-attachments" aria-label={tr('Bilagor','Attachments')}>
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" disabled={disabled||busy} onClick={()=>fileRef.current?.click()}><Paperclip size={14}/>{tr('Bifoga filer','Attach files')}</button>
      <button type="button" disabled={disabled||busy} onClick={()=>folderRef.current?.click()}><FolderPlus size={14}/>{tr('Bifoga mapp','Attach folder')}</button>
      {busy&&<span role="status"><Loader2 size={14} className="animate-spin"/>{tr('Sparar filer…','Saving files…')}</span>}
    </div>
    <input ref={fileRef} type="file" multiple hidden onChange={e=>void upload(e.target.files)}/>
    <input ref={folderRef} type="file" multiple hidden {...{webkitdirectory:''}} onChange={e=>void upload(e.target.files)}/>
    {items.map(item=><div key={item.id} className="flex items-center gap-2"><details><summary>{item.files.length} {tr('filer','files')} · {item.files[0]?.path.split('/')[0]}</summary><ul>{item.files.map(file=><li key={file.path}>{file.path}{file.format==='binary'?tr(' · sparad, text kan inte läsas ut',' · stored, text extraction unavailable'):''}</li>)}</ul></details><button type="button" disabled={disabled||busy} aria-label="Remove attachment from the message" onClick={()=>onChange(items.filter(i=>i.id!==item.id))}><X size={14}/></button></div>)}
    {notice&&<p role="status">{notice}</p>}
    {!!items.length&&<p>{tr('Textfiler kan läsas av agenten. Uppladdningen ger tillgång till kopior; originalen ändras inte.','Text files can be read by the agent. Uploading gives access to the copies; the originals are not changed.')}</p>}
  </section>;
}
