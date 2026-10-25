const $ = id => document.getElementById(id);
const messages = $("messages"), state = $("state"), hint = $("hint");
let recognition, listening = false, cameraStream, detector, cameraLoop, gestureCooldown = 0, speechOn = true;
const setState = (title, sub) => { state.textContent = title; hint.textContent = sub; };
const addMessage = (text, kind) => { const div = document.createElement("div"); div.className = "message " + kind; div.textContent = text; messages.append(div); messages.scrollTop = messages.scrollHeight; };
function speak(text) { if (!speechOn || !("speechSynthesis" in window)) return; speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.rate = 1; u.pitch = .86; speechSynthesis.speak(u); }
async function sendMessage(text) {
  text = text.trim(); if (!text) return;
  addMessage(text, "user"); setState("PROCESSING REQUEST", "Consulting intelligence core...");
  try {
    const r = await fetch("/api/chat", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:text})});
    const data = await r.json(); if (!r.ok) throw Error(data.error || "Request failed");
    addMessage(data.reply,"ai"); $("mode").textContent=data.mode; speak(data.reply); setState("SYSTEM ONLINE", "Awaiting your next command.");
  } catch(e) {addMessage(e.message,"ai");setState("CONNECTION ERROR","Check the local server.");}
}
$("chatForm").addEventListener("submit",e=>{e.preventDefault(); const text=$("prompt").value;$("prompt").value="";sendMessage(text);});
$("clock").textContent = new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
setInterval(()=>$("clock").textContent=new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}),15000);
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
  recognition = new SpeechRecognition(); recognition.lang="en-US"; recognition.continuous=false; recognition.interimResults=false;
  recognition.onresult=e=>sendMessage(e.results[0][0].transcript);
  recognition.onerror=e=>setState("MICROPHONE ERROR",e.error);
  recognition.onend=()=>{listening=false;document.body.classList.remove("listening");$("voice").textContent="◉ START LISTENING";};
} else { $("voice").disabled=true; $("voice").title="Speech recognition is unavailable in this browser"; }
$("voice").onclick=()=>{if(!recognition)return;if(listening){recognition.stop();return;}try{recognition.start();listening=true;document.body.classList.add("listening");$("voice").textContent="◎ LISTENING";setState("LISTENING","Speak your command.");}catch(e){setState("MICROPHONE ERROR",e.message);}};
$("stop").onclick=()=>{recognition?.stop();speechSynthesis?.cancel();setState("SYSTEM HALTED","Waiting for your next instruction.");};
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
async function startCamera() {
  if(cameraStream){stopCamera();return;}
  try{
    cameraStream=await navigator.mediaDevices.getUserMedia({video:{width:640,height:360},audio:false});
    $("video").srcObject=cameraStream;$("camera").textContent="◎ STOP CAMERA";$("gesture").textContent="STARTING";
    const {HandLandmarker,FilesetResolver}=await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/+esm");
    const resolver=await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm");
    detector=await HandLandmarker.createFromOptions(resolver,{baseOptions:{modelAssetPath:"https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"},runningMode:"VIDEO",numHands:1});
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
function stopCamera(){if(cameraLoop)cancelAnimationFrame(cameraLoop);cameraLoop=null;cameraStream?.getTracks().forEach(t=>t.stop());cameraStream=null;detector?.close();detector=null;$("video").srcObject=null;$("camera").textContent="◎ START CAMERA";$("gesture").textContent="OFFLINE";}
$("camera").onclick=startCamera;
window.addEventListener("beforeunload",stopCamera);
