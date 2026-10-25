"""JARVIS local macOS bridge. No arbitrary shell execution."""
import os
import re
import subprocess
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request

load_dotenv()
app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 32_768
APPROVED_APPS = {
    "safari": "Safari", "notes": "Notes", "calculator": "Calculator",
    "calendar": "Calendar", "terminal": "Terminal", "finder": "Finder",
    "music": "Music", "messages": "Messages", "reminders": "Reminders",
}
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
    "You are JARVIS, a concise and professional macOS assistant. "
    "You cannot operate the computer from chat. Never claim actions were completed. "
    "Computer actions require separate user approval."
)

def gemini_reply(message):
    import requests
    key = os.getenv("GEMINI_API_KEY", "").strip()
    model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash").strip()
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    response = requests.post(
        url, headers={"x-goog-api-key": key},
        json={"systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
              "contents": [{"role": "user", "parts": [{"text": message}]}]},
        timeout=18,
    )
    response.raise_for_status()
    data = response.json()
    parts = data["candidates"][0]["content"]["parts"]
    reply = " ".join(p.get("text", "") for p in parts).strip()
    if not reply:
        raise ValueError("Gemini returned an empty response")
    return reply

def ollama_reply(message):
    import requests
    # Fixed loopback URL prevents sending chat data to arbitrary hosts.
    response = requests.post(
        "http://127.0.0.1:11434/api/chat",
        json={"model": os.getenv("OLLAMA_MODEL", "llama3.2"),
              "messages": [{"role": "system", "content": SYSTEM_PROMPT},
                           {"role": "user", "content": message}],
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
    return jsonify(primary="Gemini" if os.getenv("GEMINI_API_KEY") else "Not configured",
                   fallback="Ollama (local)", model=os.getenv("OLLAMA_MODEL", "llama3.2"))

@app.post("/api/chat")
def chat():
    message = str((request.get_json(silent=True) or {}).get("message", "")).strip()[:2500]
    if not message:
        return jsonify(error="Empty message"), 400
    errors = []
    if os.getenv("GEMINI_API_KEY", "").strip():
        try:
            return jsonify(reply=gemini_reply(message), mode="GEMINI")
        except Exception as exc:
            app.logger.warning("Gemini request failed: %s", type(exc).__name__)
            errors.append("Gemini unavailable")
    try:
        return jsonify(reply=ollama_reply(message), mode="OLLAMA")
    except Exception as exc:
        app.logger.warning("Ollama request failed: %s", type(exc).__name__)
        errors.append("Ollama unavailable")
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
    return jsonify(error="Action not allowlisted"), 403

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.getenv("JARVIS_PORT", "8765")), debug=False)
