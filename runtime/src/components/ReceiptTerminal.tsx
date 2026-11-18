import React,{useEffect,useRef,useState} from 'react';
import type { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import {terminalTranscript} from '../lib/terminalTranscript.mjs';
import type {CognitiveEvent} from '../hooks/useCognitiveLive';

const fontFamily='Consolas, "Liberation Mono", monospace';
const fontSize=12;

// Deliberately read-only. Command execution belongs to the existing authorized form.
export function ReceiptTerminal({events}:{events: CognitiveEvent[]}) {
  const host=useRef<HTMLDivElement>(null);
  const latest=useRef('');
  const flush=useRef<()=>void>(()=>{});
  const [ready,setReady]=useState(false);
  const [failed,setFailed]=useState(false);
  const transcript=terminalTranscript(events);
  useEffect(()=>{
    latest.current=transcript;
    flush.current();
  },[transcript]);
  useEffect(()=>{
    let active=true,busy=false,last:string|null=null;
    let terminal:Terminal|undefined;
    let observer:ResizeObserver|undefined;
    let resizeFrame=0;
    const dispose=()=>{
      observer?.disconnect();
      if(resizeFrame)cancelAnimationFrame(resizeFrame);
      terminal?.dispose();
      terminal=undefined;
    };
    const fail=()=>{
      if(!active)return;
      dispose();
      setFailed(true);
      setReady(false);
    };
    const pump=()=>{
      if(!active||!terminal||busy||latest.current===last)return;
      busy=true;
      const text=latest.current;
      try{
        terminal.reset();
        terminal.write(text,()=>{
          busy=false;
          if(!active)return;
          last=text;
          terminal?.scrollToBottom();
          pump();
        });
      }catch{busy=false;fail();}
    };
    flush.current=pump;
    void import('@xterm/xterm').then(({Terminal})=>{
      if(!active||!host.current)return;
      try{
        const element=host.current;
        terminal=new Terminal({disableStdin:true,convertEol:true,cursorBlink:false,scrollback:1500,fontFamily,fontSize,lineHeight:1.2,screenReaderMode:true,theme:{background:'#080d12',foreground:'#d2e4f5'}});
        terminal.open(element);
        // Use public resize API and measured font metrics rather than xterm private internals.
        const context=document.createElement('canvas').getContext('2d');
        if(context)context.font=fontSize+'px '+fontFamily;
        const columnWidth=context?.measureText('M'.repeat(20)).width;
        const fit=()=>{
          resizeFrame=0;
          if(!active||!terminal)return;
          const width=element.clientWidth,height=element.clientHeight;
          if(width<24||height<24)return;
          const cols=Math.max(2,Math.floor((width-18)/((columnWidth||fontSize*12)/20)));
          const rows=Math.max(2,Math.floor(height/Math.ceil(fontSize*1.2)));
          if(terminal.cols!==cols||terminal.rows!==rows)terminal.resize(cols,rows);
        };
        const scheduleFit=()=>{
          if(!resizeFrame)resizeFrame=requestAnimationFrame(fit);
        };
        observer=new ResizeObserver(scheduleFit);
        observer.observe(element);
        scheduleFit();
        setReady(true);
        pump();
      }catch{fail();}
    }).catch(fail);
    return()=>{
      active=false;
      flush.current=()=>{};
      dispose();
    };
  },[]);
  return <div className="cognitive-receipt-terminal" data-testid="receipt-terminal" data-renderer={ready?'xterm':failed?'text-fallback':'loading'}>
    <div ref={host} className="cognitive-receipt-terminal-host" style={{visibility:ready?'visible':'hidden'}} aria-hidden={!ready}/>
    {!ready&&<pre className="cognitive-receipt-terminal-fallback" aria-label="Command receipts">{transcript}</pre>}
    {failed&&<span className="cognitive-receipt-terminal-status" role="status">Terminal renderer unavailable; showing text receipts.</span>}
  </div>;
}
