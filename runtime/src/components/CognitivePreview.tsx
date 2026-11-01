import { useUiLanguage } from '../i18n/UiLanguage';
import React, { useEffect, useMemo, useState } from 'react';
import { Eye, FileCode2, ExternalLink } from 'lucide-react';
import { cognitiveLink } from '../lib/cognitiveEvents.mjs';
import { sanitizeAuraStageHtml } from '../lib/auraSafeHtml.mjs';
import type { CognitiveEvent } from '../hooks/useCognitiveLive';

export function CognitivePreview({path,content,files,onOpenFile,events,strict=false}:{path:string|null;content:string|null;files:Array<{path:string}>;onOpenFile:(path:string)=>void;events:CognitiveEvent[];strict?:boolean}) {
  const { t: uiText } = useUiLanguage();
  const isHtml=Boolean(path&&/\.html?$/i.test(path));
  const [html,setHtml]=useState(content||'');
  const renderedHtml=useMemo(()=>{
    if(!strict)return html;
    try{return sanitizeAuraStageHtml(html);}catch{return '<p>'+uiText('This HTML could not be displayed safely.')+'</p>';}
  },[strict,html]);
  useEffect(()=>{const timer=setTimeout(()=>setHtml(content||''),350);return()=>clearTimeout(timer);},[content,path]);
  const links=[...new Set(events.filter(e=>e.evidence.outcome==='verified').map(e=>cognitiveLink(e.evidence.url)).filter(Boolean))] as string[];
  // Opaque-origin sandbox; CSP blocks external resources, fetch and forms.
  const csp='<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; script-src '+(strict?'&#39;none&#39;':'&#39;unsafe-inline&#39;')+'; style-src &#39;unsafe-inline&#39;; img-src data: blob:; font-src data:; connect-src &#39;none&#39;; form-action &#39;none&#39;; base-uri &#39;none&#39;;">';
  return <div className="cognitive-preview">
    {isHtml ? <><div className="cognitive-preview-address"><Eye size={13}/><span>{path}</span><span>{uiText("Isolated preview")}</span></div><iframe key={path} title={uiText("Preview of ")+path} sandbox={strict?'':'allow-scripts'} srcDoc={'<!doctype html><html><head>'+csp+'</head><body>'+renderedHtml+'</body></html>'}/></>
      : <div className="cognitive-preview-start"><Eye size={30}/><h2>{uiText("See what is being created.")}</h2><p>{uiText("Open an HTML file to preview its current content.")}</p>
        {files.filter(file=>/\.html?$/i.test(file.path)).slice(0,12).map(file=><button type="button" key={file.path} onClick={()=>onOpenFile(file.path)}><FileCode2 size={15}/><span>{file.path}</span></button>)}
        {links.length>0&&<><div className="cognitive-section-kicker">{uiText("Verified links from the task")}</div>{links.slice(-8).map(url=><a key={url} href={url} target="_blank" rel="noreferrer"><ExternalLink size={14}/>{url}</a>)}</>}
      </div>}
  </div>;
}
