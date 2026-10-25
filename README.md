# JARVIS — macOS AI Assistant

A local-first, interactive assistant for macOS featuring a futuristic dashboard, voice input/output, optional OpenAI reasoning, webcam hand gestures, and a permission-gated Mac action bridge.

## Quick start (macOS)

1. Install Python 3.11+ and Google Chrome or Safari.
2. Clone the repository and open Terminal in its folder.
3. Run:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python app.py
```

4. Visit **http://127.0.0.1:8765** in Chrome or Safari.
5. Allow microphone and camera permissions when prompted.
6. Optionally put your API key in the local `.env` file (never commit it).

Without an OpenAI key, JARVIS still runs a demo responder and supported local actions.

### What works
- Futuristic responsive dashboard and animated AI core
- Text chat with optional OpenAI responses
- Browser speech recognition and spoken replies where supported
- Webcam hand landmark gestures via MediaPipe: open palm to halt visual activity, thumbs up to greet, pinch to toggle voice, and swipe to navigate
- Local Mac commands for opening approved apps and opening approved HTTPS URLs, with explicit approval in the UI
- Localhost-only server and basic origin / request protections

### Limits
- This is a developer prototype, not a production-grade autonomous Mac operator.
- Speech recognition support varies by browser and may use the browser vendor's speech services.
- Hand gestures need camera access and may require good lighting.
- It does not have root access, unrestricted shell access, or silent access to personal files.
- The OpenAI API incurs usage costs. Mac Accessibility permissions and a signed native app will be needed for richer control later.
- The camera inference library is delivered through a CDN; an internet connection is needed for this prototype.

### Safety
- Actions are allowlisted, explicit, and require a human confirmation click.
- Server listens only on 127.0.0.1.
- Never paste API keys into the dashboard or GitHub.
- Revisit security, authentication, and local approvals before adding filesystem or accessibility powers.
