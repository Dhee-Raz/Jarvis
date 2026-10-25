"""JARVIS local macOS bridge. No arbitrary shell execution."""
import os
import re
import subprocess
import json
import logging
import time
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request

load_dotenv()
app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 1_000_000
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
APPROVED_APPS = {
    "safari": "Safari", "notes": "Notes", "calculator": "Calculator",
    "calendar": "Calendar", "terminal": "Terminal", "finder": "Finder",
    "music": "Music", "messages": "Messages", "reminders": "Reminders",
}
MEMORY_FILE = Path(__file__).with_name("jarvis_memory.json")
RATE_LIMIT = {}
# The bridge does not provide generic shell, filesystem, or AppleScript execution.

@app.after_request
def security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Cache-Control"] = "no-store"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; "
        "style-src 'self' 'unsafe-inline'; connect-src 'self' https://cdn.jsdelivr.net "
        "https://storage.googleapis.com; worker-src 'self' blob:; "
        "img-src 'self' data:; media-src 'self';"
    )
    return response

@app.before_request
def restrict_origin():
    # Localhost DNS rebinding mitigation. Browsers use one of these Host values.
    host = request.host.split(":")[0].lower()
    if host not in ("127.0.0.1", "localhost"):
        return jsonify(error="Local-only service"), 403
    if request.method == "POST":
        now = time.time()
        recent = [stamp for stamp in RATE_LIMIT.get(request.remote_addr, []) if now - stamp < 60]
        if len(recent) >= 60:
            return jsonify(error="Too many requests. Try again shortly."), 429
        recent.append(now)
        RATE_LIMIT[request.remote_addr] = recent
        origin = request.headers.get("Origin", "")
        if origin not in ("http://127.0.0.1:8765", "http://localhost:8765",
                          f"http://127.0.0.1:{os.getenv('JARVIS_PORT', '8765')}",
                          f"http://localhost:{os.getenv('JARVIS_PORT', '8765')}"):
            return jsonify(error="Invalid origin"), 403
        if request.mimetype != "application/json":
            return jsonify(error="JSON required"), 415

@app.get("/")
def home():
    return render_template("index.html")

SYSTEM_PROMPT = (
    "You are JARVIS, a polished and thoughtful personal assistant. "
    "Speak naturally, formally, and warmly, like a capable human professional. "
    "Use complete sentences and contractions when they sound natural. "
    "Avoid robotic phrases, unnecessary headings, repetitive confirmations, "
    "overly dramatic language, and mentioning that you are an AI unless asked. "
    "You cannot operate the computer from chat. Never claim actions were completed. "
    "Computer actions require separate user approval. "
    "When an image is provided, describe only what is visibly supported by it. "
    "Use the image to answer questions about objects, people, and activities, "
    "but do not identify people or infer sensitive personal information."
)

def gemini_reply(message, image=None, history=None):
    import requests
    key = os.getenv("GEMINI_API_KEY", "").strip()
    model = os.getenv("GEMINI_MODEL", "gemini-3.5-flash").strip()
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    parts = [{"text": message}]
    if image:
        parts.append({"inline_data": {"mime_type": "image/jpeg", "data": image}})
        parts[0]["text"] += "\nAnalyze the provided frame. If text is visible, transcribe it accurately. Do not identify people."
    contents = history or [{"role": "user", "parts": parts}]
    if history:
        contents.append({"role": "user", "parts": parts})
    response = requests.post(
        url, params={"key": key},
        json={"systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
              "contents": contents},
        timeout=18,
    )
    response.raise_for_status()
    data = response.json()
    parts = data["candidates"][0]["content"]["parts"]
    reply = " ".join(p.get("text", "") for p in parts).strip()
    if not reply:
        raise ValueError("Gemini returned an empty response")
    return reply

