import test from 'node:test';
import assert from 'node:assert/strict';
import {toCognitiveEvent,mergeCognitiveEvents} from '../../runtime/src/lib/cognitiveEvents.mjs';
import {projectAuraTerminal} from '../../runtime/src/lib/auraTerminal.mjs';
const at='2026-11-11T13:00:00Z';
const event=(type,payload,extra={})=>toCognitiveEvent({id:extra.id||'e',at,type,payload,...extra});

test('actual command, output and exit code reach the terminal independently of narration',()=>{
  const start=event('NOVA_ACTION_STARTED',{action:{id:'m:turn:1',type:'shell',data:{command:'node --version'}},say:'I am checking the installed runtime.'},{missionId:'m'});
  const result=event('NOVA_ACTION_RESULT',{actionId:'m:turn:1',type:'shell',input:{command:'node --version'},ok:true,verified:true,result:{output:'v24.22.1',exitCode:0}},{id:'r',missionId:'m',at:'2026-11-11T13:00:01Z'});
  const [row]=projectAuraTerminal([result,start],'m');
  assert.equal(row.command,'node --version');assert.equal(row.stdout,'v24.22.1');assert.equal(row.exitCode,0);assert.equal(row.done,true);
  assert.doesNotMatch(start.text,/v24/);
});

test('streamed snapshots replace rather than duplicate output and cannot overwrite completion',()=>{
  const output=(id,seconds,text)=>event('terminal.output',{actionId:'a',command:'npm test',result:{output:text}},{id,at:`2026-11-11T13:00:0${seconds}Z`});
  const first=output('1',1,'one'), next=output('2',2,'one\ntwo');
  const merged=mergeCognitiveEvents([first],[next]);
  assert.equal(merged.length,1);assert.equal(projectAuraTerminal(merged)[0].stdout,'one\ntwo');
  const end=event('terminal.command.executed',{actionId:'a',command:'npm test',result:{output:'done',exitCode:0}},{id:'3',at:'2026-11-11T13:00:03Z'});
  assert.equal(projectAuraTerminal([first,next,end,output('4',4,'late')])[0].stdout,'done');
});

test('terminal text is bounded, ANSI-stripped, secret-redacted, and cannot become HTML',()=>{
  const secret='private-operator-credential';
  const row=toCognitiveEvent({seq:1,ts:at,type:'NOVA_ACTION_RESULT',missionId:'m',payload:{
    actionId:'a',type:'repo-test',input:{command:`node test.mjs token=${secret}`},ok:false,verified:false,
    result:{exitCode:1,stdout:`\x1b[31m${secret} sk-fixturesecret12345 <script>x</script>\x1b[0m`+'x'.repeat(9000),stderr:'assert failed'}
  }},{durable:true,secrets:[secret]});
  assert.doesNotMatch(JSON.stringify(row.terminal),new RegExp(secret+'|sk-fixturesecret12345|\\x1b'));
  assert.match(row.terminal.stdout,/<script>/); // Kept as text; rendered inside React <pre>.
  assert.equal(row.terminal.truncated,true);assert.ok(row.terminal.stdout.length<=8000);
  assert.equal(projectAuraTerminal([row],'other').length,0);
});

test('terminal results never imply missing output or exit codes',()=>{
  const row=event('NOVA_ACTION_RESULT',{actionId:'a',type:'shell',input:{command:'node script.mjs'},ok:true,verified:false,result:{outcomeUnknown:true}});
  const [projected]=projectAuraTerminal([row]);
  assert.equal(projected.exitCode,null);assert.equal(projected.stdout,'');assert.equal(projected.outcome,'unknown');
  assert.equal(toCognitiveEvent({id:'r',at,type:'NOVA_ACTION_RESULT',payload:{type:'repo-read',actionId:'read',result:{content:'private'}}}).terminal,undefined);
});
