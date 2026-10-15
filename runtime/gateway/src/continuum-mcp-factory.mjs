import { McpServer } from '@modelcontextprotocol/server';
import { createContinuumToolRegistry } from './continuum-tool-registry.mjs';
function result(v){return {content:[{type:'text',text:JSON.stringify(v,null,2)}],structuredContent:v&&typeof v==='object'&&!Array.isArray(v)?v:{value:v}};}
export function buildContinuumMcpServer({core}){const s=new McpServer({name:'jaco-continuum',version:'0.22.0'},{capabilities:{tools:{listChanged:false}}});for(const t of createContinuumToolRegistry({core}))s.registerTool(t.name,t.config,async a=>{try{return result(await t.handler(a));}catch(e){return {isError:true,content:[{type:'text',text:e instanceof Error?e.message:String(e)}]};}});return s;}
