const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const html=fs.readFileSync('templates/index.html','utf8');
function boot(){
 const elements=new Map([...html.matchAll(/id="([^"]+)"/g)].map(match=>[match[1],{hidden:match[1]==='macTools'||match[1]==='liveVision',textContent:'',value:'',setAttribute(k,v){this[k]=v},addEventListener(){},focus(){},contains(target){return target===this},replaceChildren(){},getTracks(){return[]}}]));
 elements.get('dashboard').firstElementChild={};
 const classes={toggle(){},remove(){},add(){}};
 const context=vm.createContext({document:{getElementById:id=>elements.get(id)||null,body:{classList:classes},documentElement:{},addEventListener(){},createElement:()=>({append(){}})},window:{addEventListener(){}},navigator:{onLine:true,mediaDevices:{getUserMedia:async()=>{const error=new Error('Permission denied');error.name='NotAllowedError';throw error}}},fetch:async()=>({ok:false,json:async()=>({items:[],provider:'test'})}),setInterval(){},setTimeout(){},clearTimeout(){},clearInterval(){},Date,AbortController,console});
 elements.get('messages').append=()=>{};
 vm.runInContext(fs.readFileSync('static/app.js','utf8'),context);
 return {elements,context};
}
test('complete script binds Mac controls and camera to actual template IDs',()=>{
 const {elements}=boot();
 assert.equal(typeof elements.get('camera').onclick,'function');
 const button=elements.get('toolsToggle');button.onclick();
 assert.equal(elements.get('macTools').hidden,false);
 assert.equal(button['aria-expanded'],'true');
 elements.get('closeTools').onclick();assert.equal(elements.get('macTools').hidden,true);
});
test('camera permission error is explained and leaves the button usable',async()=>{
 const {elements}=boot();await elements.get('camera').onclick();
 assert.equal(elements.get('state').textContent,'CAMERA ERROR');
 assert.match(elements.get('hint').textContent,/Allow camera access/);
 assert.equal(elements.get('camera').disabled,false);
});
test('video comes after the chat composer',()=>{
 assert(html.indexOf('id="video"')>html.indexOf('id="chatForm"'));
});
function connectTestCamera(env){
 const video=env.elements.get('video');Object.assign(video,{readyState:2,videoWidth:640,videoHeight:360});
 const canvas=env.elements.get('landmarks');canvas.getContext=()=>({drawImage(){}});canvas.toDataURL=()=> 'data:image/jpeg;base64,FRESH';
 env.elements.get('cameraAnswers').checked=true;
 vm.runInContext('cameraStream={}; latestFrame="data:image/jpeg;base64,OLD"; previousObservation="A cup was visible."',env.context);
}
test('any camera question and follow-up send a fresh frame and scene context',async()=>{
 const env=boot();connectTestCamera(env);const requests=[];
 env.context.fetch=async(url,options)=>{requests.push(JSON.parse(options.body));return {ok:true,json:async()=>({reply:'The cup is blue.',mode:'VISION'})}};
 await vm.runInContext('sendMessage("What color is it?")',env.context);
 assert.equal(requests.length,1);
 assert.equal(requests[0].image,'data:image/jpeg;base64,FRESH');
 assert.match(requests[0].message,/What color is it/);
 assert.match(requests[0].message,/A cup was visible/);
});
test('turning camera answers off omits camera data and observations',async()=>{
 const env=boot();connectTestCamera(env);env.elements.get('cameraAnswers').checked=false;let request;
 env.context.fetch=async(url,options)=>{request=JSON.parse(options.body);return {ok:true,json:async()=>({reply:'Hello.',mode:'TEXT'})}};
 await vm.runInContext('sendMessage("Hello")',env.context);
 assert.equal(request.image,undefined);assert.equal(request.message,'Hello');
});
test('unready camera does not send an old frame or an ungrounded request',async()=>{
 const env=boot();connectTestCamera(env);env.elements.get('video').readyState=0;let calls=0;
 env.context.fetch=async()=>{calls++};
 await vm.runInContext('sendMessage("Describe this")',env.context);
 assert.equal(calls,0);
});
