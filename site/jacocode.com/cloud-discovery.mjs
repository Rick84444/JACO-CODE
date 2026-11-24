// Public discovery for versioned, fixed JACO install recipes.
// This route is deliberately GET-only: it cannot approve, dispatch or execute.
import {INSTALL_CATALOG_SCHEMA, installRecipes, installRecipePlan} from './install-recipes.mjs';
const reply=(body,status=200)=>Response.json(body,{status,headers:{
  'cache-control':'no-store','x-content-type-options':'nosniff',
}});
const fail=(code,status)=>reply({schema:'jaco.install-discovery/v1',status:'UNAVAILABLE',error:code},status);
const PATHS=new Set(['/cloud/v1/catalog','/cloud/v1/recipe-plan']);

export function handleInstallDiscovery(request,url) {
  if(!PATHS.has(url.pathname)) return null;
  if(request.method!=='GET') return fail('METHOD_NOT_ALLOWED',405);
  const keys=url.pathname==='/cloud/v1/catalog'?new Set(['platform']):new Set(['platform','recipe']);
  if([...url.searchParams.keys()].some(k=>!keys.has(k))) return fail('UNSUPPORTED_PARAMETER',400);
  if([...keys].some(k=>url.searchParams.getAll(k).length>1)) return fail('DUPLICATE_PARAMETER',400);
  const platform=url.searchParams.get('platform')||undefined;
  if(url.pathname==='/cloud/v1/recipe-plan' &&
     (!platform||!url.searchParams.get('recipe'))) return fail('RECIPE_AND_PLATFORM_REQUIRED',400);
  try {
    if(url.pathname==='/cloud/v1/catalog') return reply({
      schema:INSTALL_CATALOG_SCHEMA,status:'CATALOG_AVAILABLE',
      recipes:installRecipes({platform}),
      execution:'NOT_AVAILABLE_ON_PUBLIC_ENDPOINT',approval:'REQUIRED',
    });
    return reply(installRecipePlan(url.searchParams.get('recipe'),platform));
  } catch(e) {
    if(e.message==='INSTALL_PLATFORM_UNSUPPORTED') return fail(e.message,400);
    if(e.message==='INSTALL_RECIPE_UNKNOWN') return fail(e.message,404);
    return fail('DISCOVERY_UNAVAILABLE',503);
  }
}
