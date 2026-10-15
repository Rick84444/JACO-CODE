import React, { useEffect, useState } from 'react';
import { Eye, FileCode2, ExternalLink } from 'lucide-react';
import { cognitiveLink } from '../lib/cognitiveEvents.mjs';
import type { CognitiveEvent } from '../hooks/useCognitiveLive';

export function CognitivePreview({path,content,files,onOpenFile,events}:{path:string|null;content:string|null;files:Array<{path:string}>;onOpenFile:(path:string)=>void;events:CognitiveEvent[]}) {
  const isHtml=Boolean(path&&/\.html?$/i.test(path));
  const [html,setHtml]=useState(content||'');
  useEffect(()=>{const timer=setTimeout(()=>setHtml(content||''),350);return()=>clearTimeout(timer);},[content,path]);
  const links=[...new Set(events.filter(e=>e.evidence.outcome==='verified').map(e=>cognitiveLink(e.evidence.url)).filter(Boolean))] as string[];
  // Opaque-origin sandbox; CSP blocks external resources, fetch and forms.
  const csp='<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; script-src &#39;unsafe-inline&#39;; style-src &#39;unsafe-inline&#39;; img-src data: blob:; font-src data:; connect-src &#39;none&#39;; form-action &#39;none&#39;; base-uri &#39;none&#39;;">';
  return <div className="cognitive-preview">
    {isHtml ? <><div className="cognitive-preview-address"><Eye size={13}/><span>{path}</span><span>Isolerad förhandsvisning</span></div><iframe key={path} title={'Förhandsvisning av '+path} sandbox="allow-scripts" srcDoc={'<!doctype html><html><head>'+csp+'</head><body>'+html+'</body></html>'}/></>
      : <div className="cognitive-preview-start"><Eye size={30}/><h2>Se det som skapas.</h2><p>Öppna en HTML-fil för att förhandsvisa dess aktuella innehåll.</p>
        {files.filter(file=>/\.html?$/i.test(file.path)).slice(0,12).map(file=><button type="button" key={file.path} onClick={()=>onOpenFile(file.path)}><FileCode2 size={15}/><span>{file.path}</span></button>)}
        {links.length>0&&<><div className="cognitive-section-kicker">Verifierade länkar från uppdraget</div>{links.slice(-8).map(url=><a key={url} href={url} target="_blank" rel="noreferrer"><ExternalLink size={14}/>{url}</a>)}</>}
      </div>}
  </div>;
}
