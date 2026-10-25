const $ = id => document.getElementById(id);
const messages = $("messages"), state = $("state"), hint = $("hint");
let recognition, listening = false, wakeWordEnabled = false, awaitingCommand = false, cameraStream, detector, cameraLoop, frameCapture, latestFrame = null, captureRequested = false, gestureCooldown = 0, speechOn = true, conversationHistory = [], memoryItems = [], activeRequest, timers = [], lastReply = "";
const setState = (title, sub) => { state.textContent = title; hint.textContent = sub; };
const addMessage = (text, kind) => { const div = document.createElement("div"); div.className = "message " + kind; div.textContent = text; messages.append(div); messages.scrollTop = messages.scrollHeight; };
let currentUtterance = null;
function setSpeaking(active) {
  document.body.classList.toggle("speaking", active);
  $("activity").textContent = active ? "VOICE TRANSMITTING" : "CORE ONLINE";
}
function stopSpeaking() {
  currentUtterance = null;
  window.speechSynthesis?.cancel();
  setSpeaking(false);
}
function speak(text) {
  if (!speechOn || !("speechSynthesis" in window)) return;
  stopSpeaking();
  const u = new SpeechSynthesisUtterance(text);
  const voices=speechSynthesis.getVoices();
  const preferred=voices.find(v=>/^en(-US)?$/i.test(v.lang) && /Samantha|Alex|Daniel|Karen|Google US English/i.test(v.name))
    || voices.find(v=>/^en(-US)?/i.test(v.lang));
  if (preferred) u.voice=preferred;
  u.rate=.94;
  u.pitch=1;
  u.volume=.95;
  currentUtterance = u;
  setState("JARVIS IS SPEAKING", "Use Quiet to silence this response.");
  u.onstart = () => { if (currentUtterance === u) setSpeaking(true); };
  const finish = () => {
    if (currentUtterance !== u) return;
    currentUtterance = null;
    setSpeaking(false);
    setState("SYSTEM ONLINE", "Awaiting your next command.");
  };
  u.onend = finish;
  u.onerror = finish;
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
  if (activeRequest) { setState("STILL THINKING", "Please wait for the current response, or press Stop."); return; }
  stopSpeaking();
  addMessage(text, "user"); document.body.classList.add("processing"); setState("PROCESSING REQUEST", "Consulting intelligence core...");
  try {
    const body={message:text, history:conversationHistory.slice(-12), memory:memoryItems.slice(-20).map(item=>item.value), personality:$("personality").value};
    const useCamera = cameraStream && ($("cameraAnswers").checked || captureRequested);
    if (useCamera) {
      // Capture at question time instead of reusing a timer's older frame.
      const image = captureCameraFrame();
      if (!image) throw Error("The camera is still starting. Wait for the preview, then ask again.");
      cancelVisionRequest();
      body.image = image;
      body.message = text + "\n\nA fresh camera snapshot is attached to this question. Use it when relevant and prioritize it over earlier observations. Describe only visibly supported details; do not claim continuous video access.";
      if (previousObservation) body.message += "\nEarlier scene summary (may be outdated): " + previousObservation.slice(0, 700);
      $("visionStatus").textContent = "ANSWERING YOUR QUESTION";
    }
    captureRequested=false;
    activeRequest=new AbortController();
    const r = await fetch("/api/chat", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),signal:activeRequest.signal});
    const data = await r.json(); if (!r.ok) throw Error(data.error || "Request failed");
    conversationHistory.push({role:"user",content:text},{role:"assistant",content:data.reply});
    conversationHistory=conversationHistory.slice(-12);
    lastReply=data.reply; addMessage(data.reply,"ai"); $("mode").textContent=data.mode; setState("SYSTEM ONLINE", "Awaiting your next command."); speak(data.reply);
  } catch(e) {if(e.name!=="AbortError"){addMessage(e.message,"ai");setState("CONNECTION ERROR","Check the local server.");}}
  finally {
    activeRequest=null;
    document.body.classList.remove("processing");
    if (cameraStream && visionEnabled && !visionRequest) {
      clearTimeout(visionTimer);
      visionTimer=setTimeout(analyzeLiveVideo, 8000);
    }
  }
}
$("chatForm").addEventListener("submit",e=>{e.preventDefault(); const text=$("prompt").value;$("prompt").value="";sendMessage(text);});
$("clock").textContent = new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
setInterval(()=>$("clock").textContent=new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}),15000);
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
  recognition = new SpeechRecognition(); recognition.lang="en-US"; recognition.continuous=true; recognition.interimResults=true;
  recognition.onresult=e=>{
    if (currentUtterance || activeRequest) return;
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
      $("voice").textContent="◉ START LISTENING";
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
    awaitingCommand=false; document.body.classList.remove("listening"); $("voice").textContent="◉ START LISTENING";
  };
} else { $("voice").disabled=true; $("voice").title="Speech recognition is unavailable in this browser"; }
function startWakeWordListening(direct = false) {
  if (!recognition || wakeWordEnabled || listening) return;
  wakeWordEnabled=true;
  awaitingCommand=direct;
  try {
    recognition.start();
    $("voice").textContent="◉ SPEAK A COMMAND";
    setState(direct ? "LISTENING" : "LISTENING FOR WAKE WORD",direct ? "Speak your command now." : "Say “Hey Jarvis”, “Jarvis”, or “Hey Buddy”.");
  } catch (e) {
    wakeWordEnabled=false;
    $("voice").textContent="◉ START LISTENING";
    setState("MICROPHONE PERMISSION NEEDED","Click Start listening and allow microphone access.");
  }
}
$("voice").onclick=()=>{
  if(!recognition)return;
  stopSpeaking();
  if(wakeWordEnabled){awaitingCommand=true;setState("LISTENING","Speak your command now. Use Stop to end listening.");return;}
  startWakeWordListening(true);
};
$("stop").onclick=()=>{wakeWordEnabled=false;awaitingCommand=false;recognition?.stop();stopSpeaking();activeRequest?.abort();stopCamera();setState("SYSTEM HALTED","Waiting for your next instruction.");};
$("quiet").onclick=()=>{stopSpeaking();setState("VOICE SILENCED","JARVIS will remain available for your next instruction.");};
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
async function updateWeather() {
  try {
    const r=await fetch("/api/weather"); if(!r.ok) throw Error();
    const data=await r.json(); $("weatherStatus").textContent=`WEATHER: ${data.temperature_2m}°C`;
  } catch (e) { $("weatherStatus").textContent="WEATHER: N/A"; }
}
async function updateBattery() {
  if (!navigator.getBattery) { $("batteryStatus").textContent="BATTERY: N/A"; return; }
  const battery=await navigator.getBattery();
  const render=()=>$("batteryStatus").textContent=`BATTERY: ${Math.round(battery.level*100)}%`;
  render(); battery.addEventListener("levelchange",render);
}
updateDiagnostics(); updateBattery(); updateWeather(); window.addEventListener("online",updateDiagnostics); window.addEventListener("offline",updateDiagnostics); setInterval(updateDiagnostics,30000); setInterval(updateWeather,600000);
// Microphone access starts from the Listen button, a browser user gesture.
async function performAction(type,value) {
  if (!value) return;
  if (!window.confirm("Allow JARVIS to "+(type==="app"?"open application: ":"open website: ")+value+"?")) return;
  try {
    const r=await fetch("/api/action",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({type,value,confirmed:true})});
    const data=await r.json();if(!r.ok)throw Error(data.error);
    addMessage(data.message,"ai");
  } catch(e){addMessage("Action failed: "+e.message,"ai");}
}
$("openApp").onclick=()=>performAction("app",$("appChoice").value);
$("openUrl").onclick=()=>performAction("url",$("url").value.trim());
async function useMusic(action) {
  if (!confirm(`Allow Music to ${action}?`)) return;
  const r=await fetch("/api/music",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action})});
  const data=await r.json(); addMessage(data.message || data.error,"ai");
}
$("musicPlay").onclick=()=>useMusic("play");
$("musicPause").onclick=()=>useMusic("pause");
$("musicNext").onclick=()=>useMusic("next");
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
let visionTimer, visionRequest, visionTimeout, visionEnabled = false, cameraStarting = false;
let cameraSession = 0, previousObservation = "", visionFailures = 0;
function captureCameraFrame() {
  const video = $("video"), canvas = $("landmarks");
  if (!cameraStream || video.readyState < 2 || !video.videoWidth) return null;
  // Bound frame size even when a camera ignores the requested resolution.
  const scale = Math.min(1, 640 / video.videoWidth);
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
  latestFrame = canvas.toDataURL("image/jpeg", .65);
  return latestFrame;
}
function cancelVisionRequest() {
  clearTimeout(visionTimer);
  clearTimeout(visionTimeout);
  visionRequest?.abort();
  visionRequest = null;
}
function updateVisionSharing() {
  const text = !cameraStream ? "Camera off. No image is shared."
    : visionEnabled ? "Live analysis on. Camera frames are sent to your configured vision provider, which may be cloud-based."
    : "Live analysis paused. Use Analyze Frame to share a frame.";
  const answers = cameraStream && $("cameraAnswers").checked ? " Camera context is attached to every chat or voice question." : "";
  $("cameraPrivacy").textContent = text + answers;
  $("visionSharing").textContent = text + answers;
}
async function analyzeLiveVideo() {
  if (!cameraStream || !visionEnabled || visionRequest) return;
  if (document.hidden || activeRequest) {
    visionTimer = setTimeout(analyzeLiveVideo, 2000);
    return;
  }
  const image = captureCameraFrame();
  if (!image) { visionTimer = setTimeout(analyzeLiveVideo, 1000); return; }
  const session = cameraSession, controller = new AbortController();
  visionRequest = controller;
  $("visionStatus").textContent = "ANALYZING";
  visionTimeout = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch("/api/chat", {
      method: "POST", headers: {"Content-Type": "application/json"}, signal: controller.signal,
      body: JSON.stringify({
        message: "This is a periodic camera snapshot, not a continuous video clip. Briefly describe the visible scene, objects, and clearly observable activity in 1–2 sentences. Describe uncertainty honestly; do not invent motion between snapshots or infer identity, emotions, health, or intent. "
          + (previousObservation ? "Previous observation for context (may be outdated): " + previousObservation.slice(0, 1000) : ""),
        image, history: [], memory: [], personality: "concise"
      })
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || "Vision provider unavailable.");
    if (session !== cameraSession || !visionEnabled || visionRequest !== controller) return;
    if (typeof data.reply !== "string" || !data.reply.trim()) throw Error("Vision provider returned no observation.");
    const changed = data.reply !== previousObservation;
    previousObservation = data.reply;
    $("visionObservation").textContent = data.reply;
    $("visionStatus").textContent = "UPDATED " + new Date().toLocaleTimeString([], {hour:"2-digit", minute:"2-digit", second:"2-digit"});
    visionFailures = 0;
    if (changed && $("narrateVision").checked && !activeRequest && !currentUtterance) speak(data.reply);
  } catch (error) {
    if (session !== cameraSession || !visionEnabled || visionRequest !== controller) return;
    visionFailures++;
    $("visionStatus").textContent = "RETRYING";
    $("visionObservation").textContent = error.name === "AbortError"
      ? "Analysis took too long. Retrying with a fresh frame…"
      : "Live analysis unavailable: " + error.message;
  } finally {
    if (visionRequest === controller) {
      clearTimeout(visionTimeout);
      visionRequest = null;
      if (cameraStream && visionEnabled && session === cameraSession)
        visionTimer = setTimeout(analyzeLiveVideo, Math.min(30000, 8000 * (visionFailures + 1)));
    }
  }
}
$("cameraAnswers").onchange = updateVisionSharing;
$("pauseVision").onclick = () => {
  if (!cameraStream) return;
  visionEnabled = !visionEnabled;
  cancelVisionRequest();
  $("pauseVision").textContent = visionEnabled ? "Pause analysis" : "Resume analysis";
  $("pauseVision").setAttribute("aria-pressed", String(!visionEnabled));
  $("visionStatus").textContent = visionEnabled ? "STARTING" : "PAUSED";
  updateVisionSharing();
  if (visionEnabled) analyzeLiveVideo();
};
async function startCamera() {
  if (cameraStream) { stopCamera(); return; }
  if (cameraStarting) return;
  cameraStarting = true;
  const session = ++cameraSession;
  $("camera").disabled = true;
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw Error("Camera access requires localhost or HTTPS. Open http://127.0.0.1:8765 in your browser.");
    const stream = await navigator.mediaDevices.getUserMedia({video:{width:{ideal:640},height:{ideal:360},facingMode:"user"},audio:false});
    if (session !== cameraSession) { stream.getTracks().forEach(track => track.stop()); return; }
    cameraStream = stream;
    const video = $("video");
    video.srcObject = stream;
    $("liveVision").hidden = false;
    await video.play();
    if (session !== cameraSession) return;
    document.body.classList.remove("focus-mode");
    $("focusToggle").setAttribute("aria-pressed", "false");
    $("focusToggle").textContent = "◈ Focus";
    $("camera").textContent = "◎ STOP CAMERA";
    $("cameraStatus").textContent = "CAMERA: ON";
    $("gesture").textContent = "STARTING";
    previousObservation = ""; visionFailures = 0; visionEnabled = true;
    $("visionObservation").textContent = "Analyzing the scene and visible activity…";
    $("pauseVision").textContent = "Pause analysis";
    $("pauseVision").setAttribute("aria-pressed", "false");
    updateVisionSharing();
    stream.getVideoTracks()[0].addEventListener("ended", () => { if (session === cameraSession) stopCamera(); });
    captureCameraFrame();
    frameCapture = setInterval(captureCameraFrame, 1000);
    analyzeLiveVideo();
    cameraStarting = false;
    $("camera").disabled = false;
    // Vision analysis starts independently of optional hand tracking.
    try {
      const {HandLandmarker,FilesetResolver} = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/+esm");
      const resolver = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm");
      const tracker = await HandLandmarker.createFromOptions(resolver,{baseOptions:{modelAssetPath:"https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"},runningMode:"VIDEO",numHands:1});
      if (session !== cameraSession) { tracker.close(); return; }
      detector = tracker;
    } catch (error) {
      if (session === cameraSession) $("gesture").textContent = "VIDEO ONLY";
      return;
    }
    $("gesture").textContent = "TRACKING";
    let lastFrame = -1;
    const detect = () => {
      if (!cameraStream || session !== cameraSession) return;
      if (video.readyState >= 2 && video.currentTime !== lastFrame) {
        lastFrame = video.currentTime;
        const hands = detector.detectForVideo(video, performance.now()).landmarks;
        if (hands.length) recognizeGesture(hands[0]); else $("gesture").textContent = "NO HAND";
      }
      cameraLoop = requestAnimationFrame(detect);
    };
    detect();
  } catch (error) {
    if (session === cameraSession) {
      stopCamera();
      const reason = error.name === "NotAllowedError" ? "Allow camera access in your browser’s site settings and macOS Privacy & Security → Camera, then try again."
        : error.name === "NotFoundError" ? "No camera was found. Connect a camera and try again."
        : error.name === "NotReadableError" ? "The camera is unavailable. Close other apps using it and try again."
        : error.message;
      setState("CAMERA ERROR", reason);
      addMessage("Camera: " + reason, "ai");
    }
  } finally {
    if (session === cameraSession) { cameraStarting = false; $("camera").disabled = false; }
  }
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
  if(gesture==="OPEN PALM"){stopSpeaking();gestureCooldown=Date.now();setState("PALM DETECTED","Spoken response halted.");}
  if(gesture==="PINCH"){speechOn=!speechOn;if(!speechOn)stopSpeaking();gestureCooldown=Date.now();setState("VOICE "+(speechOn?"ENABLED":"MUTED"),"Gesture acknowledged.");}
  if(gesture==="THUMBS UP"){gestureCooldown=Date.now();setState("GESTURE ACKNOWLEDGED","Systems operational.");}
}
function stopCamera() {
  cameraSession++;
  cameraStarting = false;
  $("camera").disabled = false;
  visionEnabled = false;
  cancelVisionRequest();
  if (cameraLoop) cancelAnimationFrame(cameraLoop);
  if (frameCapture) clearInterval(frameCapture);
  cameraLoop = null; frameCapture = null; latestFrame = null; previousObservation = "";
  captureRequested = false;
  cameraStream?.getTracks().forEach(track => track.stop());
  cameraStream = null;
  detector?.close(); detector = null;
  $("video").srcObject = null;
  $("liveVision").hidden = true;
  $("visionObservation").textContent = "Camera stopped.";
  $("visionStatus").textContent = "OFFLINE";
  $("camera").textContent = "◎ START CAMERA";
  $("cameraStatus").textContent = "CAMERA: OFF";
  $("gesture").textContent = "OFFLINE";
  updateVisionSharing();
}
$("camera").onclick=startCamera;
window.addEventListener("beforeunload",stopCamera);

