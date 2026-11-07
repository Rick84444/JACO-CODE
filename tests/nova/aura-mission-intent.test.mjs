import assert from 'node:assert/strict';
import test from 'node:test';
import { isExplicitAutonomousMissionRequest as work } from '../../runtime/src/lib/auraMissionIntent.mjs';
test('direct explicit marketing and build instructions are executable in Full Autonomous',()=>{
  for(const text of ['Marknadsför jacocode.com på relevanta utvecklarplattformar','Skapa konton för jacocode.com','Bygg en riktig Google-koppling','Publish the verified release'])assert.equal(work(text),true,text);
});
test('questions and mere acknowledgements remain human conversation',()=>{
  for(const text of ['Hur kan vi marknadsföra JACO?','Can you create an account?','Ja, det stämmer','Hej Aura','Visa status?'])assert.equal(work(text),false,text);
});