def run_macos_script(script, *values):
    if os.uname().sysname != "Darwin":
        raise RuntimeError("macOS integration is only available on macOS")
    result = subprocess.run(
        ["osascript", "-e", script, "--", *values],
        capture_output=True, text=True, timeout=10, check=False
    )
    if result.returncode:
        raise RuntimeError("macOS action failed")
    return result.stdout.strip()

def run_macos_app(app_name):
    if app_name not in {"Notes", "Reminders", "Calendar", "Music"}:
        raise ValueError("Application is not approved")
    subprocess.Popen(["open", "-a", app_name])

def create_note(value):
    run_macos_script(
        'on run argv\n tell application "Notes" to make new note at folder "Notes" with properties {body:item 1 of argv}\nend run',
        value,
    )

def create_reminder(value):
    run_macos_script(
        'on run argv\n tell application "Reminders" to make new reminder with properties {name:item 1 of argv}\nend run',
        value,
    )

def create_calendar_event(value):
    run_macos_script(
        'on run argv\n tell application "Calendar" to tell calendar "Calendar" to make new event with properties {summary:item 1 of argv, start date:(current date), end date:((current date) + 3600)}\nend tell\nend run',
        value,
    )

def ollama_reply(message, image=None, history=None):
    import requests
    # Fixed loopback URL prevents sending chat data to arbitrary hosts.
    model = os.getenv("OLLAMA_MODEL", "llama3.2")
    if image and model.split(":", 1)[0].lower() in {"llama3.2", "llama3.1", "llama3"}:
        raise ValueError(
            "The configured Ollama model does not support images. "
            "Configure Gemini or a vision-capable Ollama model for camera questions."
        )
    user_message = {"role": "user", "content": message}
    if image:
        user_message["images"] = [image]
    messages = history or [{"role": "user", "content": message}]
    if history:
        messages.append(user_message)
    response = requests.post(
        "http://127.0.0.1:11434/api/chat",
        json={"model": model,
              "messages": [{"role": "system", "content": SYSTEM_PROMPT}] + messages,
              "stream": False},
        timeout=90,
    )
    response.raise_for_status()
    reply = response.json()["message"]["content"].strip()
    if not reply:
        raise ValueError("Ollama returned an empty response")
    return reply

@app.get("/api/status")
def ai_status():
    return jsonify(
        primary="Gemini" if os.getenv("GEMINI_API_KEY") else "Not configured",
        fallback="Ollama (local)", model=os.getenv("OLLAMA_MODEL", "llama3.2"),
        vision_model=os.getenv("OLLAMA_MODEL", "llama3.2") not in {"llama3", "llama3.1", "llama3.2"},
    )

@app.get("/api/diagnostics")
def diagnostics():
    battery = "Unavailable"
    if os.uname().sysname == "Darwin":
        try:
            battery = subprocess.run(
                ["pmset", "-g", "batt"], capture_output=True, text=True,
                timeout=2, check=False
            ).stdout.strip().splitlines()[-1]
        except (OSError, subprocess.SubprocessError, IndexError):
            pass
    return jsonify(
        provider=os.getenv("OLLAMA_MODEL", "llama3.2"),
        gemini=bool(os.getenv("GEMINI_API_KEY", "").strip()),
        ollama=True,
        battery=battery,
        timestamp=int(time.time()),
        vision_mode=os.getenv("VISION_MODE", "cloud-preferred"),
    )

@app.get("/api/dashboard")
def dashboard():
    return jsonify(
        service="online",
        provider=os.getenv("GEMINI_MODEL", "gemini-3.5-flash")
        if os.getenv("GEMINI_API_KEY", "").strip()
        else os.getenv("OLLAMA_MODEL", "llama3.2"),
        camera="browser-controlled",
        memory=len(read_memory()),
        timestamp=int(time.time()),
    )

