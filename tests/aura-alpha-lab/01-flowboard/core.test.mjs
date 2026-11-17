import test from 'node:test';
import assert from 'node:assert/strict';
import {kanban} from './core.mjs';
test("adds a task",()=>{assert.deepEqual(kanban(...[[],{"type":"add","id":"a","title":" Test "}]),[{"id":"a","title":"Test","status":"todo"}]);});
test("moves task",()=>{assert.deepEqual(kanban(...[[{"id":"a","title":"Test","status":"todo"}],{"type":"move","id":"a","status":"done"}]),[{"id":"a","title":"Test","status":"done"}]);});
test("deletes task",()=>{assert.deepEqual(kanban(...[[{"id":"a","title":"Test","status":"todo"}],{"type":"delete","id":"a"}]),[]);});
test("rejects duplicate",()=>{assert.throws(()=>kanban(...[[{"id":"a","title":"Test","status":"todo"}],{"type":"add","id":"a","title":"duplicate"}]),new RegExp("Invalid task"));});