// Keep workspace tools above the core and allow an uncluttered presentation.
function showTools(open) {
  $("macTools").hidden = !open;
  $("toolsToggle").setAttribute("aria-expanded", String(open));
  if (open) $("closeTools").focus();
  else $("toolsToggle").focus();
}
$("toolsToggle").onclick = () => showTools($("macTools").hidden);
$("closeTools").onclick = () => showTools(false);
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !$("macTools").hidden) showTools(false);
});
document.addEventListener("click", event => {
  if (!$("macTools").hidden && !$("macTools").contains(event.target) && !$("toolsToggle").contains(event.target)) showTools(false);
});
$("focusToggle").onclick = () => {
  const focused = document.body.classList.toggle("focus-mode");
  $("focusToggle").setAttribute("aria-pressed", String(focused));
  $("focusToggle").textContent = focused ? "◈ Show chat" : "◈ Focus";
};
const fullscreenAvailable = typeof document.documentElement.requestFullscreen === "function";
$("fullscreen").disabled = !fullscreenAvailable;
if (!fullscreenAvailable) $("fullscreen").title = "Use your browser's fullscreen control";
$("fullscreen").onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch (error) {
    setState("FULLSCREEN UNAVAILABLE", "Use your browser's fullscreen control to expand the workspace.");
  }
};
document.addEventListener("fullscreenchange", () => {
  const active = Boolean(document.fullscreenElement);
  $("fullscreen").textContent = active ? "⛶ Exit fullscreen" : "⛶ Fullscreen";
  $("fullscreen").setAttribute("aria-label", active ? "Exit fullscreen" : "Enter fullscreen");
});
window.addEventListener("beforeunload", stopSpeaking);