@app.get("/api/weather")
def weather():
    import requests
    latitude = os.getenv("WEATHER_LATITUDE")
    longitude = os.getenv("WEATHER_LONGITUDE")
    if not latitude or not longitude:
        return jsonify(error="Set WEATHER_LATITUDE and WEATHER_LONGITUDE in .env"), 503
    response = requests.get(
        "https://api.open-meteo.com/v1/forecast",
        params={"latitude": latitude, "longitude": longitude, "current": "temperature_2m,weather_code,wind_speed_10m"},
        timeout=8,
    )
    response.raise_for_status()
    return jsonify(response.json().get("current", {}))

@app.get("/api/calendar")
def calendar_events():
    events = run_macos_script(
        'tell application "Calendar" to tell calendar "Calendar" to get summary of every event whose start date is greater than or equal to (current date)',
    )
    return jsonify(events=[item.strip() for item in events.split(",") if item.strip()])

@app.post("/api/music")
def music():
    action_name = (request.get_json(silent=True) or {}).get("action")
    scripts = {
        "play": 'tell application "Music" to play',
        "pause": 'tell application "Music" to pause',
        "next": 'tell application "Music" to next track',
    }
    if action_name not in scripts:
        return jsonify(error="Unsupported music action"), 400
    run_macos_script(scripts[action_name])
    return jsonify(message=f"Music action '{action_name}' completed.")

def read_memory():
    try:
        with MEMORY_FILE.open(encoding="utf-8") as file:
            data = json.load(file)
        return data if isinstance(data, list) else []
    except (OSError, json.JSONDecodeError):
        return []

def write_memory(items):
    with MEMORY_FILE.open("w", encoding="utf-8") as file:
        json.dump(items[-50:], file, indent=2)

@app.get("/api/memory")
def get_memory():
    return jsonify(items=read_memory())

@app.post("/api/memory")
def add_memory():
    body = request.get_json(silent=True) or {}
    value = str(body.get("value", "")).strip()
    category = str(body.get("category", "fact")).strip().lower()
    if not value or len(value) > 500:
        return jsonify(error="Memory must be between 1 and 500 characters"), 400
    if category not in {"fact", "preference", "task"}:
        return jsonify(error="Invalid memory category"), 400
    items = read_memory()
    items.append({"value": value, "category": category, "created": int(time.time())})
    write_memory(items)
    return jsonify(message="Memory saved locally.", items=items)

@app.delete("/api/memory/<int:index>")
def delete_memory(index):
    items = read_memory()
    if index < 0 or index >= len(items):
        return jsonify(error="Memory item not found"), 404
    items.pop(index)
    write_memory(items)
    return jsonify(message="Memory item deleted.", items=items)

@app.delete("/api/memory")
def clear_memory():
    write_memory([])
    return jsonify(message="Local memory cleared.")

