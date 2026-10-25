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

@app.post("/api/chat")
def chat():
    message = str((request.get_json(silent=True) or {}).get("message", "")).strip()[:2500]
    if not message:
        return jsonify(error="Empty message"), 400
    if os.getenv("OPENAI_API_KEY"):
        try:
            from openai import OpenAI
            response = OpenAI(timeout=20.0).responses.create(
                model=os.getenv("OPENAI_MODEL", "gpt-4.1-mini"),
                instructions=(
                    "You are JARVIS, a concise, professional Mac desktop copilot. "
                    "You cannot directly operate the computer from this chat endpoint. "
                    "Do not claim actions were completed. Suggest supported commands "
                    "but make clear a separate approval is required."
                ),
                input=message,
                max_output_tokens=450,
            )
            return jsonify(reply=response.output_text or "No response received.", mode="AI")
        except Exception:
            return jsonify(error="AI service unavailable. Check your API key and network."), 502
    msg = message.lower()
    if "hello" in msg or "hi jarvis" in msg:
        reply = "Systems online. How can I assist you?"
    elif "help" in msg:
        reply = "Use text, voice, or the camera. I can suggest actions, and the Mac Controls panel can open approved applications after confirmation."
    elif "time" in msg:
        from datetime import datetime
        reply = f"The local time is {datetime.now().strftime('%I:%M %p')}."
    else:
        reply = "Demo mode is active. Add OPENAI_API_KEY to your local .env file to enable AI answers."
    return jsonify(reply=reply, mode="DEMO")

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
