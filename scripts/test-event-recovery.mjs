// Exercise the real orchestrator with controlled network/cache failures.
import assert from 'node:assert/strict'
import {readFileSync,mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

const dir=mkdtempSync(join(tmpdir(),'stepfair-transport-'))
const source=readFileSync(new URL('../src/main/event.ts',import.meta.url),'utf8')
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const exports={}
const fs=await import('node:fs')
vm.runInNewContext(js,{exports,require(name){
  if(name==='node:fs')return fs
  if(name==='node:path')return {join}
  if(name==='ws')return {default:class {}}
  if(name==='./config')return {getConfig:()=>({eventCacheDir:dir})}
  if(name==='./logger')return {log(){}}
  if(name==='./cache')return {VideoCache:class {async ensure(url){return url}}}
  throw Error(name)
},Date,Math,URL,fetch,AbortSignal,setTimeout,setInterval,clearInterval})
try{
  const updates=[],o=new exports.EventOrchestrator({isDestroyed:()=>false,webContents:{send:(_,s)=>updates.push(s)}})
  o.state={entries:[],celebration:{id:'old'},activeGame:null};o.lastQueue='[]'
  o.outbox=[{type:'celebration',id:'old',action:'started'}]
  let rejectAck
  o.request=async path=>path.endsWith('/state')?{queue:[],celebration:null}:new Promise((_,reject)=>rejectAck=reject)
  await o.poll()
  assert.equal(o.state.celebration,null,'a hanging acknowledgement must not block Home')
  assert.equal(o.outbox.length,1)
  rejectAck(new Error('offline'));await new Promise(setImmediate)
  let reply={queue:[],celebration:{id:'failed',name:'Test',videoUrl:'local.mp4',duration:8,failure_remaining_ms:1200}}
  o.outbox=[];o.request=async()=>reply
  await o.poll()
  assert.ok(o.state.celebration.expiresAt<=Date.now()+1200)
  assert.ok(o.state.celebration.expiresAt>Date.now())
  reply.celebration.failure_remaining_ms=null
  await o.poll()
  assert.ok(o.state.celebration.expiresAt>=Date.now()+34000,'healthy success renews its lease')
  reply.celebration=null
  await o.poll()
  assert.equal(o.state.celebration,null)
  console.log('PASS: stalled acknowledgements do not block state; failure deadline and disconnect lease; Home clears victory.')
}finally{rmSync(dir,{recursive:true,force:true})}
