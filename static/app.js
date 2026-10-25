const $ = id => document.getElementById(id);
const messages = $("messages"), state = $("state"), hint = $("hint");
let recognition, listening = false, wakeWordEnabled = false, awaitingCommand = false, cameraStream, detector, cameraLoop, frameCapture, latestFrame = null, captureRequested = false, gestureCooldown = 0, speechOn = true, conversationHistory = [], memoryItems = [], activeRequest, timers = [], lastReply = "";
const setState = (title, sub) => { state.textContent = title; hint.textContent = sub; };
const addMessage = (text, kind) => { const div = document.createElement("div"); div.className = "message " + kind; div.textContent = text; messages.append(div); messages.scrollTop = messages.scrollHeight; };
function speak(text) {
  if (!speechOn || !("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const voices=speechSynthesis.getVoices();
  const preferred=voices.find(v=>/^en(-US)?$/i.test(v.lang) && /Samantha|Alex|Daniel|Karen|Google US English/i.test(v.name))
    || voices.find(v=>/^en(-US)?/i.test(v.lang));
  if (preferred) u.voice=preferred;
  u.rate=.94;
  u.pitch=1;
  u.volume=.95;
  speechSynthesis.speak(u);
}
if ("speechSynthesis" in window) speechSynthesis.onvoiceschanged=()=>speechSynthesis.getVoices();
function wakeCommand(transcript) {
  const normalized=transcript.toLowerCase().replace(/[.,!?;:]/g," ").replace(/\s+/g," ").trim();
  const wake=/\b(?:hey\s+jarvis|jarvis|hey\s+buddy|buddy)\b/;
  const match=normalized.match(wake);
  if (!match) return null;
  return normalized.slice(match.index+match[0].length).trim();
}
async function sendMessage(text) {
  text = text.trim(); if (!text) return;
  const remember=text.match(/^remember(?: that)?\s+(.+)/i);
  if (remember) { await saveMemory(remember[1], "fact"); return; }
  if (/^(forget|clear) (my )?memory$/i.test(text)) { await clearMemory(); return; }
  if (/^(please )?repeat( that)?$/i.test(text)) { if (lastReply) speak(lastReply); return; }
  const timer=text.match(/^set (?:a )?timer for (\d+)\s*(seconds?|minutes?|hours?)$/i);
  if (timer) { startTimer(Number(timer[1]), timer[2]); return; }
  if (/^(cancel|stop) (the )?(current )?timer$/i.test(text)) { cancelTimer(); return; }
  const macAction=text.match(/^(?:open|create|add)\s+(?:a\s+)?(note|reminder|calendar event)\b(?:[:\s]+(.+))?$/i);
  if (macAction) {
    const type=/reminder/i.test(macAction[1])?"reminder":/calendar/i.test(macAction[1])?"calendar":"note";
    await performAction(type, (macAction[2] || macAction[1]).trim());
    return;
  }
  addMessage(text, "user"); setState("PROCESSING REQUEST", "Consulting intelligence core...");
  try {
    const body={message:text, history:conversationHistory.slice(-12), memory:memoryItems.map(item=>item.value), personality:$("personality").value};
    const visualQuestion=/\b(what do you see|what am i holding|describe (this|the) (image|scene|room)|read (this|that|the text)|what is in front of me|analy[sz]e the frame)\b/i.test(text);
    if (latestFrame && (captureRequested || visualQuestion)) body.image=latestFrame;
    captureRequested=false;
    activeRequest=new AbortController();
    const r = await fetch("/api/chat", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),signal:activeRequest.signal});
    const data = await r.json(); if (!r.ok) throw Error(data.error || "Request failed");
    conversationHistory.push({role:"user",content:text},{role:"assistant",content:data.reply});
    conversationHistory=conversationHistory.slice(-12);
    lastReply=data.reply; addMessage(data.reply,"ai"); $("mode").textContent=data.mode; speak(data.reply); setState("SYSTEM ONLINE", "Awaiting your next command.");
  } catch(e) {if(e.name!=="AbortError"){addMessage(e.message,"ai");setState("CONNECTION ERROR","Check the local server.");}}
  finally {activeRequest=null;}
}
$("chatForm").addEventListener("submit",e=>{e.preventDefault(); const text=$("prompt").value;$("prompt").value="";sendMessage(text);});
$("clock").textContent = new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
setInterval(()=>$("clock").textContent=new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}),15000);
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
  recognition = new SpeechRecognition(); recognition.lang="en-US"; recognition.continuous=true; recognition.interimResults=true;
  recognition.onresult=e=>{
    for (let i=e.resultIndex; i<e.results.length; i++) {
      const result=e.results[i], transcript=result[0]?.transcript?.trim();
      if (transcript && !result?.isFinal) $("heard").textContent=`Hearing: ${transcript}`;
      if (!result?.isFinal || !transcript) continue;
      $("heard").textContent=`Heard: ${transcript}`;
      const command=wakeCommand(transcript);
      if (!awaitingCommand && command !== null) {
        awaitingCommand=true;
        setState("LISTENING","Wake word detected. Speak your command.");
        if (command) {
          awaitingCommand=false;
          sendMessage(command);
        }
      } else if (awaitingCommand) {
        awaitingCommand=false;
        sendMessage(transcript);
      }
    }
  };
  recognition.onstart=()=>{listening=true;document.body.classList.add("listening");};
  recognition.onerror=e=>{
    if (e.error==="not-allowed" || e.error==="service-not-allowed") {
      wakeWordEnabled=false; listening=false; document.body.classList.remove("listening");
      $("voice").textContent="◉ ENABLE WAKE WORD";
      setState("MICROPHONE BLOCKED","Allow microphone access in your browser, then try again.");
      return;
    }
    if (e.error!=="aborted") setState("MICROPHONE ERROR",e.error);
  };
  recognition.onend=()=>{
    listening=false;
    if (wakeWordEnabled) {
      setTimeout(()=>{if(wakeWordEnabled) try{recognition.start();listening=true;}catch(e){}},250);
      return;
    }
    awaitingCommand=false; document.body.classList.remove("listening"); $("voice").textContent="◉ ENABLE WAKE WORD";
  };
} else { $("voice").disabled=true; $("voice").title="Speech recognition is unavailable in this browser"; }
function startWakeWordListening() {
  if (!recognition || wakeWordEnabled || listening) return;
  wakeWordEnabled=true;
  awaitingCommand=false;
  try {
    recognition.start();
    $("voice").textContent="◎ WAKE WORD ACTIVE";
    setState("LISTENING FOR WAKE WORD","Say “Hey Jarvis”, “Jarvis”, or “Hey Buddy”.");
  } catch (e) {
    wakeWordEnabled=false;
    $("voice").textContent="◉ ENABLE WAKE WORD";
    setState("MICROPHONE PERMISSION NEEDED","Click ENABLE WAKE WORD once to allow automatic listening.");
  }
}
$("voice").onclick=()=>{
  if(!recognition)return;
  if(wakeWordEnabled){wakeWordEnabled=false;recognition.stop();return;}
  startWakeWordListening();
};
$("stop").onclick=()=>{wakeWordEnabled=false;awaitingCommand=false;recognition?.stop();speechSynthesis?.cancel();activeRequest?.abort();setState("SYSTEM HALTED","Waiting for your next instruction.");};
$("quiet").onclick=()=>{speechSynthesis?.cancel();setState("VOICE SILENCED","JARVIS will remain available for your next instruction.");};
$("analyzeFrame").onclick=()=>{if(!latestFrame){setState("CAMERA REQUIRED","Start the camera before analyzing a frame.");return;}captureRequested=true;$("prompt").value="Describe what you see in the current camera frame."; $("chatForm").requestSubmit();};
async function updateDiagnostics() {
  try {
    const r=await fetch("/api/dashboard"); const data=await r.json();
    $("dashboard").firstElementChild.textContent=`AI: ${data.provider.toUpperCase()}`;
    $("networkStatus").textContent=`NETWORK: ${navigator.onLine?"ONLINE":"OFFLINE"}`;
  } catch (e) { $("dashboard").firstElementChild.textContent="AI: UNAVAILABLE"; }
  $("micStatus").textContent=`MIC: ${recognition ? "READY" : "UNAVAILABLE"}`;
  $("cameraStatus").textContent=`CAMERA: ${cameraStream ? "ON" : "OFF"}`;
}
async function updateBattery() {
  if (!navigator.getBattery) { $("batteryStatus").textContent="BATTERY: N/A"; return; }
  const battery=await navigator.getBattery();
  const render=()=>$("batteryStatus").textContent=`BATTERY: ${Math.round(battery.level*100)}%`;
  render(); battery.addEventListener("levelchange",render);
}
updateDiagnostics(); updateBattery(); window.addEventListener("online",updateDiagnostics); window.addEventListener("offline",updateDiagnostics); setInterval(updateDiagnostics,30000);
if (recognition) window.addEventListener("load",startWakeWordListening);
async function performAction(type,value) {
  if (!value) return;
  if (!window.confirm("Allow JARVIS to "+(type==="app"?"open application: ":"open website: ")+value+"?")) return;
  try {
    const r=await fetch("/api/action",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({type,value})});
    const data=await r.json();if(!r.ok)throw Error(data.error);
    addMessage(data.message,"ai");
  } catch(e){addMessage("Action failed: "+e.message,"ai");}
}
$("openApp").onclick=()=>performAction("app",$("appChoice").value);
$("openUrl").onclick=()=>performAction("url",$("url").value.trim());
function startTimer(amount, unit) {
  const multiplier=/hour/i.test(unit)?3600:/minute/i.test(unit)?60:1;
  const seconds=amount*multiplier;
  if (!confirm(`Set a ${amount} ${unit} timer?`)) return;
  const timer={label:`${amount} ${unit}`,id:null};
  timer.id=setTimeout(()=>{addMessage(`Timer complete: ${timer.label}.`,"ai");speak(`Your ${timer.label} timer is complete.`);timers=timers.filter(item=>item!==timer);},seconds*1000);
  timers.push(timer); addMessage(`Timer set for ${timer.label}.`,"ai");
}
function cancelTimer() {
  if (!timers.length) { addMessage("There are no active timers.","ai"); return; }
  timers.forEach(timer=>clearTimeout(timer.id)); timers=[]; addMessage("All active timers have been cancelled.","ai");
}
async function saveMemory(value, category=$("memoryCategory").value) {
  try {
    const r=await fetch("/api/memory",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({value,category})});
    const data=await r.json(); if(!r.ok) throw Error(data.error);
    memoryItems=data.items; addMessage(data.message,"ai"); $("memoryInput").value=""; renderMemory();
  } catch(e) { addMessage("Memory failed: "+e.message,"ai"); }
}
async function clearMemory() {
  try {
    const r=await fetch("/api/memory",{method:"DELETE"}); const data=await r.json();
    if(!r.ok) throw Error(data.error); memoryItems=[]; addMessage(data.message,"ai"); renderMemory();
  } catch(e) { addMessage("Memory failed: "+e.message,"ai"); }
}
$("saveMemory").onclick=()=>{const value=$("memoryInput").value.trim();if(value)saveMemory(value);};
$("clearMemory").onclick=()=>{if(confirm("Clear all locally stored memory?"))clearMemory();};
async function loadMemory() {
  try {
    const r=await fetch("/api/memory"); const data=await r.json(); if(!r.ok) throw Error(data.error);
    memoryItems=data.items || []; renderMemory();
  } catch(e) { $("memoryStatus").textContent="Memory unavailable."; }
}
function renderMemory() {
  $("memoryStatus").textContent=memoryItems.length ? `${memoryItems.length} local memory item(s) stored.` : "No memory loaded.";
  $("memoryList").replaceChildren(...memoryItems.map((item,index)=>{
    const row=document.createElement("div"); row.className="memory-item";
    row.textContent=`${item.category || "fact"}: ${item.value}`;
    const remove=document.createElement("button"); remove.textContent="×"; remove.title="Delete memory";
    remove.onclick=async()=>{const r=await fetch(`/api/memory/${index}`,{method:"DELETE"});if(r.ok){memoryItems=(await r.json()).items;renderMemory();}};
    row.append(remove); return row;
  }));
}
loadMemory();
async function startCamera() {
  if(cameraStream){stopCamera();return;}
  try{
    const video=$("video");
    cameraStream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:640},height:{ideal:360},facingMode:"user"},audio:false});
    video.srcObject=cameraStream; await video.play(); $("camera").textContent="◎ STOP CAMERA";$("gesture").textContent="STARTING";$("cameraPrivacy").textContent="Camera active. A frame is shared only for visual questions or Analyze Frame.";
    const canvas=$("landmarks");
    canvas.width=video.videoWidth || 640; canvas.height=video.videoHeight || 360;
    frameCapture=setInterval(()=>{
      if (video.readyState>=2 && video.videoWidth) {
        canvas.width=video.videoWidth; canvas.height=video.videoHeight;
        canvas.getContext("2d").drawImage(video,0,0,canvas.width,canvas.height);
        latestFrame=canvas.toDataURL("image/jpeg",0.7);
      }
    },1000);
    try {
      const {HandLandmarker,FilesetResolver}=await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/+esm");
      const resolver=await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm");
      detector=await HandLandmarker.createFromOptions(resolver,{baseOptions:{modelAssetPath:"https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"},runningMode:"VIDEO",numHands:1});
    } catch (e) {
      $("gesture").textContent="VIDEO ONLY";
      setState("CAMERA ONLINE","Gesture tracking unavailable; video is active.");
    }
    if (!detector) return;
    $("gesture").textContent="TRACKING";let lastFrame=-1;
    const detect=()=>{if(!cameraStream)return;const video=$("video");if(video.readyState>=2 && video.currentTime!==lastFrame){lastFrame=video.currentTime;const hands=detector.detectForVideo(video,performance.now()).landmarks;if(hands.length)recognizeGesture(hands[0]);else $("gesture").textContent="NO HAND";}cameraLoop=requestAnimationFrame(detect);};
    detect();
  }catch(e){setState("CAMERA ERROR",e.message);stopCamera();}
}
function recognizeGesture(h) {
  const distance=(a,b)=>Math.hypot(h[a].x-h[b].x,h[a].y-h[b].y);
  const extended=[8,12,16,20].filter((tip,i)=>h[tip].y<h[[6,10,14,18][i]].y).length;
  let gesture = "HAND DETECTED";
  if(distance(4,8)<.045) gesture="PINCH";
  else if(extended===4) gesture="OPEN PALM";
  else if(h[4].y<h[3].y && extended===0) gesture="THUMBS UP";
  $("gesture").textContent=gesture;
  if(Date.now()-gestureCooldown<2500)return;
  if(gesture==="OPEN PALM"){speechSynthesis?.cancel();gestureCooldown=Date.now();setState("PALM DETECTED","Spoken response halted.");}
  if(gesture==="PINCH"){speechOn=!speechOn;gestureCooldown=Date.now();setState("VOICE "+(speechOn?"ENABLED":"MUTED"),"Gesture acknowledged.");}
  if(gesture==="THUMBS UP"){gestureCooldown=Date.now();setState("GESTURE ACKNOWLEDGED","Systems operational.");}
}
function stopCamera(){if(cameraLoop)cancelAnimationFrame(cameraLoop);if(frameCapture)clearInterval(frameCapture);cameraLoop=null;frameCapture=null;latestFrame=null;cameraStream?.getTracks().forEach(t=>t.stop());cameraStream=null;detector?.close();detector=null;$("video").srcObject=null;$("camera").textContent="◎ START CAMERA";$("gesture").textContent="OFFLINE";$("cameraPrivacy").textContent="Camera off. No image is shared.";}
$("camera").onclick=startCamera;
window.addEventListener("beforeunload",stopCamera);
