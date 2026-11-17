export const el=(tag,text,attrs={})=>{const x=document.createElement(tag);if(text!==undefined)x.textContent=String(text);for(const [k,v] of Object.entries(attrs))x.setAttribute(k,v);return x;};
export const get=id=>document.getElementById(id);
export const read=(key,fallback)=>{try{const value=localStorage.getItem(key);return value===null?fallback:JSON.parse(value)}catch{return fallback;}};
export const save=(key,value)=>localStorage.setItem(key,JSON.stringify(value));
export const showError=e=>{get('status').textContent=e.message;};
export const submit=(id,handler)=>get(id).addEventListener('submit',e=>{e.preventDefault();try{handler(new FormData(e.target));get('status').textContent='Updated';}catch(error){showError(error);}});
export const table=(head,rows)=>{const t=el('table'),h=el('thead'),r=el('tr');head.forEach(x=>r.append(el('th',x)));h.append(r);t.append(h);const b=el('tbody');for(const row of rows){const tr=el('tr');row.forEach(x=>{const td=el('td');if(x instanceof Node)td.append(x);else td.textContent=String(x);tr.append(td)});b.append(tr)}t.append(b);return t;};