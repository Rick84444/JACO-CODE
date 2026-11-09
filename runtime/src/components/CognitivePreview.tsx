import React, { useEffect, useMemo, useState } from 'react';
import { Eye, FileCode2, ExternalLink } from 'lucide-react';
import { cognitiveLink } from '../lib/cognitiveEvents.mjs';
import { sanitizeAuraStageHtml } from '../lib/auraSafeHtml.mjs';
import type { CognitiveEvent } from '../hooks/useCognitiveLive';

// Resolves a stylesheet link from an HTML file in the project. A root-relative link ("/style.css") is read
// against the HTML file's own folder, which is where a static site is served from.
export function projectStylePath(htmlPath:string,href:string):string|null{
  if(/^[a-z][a-z0-9+.-]*:|^\/\//i.test(href))return null;
  const clean=href.split(/[?#]/)[0];
  if(!/\.css$/i.test(clean))return null;
  const parts=htmlPath.split('/').slice(0,-1);
  for(const piece of clean.replace(/^\/+/,'').split('/')){
    if(piece==='..'){if(!parts.length)return null;parts.pop();}
    else if(piece&&piece!=='.')parts.push(piece);
  }
  return parts.join('/');
}
async function inlineProjectStyles(html:string,path:string|null):Promise<string>{
  if(!path||!/\.html?$/i.test(path))return html;
  const links=[...html.matchAll(/<link\b[^>]*>/gi)].map(m=>m[0]).filter(tag=>/rel\s*=\s*["']?stylesheet/i.test(tag)).slice(0,8);
  let out=html;
  for(const tag of links){
    const href=/href\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    const file=href&&projectStylePath(path,href);
    if(!file)continue;
    try{
      const data=await fetch('/api/aura/workbench/file?path='+encodeURIComponent(file),{cache:'no-store',signal:AbortSignal.timeout(8000)}).then(r=>r.ok?r.json():null);
      if(typeof data?.content==='string')out=out.replace(tag,'<style>'+data.content.replace(/<\/style/gi,'<\\/style')+'</style>');
    }catch{/* the page is shown without that stylesheet */}
  }
  return out;
}

export function CognitivePreview({path,content,files,onOpenFile,events,strict=false}:{path:string|null;content:string|null;files:Array<{path:string}>;onOpenFile:(path:string)=>void;events:CognitiveEvent[];strict?:boolean}) {
  const isHtml=Boolean(path&&/\.html?$/i.test(path));
  const [html,setHtml]=useState(content||'');
  const renderedHtml=useMemo(()=>{
    if(!strict)return html;
    try{return sanitizeAuraStageHtml(html);}catch{return '<p>This HTML content could not be displayed safely.</p>';}
  },[strict,html]);
  // The preview cannot load files (CSP and sandbox), so the project's own stylesheets are read and put inline.
  useEffect(()=>{let cancelled=false;const timer=setTimeout(()=>{void inlineProjectStyles(content||'',path).then(next=>{if(!cancelled)setHtml(next);});},350);return()=>{cancelled=true;clearTimeout(timer);};},[content,path]);
  const links=[...new Set(events.filter(e=>e.evidence.outcome==='verified').map(e=>cognitiveLink(e.evidence.url)).filter(Boolean))] as string[];
  // Opaque-origin sandbox; CSP blocks external resources, fetch and forms.
  const csp='<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; script-src '+(strict?'&#39;none&#39;':'&#39;unsafe-inline&#39;')+'; style-src &#39;unsafe-inline&#39;; img-src data: blob:; font-src data:; connect-src &#39;none&#39;; form-action &#39;none&#39;; base-uri &#39;none&#39;;">';
  return <div className="cognitive-preview">
    {isHtml ? <><div className="cognitive-preview-address"><Eye size={13}/><span>{path}</span><span>Isolated preview</span></div><iframe key={path} title={'Preview of '+path} sandbox={strict?'':'allow-scripts'} srcDoc={'<!doctype html><html><head>'+csp+'</head><body>'+renderedHtml+'</body></html>'}/></>
      : <div className="cognitive-preview-start"><Eye size={30}/><h2>See what is being created.</h2><p>Open an HTML file to preview its current content.</p>
        {files.filter(file=>/\.html?$/i.test(file.path)).slice(0,12).map(file=><button type="button" key={file.path} onClick={()=>onOpenFile(file.path)}><FileCode2 size={15}/><span>{file.path}</span></button>)}
        {links.length>0&&<><div className="cognitive-section-kicker">Verified links from the mission</div>{links.slice(-8).map(url=><a key={url} href={url} target="_blank" rel="noreferrer"><ExternalLink size={14}/>{url}</a>)}</>}
      </div>}
  </div>;
}
