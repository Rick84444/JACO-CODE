import test from 'node:test';
import assert from 'node:assert/strict';
import { createCdpFacade, validCdpArgument } from '../../agents/cdp-bridge.mjs';

const token='fixture-123456789012345678901234567890';
async function fixture(fn) {
  const calls=[];
  const server=createCdpFacade({token,base:'http://127.0.0.1:4243',fetchImpl:async(url,options)=>{
    calls.push({url,options});
    return {ok:true,json:async()=>({ok:true,verified:true,source:'real-upstream-mock'})};
  }});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const request=async(method,params,id=1)=>{
    const response=await fetch('http://127.0.0.1:'+server.address().port+'/mcp',{
      method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},
      body:JSON.stringify({jsonrpc:'2.0',id,method,params})
    });
    assert.equal(response.status,200);
    return response.json();
  };
  try { await fn({request,calls}); }
  finally { server.closeAllConnections();await new Promise(resolve=>server.close(resolve)); }
}
const actionId='action-unique-12345';

test('CDP MCP declares optional constraints accurately, with required operation fields',async()=>{
  await fixture(async({request})=>{
    const response=await request('tools/list');
    const byName=new Map(response.result.tools.map(t=>[t.name,t]));
    assert.deepEqual(byName.get('nova_click').inputSchema.required,['selector','actionId']);
    assert.deepEqual(byName.get('nova_click_named').inputSchema.required,['role','name','actionId']);
    assert.deepEqual(byName.get('nova_upload').inputSchema.required,['selector','files','actionId']);
    assert.equal(byName.get('nova_upload').inputSchema.properties.files.type,'array');
    assert.deepEqual(byName.get('nova_targets').inputSchema.required,[]);
    assert.equal(byName.get('nova_screenshot').annotations.readOnlyHint,true);
    assert.equal(byName.get('nova_upload').annotations.readOnlyHint,false);
  });
});

test('CDP MCP forwards valid upload arrays rather than rejecting typeof object',async()=>{
  await fixture(async({request,calls})=>{
    const response=await request('tools/call',{name:'nova_upload',arguments:{
      selector:'input[type=file]',files:['images/a.png','documents/b.pdf'],actionId
    }});
    assert.equal(response.result.isError,false);
    assert.equal(calls.length,1);
    assert.match(calls[0].url,/\/upload$/);
    const body=JSON.parse(calls[0].options.body);
    assert.deepEqual(body.files,['images/a.png','documents/b.pdf']);
    assert.equal(body.actionId,actionId);
  });
});

test('CDP MCP accepts selector and accessibility actions without optional expectedUrl/expect',async()=>{
  await fixture(async({request,calls})=>{
    const a=await request('tools/call',{name:'nova_click',arguments:{selector:'#save',actionId}},20);
    const b=await request('tools/call',{name:'nova_click_named',arguments:{role:'button',name:'Save',actionId}},21);
    assert.equal(a.result.isError,false);
    assert.equal(b.result.isError,false);
    assert.equal(calls.length,2);
  });
});

test('invalid/missing arrays, optional argument shape and unknown keys fail before upstream execution',async()=>{
  await fixture(async({request,calls})=>{
    const bad=[
      {name:'nova_upload',arguments:{selector:'#file',files:'not-an-array',actionId}},
      {name:'nova_upload',arguments:{selector:'#file',files:[],actionId}},
      {name:'nova_upload',arguments:{selector:'#file',files:Array(11).fill('a'),actionId}},
      {name:'nova_upload',arguments:{selector:'#file',files:['a',42],actionId}},
      {name:'nova_upload',arguments:{selector:'#file',files:['a']}},
      {name:'nova_click',arguments:{selector:'#save',actionId,expect:['not an object']}},
      {name:'nova_click',arguments:{selector:'#save',actionId,expect:{url:42}}},
      {name:'nova_click',arguments:{selector:'#save',actionId,extra:'something'}},
      {name:'nova_click',arguments:{selector:'#save',actionId,__proto__:'ignored'}},
    ];
    for(const [index,input] of bad.entries()){
      if(index===8)continue; // __proto__ literal is not an own property in JS
      const response=await request('tools/call',input,40+index);
      assert.equal(response.error?.code,-32602,'case '+index);
    }
    assert.equal(calls.length,0);
  });
});
test('CDP schema verifier enforces bounded collection and nested structure',()=>{
  assert.equal(validCdpArgument(['ok'],{type:'array',items:{type:'string'},minItems:1,maxItems:10}),true);
  assert.equal(validCdpArgument(['ok',null],{type:'array',items:{type:'string'}}),false);
  assert.equal(validCdpArgument({}, {type:'object',properties:{url:{type:'string'}}}),true);
  assert.equal(validCdpArgument({url:42}, {type:'object',properties:{url:{type:'string'}}}),false);
  assert.equal(validCdpArgument(null,{type:'object'}),false);
});
