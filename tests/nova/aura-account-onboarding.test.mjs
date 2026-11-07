import assert from 'node:assert/strict';
import test from 'node:test';
import { accountPageKind, accountPageDecision, validateAccountSetupGrant, accountOutcomeReport } from '../../agents/lib/account-onboarding.mjs';
import { inputAllowed } from '../../agents/lib/browser-scope.mjs';

const mission='mission_12345678';
const origin='https://example.org';
const grant=validateAccountSetupGrant({enabled:true,execution_mode:'autonomous',operator_confirmed:true,mission_id:mission,origins:[origin]});

test('registration is account scoped and requires matching autonomous mission',()=>{
  assert.equal(accountPageKind(origin+'/signup'),'registration');
  assert.equal(accountPageKind(origin+'/register'),'registration');
  assert.equal(accountPageDecision(origin+'/signup',grant,mission).allowed,true);
  assert.equal(accountPageDecision(origin+'/signup',grant,'different').reason,'ACCOUNT_SETUP_GRANT_REQUIRED');
  assert.equal(accountPageDecision(origin+'/signup',null,mission).allowed,false);
  assert.equal(accountPageDecision(origin+'/login',grant,mission).reason,'OPERATOR_AUTH_HANDOFF_REQUIRED');
  assert.equal(accountPageDecision('https://accounts.google.com/o/oauth2/v2/auth',grant,mission).reason,'OPERATOR_AUTH_HANDOFF_REQUIRED');
  assert.equal(accountPageDecision(origin+'/docs',null,mission).allowed,true);
});

test('only a named origin and operator confirmation can authorize a registration grant',()=>{
  assert.throws(()=>validateAccountSetupGrant({enabled:true,execution_mode:'autonomous',operator_confirmed:false,mission_id:mission,origins:[origin]}),/CONFIRMATION/);
  assert.throws(()=>validateAccountSetupGrant({enabled:true,execution_mode:'planning',operator_confirmed:true,mission_id:mission,origins:[origin]}),/CONFIRMATION/);
  assert.throws(()=>validateAccountSetupGrant({enabled:true,execution_mode:'autonomous',operator_confirmed:true,mission_id:mission,origins:['http://example.org']}),/ORIGIN_INVALID/);
  assert.throws(()=>validateAccountSetupGrant({enabled:true,execution_mode:'autonomous',operator_confirmed:true,mission_id:mission,origins:[origin]},['https://other.org']),/OUT_OF_SCOPE/);
});

test('legacy Nova CDP cannot bypass account-setup grant with broad-web flag',()=>{
  const env={JACO_BROWSER_SCOPE:'broad_web',JACO_GATEWAY_ALLOW_MUTATIONS:'1'};
  assert.equal(inputAllowed(origin+'/signup',env),false);
  assert.equal(inputAllowed(origin+'/register',env),false);
  assert.equal(inputAllowed(origin+'/docs',env),true);
  assert.equal(inputAllowed('https://accounts.google.com/o/oauth2/v2/auth',env),false);
});

test('unverified account creation produces a truthful blocker and alternatives',()=>{
  const report=accountOutcomeReport({attempted:true,verified:false,blocker:'MFA_REQUIRED',target:'example.org'});
  assert.equal(report.status,'BLOCKED');
  assert.match(report.message,/MFA_REQUIRED/);
  assert.ok(report.nextSteps.some(v=>/official API/.test(v)));
  assert.equal(accountOutcomeReport({attempted:false}).status,'NOT_ATTEMPTED');
});