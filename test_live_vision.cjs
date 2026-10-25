// Run with: node test_live_vision.cjs
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('static/app.js', 'utf8');
function setup(fetch) {
  const elements = new Map(), scheduled = [];
  const $ = id => {
    if (!elements.has(id)) elements.set(id, {textContent:'',checked:false,setAttribute(){}});
    return elements.get(id);
  };
  Object.assign($('video'), {readyState:2,videoWidth:1280,videoHeight:720});
  $('landmarks').getContext = () => ({drawImage(){}});
  $('landmarks').toDataURL = () => 'data:image/jpeg;base64,AAAA';
  let stopped = false;
  const context = vm.createContext({$,fetch,AbortController,Date,Math,Error,
    document:{hidden:false},setTimeout:(fn,delay)=>{const task={fn,delay};scheduled.push(task);return task},
    clearTimeout:task=>{if(task)task.cancelled=true},clearInterval(){},cancelAnimationFrame(){},
    cameraStream:{getTracks:()=>[{stop(){stopped=true}}]},latestFrame:null,activeRequest:null,
    currentUtterance:null,frameCapture:null,cameraLoop:null,detector:null,captureRequested:false,
    speak(){throw Error('Should not speak by default')}
  });
  vm.runInContext(source.slice(source.indexOf('let visionTimer'), source.indexOf('async function startCamera()')),context);
  vm.runInContext(source.slice(source.indexOf('function stopCamera()'),source.indexOf('$("camera").onclick=startCamera;')),context);
  vm.runInContext('visionEnabled=true',context);
  return {context,$,scheduled,stopped:()=>stopped,run:code=>vm.runInContext(code,context)};
}
test('fresh bounded frame is analyzed and next analysis waits for completion',async()=>{
  let body;
  const env=setup(async(url,options)=>{body=JSON.parse(options.body);return {ok:true,json:async()=>({reply:'A person is holding a cup.'})}});
  await env.run('analyzeLiveVideo()');
  assert.equal(body.image,'data:image/jpeg;base64,AAAA');
  assert.equal(body.history.length,0);
  assert.equal(env.$('landmarks').width,640);
  assert.equal(env.$('landmarks').height,360);
  assert.equal(env.$('visionObservation').textContent,'A person is holding a cup.');
  assert(env.scheduled.some(task=>task.delay===8000&&!task.cancelled));
});
test('pause aborts request and discards a late response',async()=>{
  let resolve,signal;
  const env=setup((url,options)=>{signal=options.signal;return new Promise(r=>resolve=r)});
  const pending=env.run('analyzeLiveVideo()');
  env.$('pauseVision').onclick();
  assert(signal.aborted);
  resolve({ok:true,json:async()=>({reply:'Stale observation'})});await pending;
  assert.notEqual(env.$('visionObservation').textContent,'Stale observation');
  assert.equal(env.$('visionStatus').textContent,'PAUSED');
  assert(!env.scheduled.some(task=>!task.cancelled));
});
test('camera stop ends tracks, aborts analysis, and removes frames',async()=>{
  let resolve,signal;
  const env=setup((url,options)=>{signal=options.signal;return new Promise(r=>resolve=r)});
  const pending=env.run('analyzeLiveVideo()');
  env.run('stopCamera()');assert(env.stopped());assert(signal.aborted);
  assert.equal(env.context.latestFrame,null);assert.equal(env.$('liveVision').hidden,true);
  resolve({ok:true,json:async()=>({reply:'Late'})});await pending;
  assert.equal(env.$('visionObservation').textContent,'Camera stopped.');
});
test('hidden tab and foreground chat defer frame sharing',async()=>{
  let calls=0;const env=setup(async()=>{calls++});
  env.context.document.hidden=true;await env.run('analyzeLiveVideo()');
  env.context.document.hidden=false;env.context.activeRequest={};await env.run('analyzeLiveVideo()');
  assert.equal(calls,0);
});
test('provider errors appear and retry with backoff',async()=>{
  const env=setup(async()=>({ok:false,json:async()=>({error:'Vision unavailable'})}));
  await env.run('analyzeLiveVideo()');
  assert.match(env.$('visionObservation').textContent,/Vision unavailable/);
  assert(env.scheduled.some(task=>task.delay===16000&&!task.cancelled));
});
