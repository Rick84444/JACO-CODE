// Untrusted HTML is data. Only return inert, locally renderable markup.
// This is intentionally conservative: remote scripts, fonts, images, imports,
// embeds, forms, navigation and every remote CSS resource are excluded.
// A fully faithful website capture requires separately authorized asset import.
const SAFE_TAGS=new Set([
  'div','span','main','header','footer','nav','section','article','aside',
  'h1','h2','h3','h4','h5','h6','p','strong','em','b','i','u','small',
  'ul','ol','li','dl','dt','dd','pre','code','blockquote','br','hr',
  'table','thead','tbody','tfoot','tr','th','td','caption','figure','figcaption',
  'a','img'
]);
const SAFE_CSS=new Set([
  'color','background-color','border','border-color','border-width','border-style','border-radius',
  'border-top','border-bottom','border-left','border-right','box-shadow',
  'margin','margin-top','margin-right','margin-bottom','margin-left','padding',
  'padding-top','padding-right','padding-bottom','padding-left',
  'width','height','max-width','min-width','max-height','min-height',
  'display','flex','flex-direction','flex-wrap','flex-grow','flex-shrink','flex-basis',
  'align-items','justify-content','align-self','order','gap','row-gap','column-gap',
  'grid','grid-template-columns','grid-template-rows','grid-column','grid-row',
  'position','top','left','right','bottom','z-index','overflow','overflow-x','overflow-y',
  'font-family','font-size','font-weight','font-style','line-height','letter-spacing',
  'text-align','text-decoration','text-transform','white-space','word-break','opacity',
  'vertical-align','object-fit','aspect-ratio'
]);
const unsafeCssValue=value=>value.length>300 || /[\\<>@]/.test(value) ||
  /(?:url\s*\(|image-set\s*\(|var\s*\(|attr\s*\(|expression\s*\(|import|binding|behavior)/i.test(value);
function safeDecl(style) {
  const result=[];
  for(let i=0;i<Math.min(style.length,100);i++){
    const prop=style.item(i).toLowerCase();
    const value=style.getPropertyValue(prop).trim();
    if(SAFE_CSS.has(prop) && !unsafeCssValue(value))
      result.push(prop+':'+value);
  }
  return result.join(';');
}
function safeStylesheet(raw) {
  if(typeof CSSStyleSheet!=='function'||raw.length>30_000)return '';
  const sheet=new CSSStyleSheet();
  try{sheet.replaceSync(raw);}catch{return '';}
  const rules=[];
  for(const rule of Array.from(sheet.cssRules).slice(0,180)){
    // Only top-level style rules. No @import, @font-face, @supports, @media etc.
    if(rule.type!==CSSRule.STYLE_RULE)continue;
    const selector=rule.selectorText || '';
    if(selector.length>180 || !/^[\w\s.#:>+*\-\[\]="'(),]+$/.test(selector))continue;
    const css=safeDecl(rule.style);
    if(css)rules.push(selector+'{'+css+'}');
  }
  return rules.join('\n');
}
function safeDataImage(src){
  if(src.length>2_000_000)return false;
  return /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/i.test(src);
}
export function sanitizeAuraStageHtml(input) {
  if(typeof document==='undefined')throw Error('AURA_SANITIZER_REQUIRES_BROWSER');
  if(typeof input!=='string' || input.length>550_000)throw Error('AURA_HTML_SIZE_LIMIT');
  // Template contents are inert; do not put raw text in an active document.
  const template=document.createElement('template');
  template.innerHTML=input;
  const cssBlocks=[];
  const elements=Array.from(template.content.querySelectorAll('*'));
  for(const element of elements){
    const tag=element.tagName.toLowerCase();
    if(tag==='style') {
      cssBlocks.push(safeStylesheet(element.textContent||''));
      element.remove();
      continue;
    }
    if(!SAFE_TAGS.has(tag)) {
      element.remove();
      continue;
    }
    const attrs=Array.from(element.attributes);
    for(const attr of attrs){
      const key=attr.name.toLowerCase(),val=attr.value;
      const common=(key==='class' && val.length<=256 && /^[\w\s-]+$/.test(val)) ||
        (key==='id' && val.length<=90 && /^[\w-]+$/.test(val)) ||
        (key==='title' && val.length<=180) ||
        (key==='role' && val.length<=60 && /^[\w-]+$/.test(val)) ||
        (key.startsWith('aria-') && val.length<=180 && /^[a-z-]+$/.test(key));
      if(common)continue;
      if(key==='style'){
        const inline=document.createElement('span');
        inline.style.cssText=val;
        const filtered=safeDecl(inline.style);
        if(filtered)element.setAttribute('style',filtered);
        else element.removeAttribute('style');
        continue;
      }
      if(tag==='img' && key==='src' && safeDataImage(val))continue;
      // Only same-document anchors, no external navigation or new windows.
      if(tag==='a' && key==='href' && /^#[A-Za-z0-9_-]{1,90}$/.test(val))continue;
      element.removeAttribute(attr.name);
    }
    if(tag==='img' && !element.hasAttribute('src'))element.remove();
  }
  const safeCss=cssBlocks.filter(Boolean).slice(0,16).join('\n');
  return (safeCss?'<style>'+safeCss+'</style>':'') + template.innerHTML;
}
