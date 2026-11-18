// Public API metadata only. Reuse the DNS-pinned public HTTPS fetcher; never import
// credentials from web pages or send stored secrets to discovered/unverified hosts.
import { checkedUrl, fetchPublicText } from './jaco-fetch-mcp.mjs';

const PATHS=['/openapi.json','/swagger.json','/api/openapi.json','/docs','/api/docs'];
const AUTH=new Set(['apiKey','http','oauth2','openIdConnect','mutualTLS','basic']);
const METHODS=new Set(['get','post','put','patch','delete','head','options','trace']);
function summarizeOpenApi(raw){
 let doc;try{doc=JSON.parse(raw);}catch{return null;}
 if(!doc||Array.isArray(doc)||typeof doc!=='object'||!(typeof doc.openapi==='string'&&/^3\.[0-9]/.test(doc.openapi)||doc.swagger==='2.0')||!doc.paths||typeof doc.paths!=='object'||Array.isArray(doc.paths))return null;
 const auth=[...new Set(Object.values(doc.components?.securitySchemes||doc.securityDefinitions||{}).map(s=>s?.type).filter(t=>AUTH.has(t)))].sort();
 const counts={};
 for(const [key,entry] of Object.entries(doc.paths)){
   if(!key.startsWith('/')||!entry||typeof entry!=='object')continue;
   for(const method of Object.keys(entry))if(METHODS.has(method))counts[method]=(counts[method]||0)+1;
 }
 return {format:doc.swagger==='2.0'?'swagger2':'openapi3',operationCounts:counts,authenticationTypes:auth};
}
export async function discoverPublicApi(input,{fetchFn=fetchPublicText,now=()=>new Date().toISOString()}={}){
 const url=checkedUrl(input);
 const origin=url.origin; // Deliberately ignore query, fragment and caller-supplied paths.
 const probes=await Promise.all(PATHS.map(async route=>{
   try{
     const observed=await fetchFn(origin+route);
     const final=new URL(observed.url);
     if(final.origin!==origin||final.search||final.hash||observed.truncated)return {route,state:'UNVERIFIED_RESPONSE'};
     const raw=typeof observed.content==='string'?observed.content:'';
     const spec=summarizeOpenApi(raw);
     if(spec)return {route,state:'OPENAPI_OBSERVED',...spec};
     if(/<html\b|<!doctype html/i.test(raw)&&/swagger[- ]ui|redoc|api reference|api documentation|openapi/i.test(raw))return {route,state:'DOCS_CANDIDATE'};
     return {route,state:'NO_API_EVIDENCE'};
   }catch{return {route,state:'FETCH_UNAVAILABLE'};}
 }));
 const state=probes.some(p=>p.state==='OPENAPI_OBSERVED')?'SPEC_OBSERVED':probes.some(p=>p.state==='DOCS_CANDIDATE')?'DOCS_CANDIDATE':'NEEDS_CDP';
 return {schema:'jaco.api-discovery/v1',origin,observedAt:now(),state,probes,
   credentials:'NOT_ACQUIRED',apiVerified:false,
   next:state==='SPEC_OBSERVED'?'Review official auth and terms; validate only an authorized credential against its documented official endpoint.':'Use scoped CDP browser survey on official developer documentation; never collect browser cookies or unrelated keys.'};
}