@app.post("/api/chat")
def chat():
    body = request.get_json(silent=True) or {}
    message = str(body.get("message", "")).strip()[:2500]
    history = body.get("history", [])
    memory = body.get("memory", [])
    vision_mode = os.getenv("VISION_MODE", "cloud-preferred")
    personality = str(body.get("personality", "professional")).strip().lower()
    image = body.get("image")
    if image is not None:
        if (not isinstance(image, str) or
                not re.fullmatch(r"data:image/jpeg;base64,[A-Za-z0-9+/=]+", image) or
                len(image) > 700_000):
            return jsonify(error="Invalid camera image"), 400
        image = image.split(",", 1)[1]
    if not message:
        return jsonify(error="Empty message"), 400
    if not isinstance(history, list) or len(history) > 12:
        return jsonify(error="Invalid conversation history"), 400
    if any(
        not isinstance(item, dict)
        or item.get("role") not in {"user", "assistant"}
        or not isinstance(item.get("content"), str)
        or len(item["content"]) > 2500
        for item in history
    ):
        return jsonify(error="Invalid conversation history"), 400
    if not isinstance(memory, list) or len(memory) > 20:
        return jsonify(error="Invalid memory"), 400
    if personality not in {"professional", "friendly", "concise", "technical"}:
        personality = "professional"
    memory = [str(item).strip()[:500] for item in memory if str(item).strip()]
    if memory:
        message = "Relevant user preferences and facts (use only when helpful):\n- " + "\n- ".join(memory) + "\n\nUser request:\n" + message
    message = f"Response style: {personality}.\n\n{message}"
    history = [
        item for item in history
        if isinstance(item, dict) and item.get("role") in {"user", "assistant"}
        and isinstance(item.get("content"), str) and len(item["content"]) <= 2500
    ]
    errors = []
    if image and vision_mode == "local-only":
        try:
            return jsonify(reply=ollama_reply(message, image, history), mode="OLLAMA LOCAL VISION")
        except Exception as exc:
            app.logger.warning("Local vision request failed: %s", type(exc).__name__)
            return jsonify(error="Local vision provider is unavailable."), 503
    if os.getenv("GEMINI_API_KEY", "").strip():
        try:
            return jsonify(reply=gemini_reply(message, image, [
                {"role": item["role"], "parts": [{"text": item["content"]}]}
                for item in history
            ]), mode="GEMINI")
        except Exception as exc:
            app.logger.warning("Gemini request failed: %s", type(exc).__name__)
            errors.append("Gemini unavailable")
    try:
        return jsonify(reply=ollama_reply(message, image, history), mode="OLLAMA")
    except Exception as exc:
        app.logger.warning("Ollama request failed: %s", type(exc).__name__)
        errors.append(
            "Ollama vision unavailable" if image and "does not support images" in str(exc)
            else "Ollama unavailable"
        )
    if image and "Ollama vision unavailable" in errors:
        return jsonify(
            error="Camera questions need a vision-capable AI provider. "
                  "Your configured Ollama model is text-only, and Gemini is unavailable.",
            providers=errors), 503
    return jsonify(
        error="Neither AI provider is available. Verify GEMINI_API_KEY and run 'ollama pull llama3.2' with Ollama running.",
        providers=errors), 503

@app.post("/api/action")
def action():
    body = request.get_json(silent=True) or {}
    kind = body.get("type")
    value = str(body.get("value", "")).strip()
    if kind == "app" and value.lower() in APPROVED_APPS:
        subprocess.Popen(["open", "-a", APPROVED_APPS[value.lower()]])
        return jsonify(message=f"Requested opening {APPROVED_APPS[value.lower()]}.")
    if kind == "url":
        parsed = urlparse(value)
        if (parsed.scheme == "https" and parsed.hostname
                and re.fullmatch(r"[A-Za-z0-9.-]+", parsed.hostname)
                and parsed.username is None and parsed.password is None
                and parsed.port in (None, 443)
                and len(value) <= 500):
            subprocess.Popen(["open", value])
            return jsonify(message="Requested opening approved HTTPS address.")
    if kind == "timer":
        seconds = body.get("seconds")
        if isinstance(seconds, int) and 1 <= seconds <= 86_400:
            subprocess.Popen(["open", "-a", "Clock"])
            return jsonify(message=f"Opened Clock for a {seconds}-second timer.")
    if kind == "note" and 1 <= len(value) <= 500:
        if not request.get_json(silent=True).get("confirmed"):
            return jsonify(error="Confirmation required"), 409
        create_note(value)
        return jsonify(message="Created the approved note in Notes.")
    if kind in {"reminder", "calendar"} and 1 <= len(value) <= 500:
        if not request.get_json(silent=True).get("confirmed"):
            return jsonify(error="Confirmation required"), 409
        if kind == "reminder":
            create_reminder(value)
        else:
            create_calendar_event(value)
        return jsonify(message=f"Created the approved {kind}.")
    return jsonify(error="Action not allowlisted"), 403

if __name__ == "__main__":
    port = int(os.getenv("JARVIS_PORT", "8765"))
    if os.getenv("JARVIS_PRODUCTION", "").lower() == "true":
        from waitress import serve
        serve(app, host="127.0.0.1", port=port, threads=4)
    else:
        app.run(host="127.0.0.1", port=port, debug=False)
