# JARVIS — macOS AI Assistant

JARVIS is a local macOS dashboard with text, browser voice interaction, webcam gesture detection and explicitly approved Mac app launching.

## AI providers: Gemini first, Ollama fallback

JARVIS tries Gemini first if `GEMINI_API_KEY` is set. If Gemini fails or has no key, it tries a **local Ollama model**. If neither is available, it returns a clear setup error. The dashboard shows the successful provider as GEMINI or OLLAMA.

### 1. Set up Gemini

1. Create an API key at https://aistudio.google.com/api-keys (free-tier availability and quotas vary).
2. Copy `.env.example` to `.env` if you do not have a local `.env` yet. **Do not overwrite an existing .env.**
3. Edit `.env` to set `GEMINI_API_KEY=your_key`. Keep `.env` local; it is ignored by Git.

### 2. Install Ollama as offline fallback

Download Ollama for macOS from https://ollama.com/download, start the Ollama application, then in Terminal run:

```bash
ollama pull llama3.2
ollama run llama3.2 "Say hello, Jarvis."
```

Local model downloads require internet once; inference works offline afterward. A local Ollama server normally listens on 127.0.0.1:11434. RAM and disk requirements depend on the chosen model. You can change `OLLAMA_MODEL` in `.env` after downloading another model.

### 3. Run JARVIS

```bash
git pull origin main
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
# Only if .env does not exist:
test -f .env || cp .env.example .env
python app.py
```

Open http://127.0.0.1:8765 and send a message. Use `http://127.0.0.1:8765/api/status` to inspect configured provider names without exposing credentials.

### Other capabilities

- Futuristic dashboard, text chat and spoken answers
- Browser speech recognition (browser support varies)
- Wake words: “Hey Jarvis”, “Jarvis”, “Hey Buddy”, and “Buddy”
- Conversation context, repeat/quiet controls, and response styles
- Opening the camera starts automatic scene and activity observations from periodic snapshots; optional hand tracking uses MediaPipe
- Live Vision shows the latest observation, Pause/Resume analysis, and optional spoken updates
- **Use live camera in my questions** attaches a freshly captured frame to each typed or spoken question while the camera is open, including follow-ups. Turn it off to use text-only chat; Analyze Frame still shares a frame explicitly.
- Automatic analysis waits eight seconds after each response, pauses in hidden tabs, and defers to foreground chat
- Local, categorized, individually removable memory
- Provider, camera, microphone, battery, and network dashboard status
- Confirmed timers and allowlisted macOS application, Notes, Reminders, Calendar, and HTTPS URL opening
- Optional local-only vision mode with `VISION_MODE=local-only`
- Optional production WSGI serving with `JARVIS_PRODUCTION=true`
- Optional weather status using `WEATHER_LATITUDE` and `WEATHER_LONGITUDE`

### Limitations and security

- Gemini free tier has limits; check current availability in Google AI Studio.
- Ollama fallback requires the Ollama service running and the selected model downloaded.
- Fallback is triggered by provider failure; it does not automatically detect all connectivity states.
- JARVIS does not execute arbitrary shell commands, silently control your Mac, or have root access.
- Browser speech recognition may send audio to a browser provider, even when the AI model is local.
- Opening the camera enables automatic frame sharing with the configured vision provider (Gemini may process frames in the cloud; `VISION_MODE=local-only` uses Ollama). **Pause analysis** stops background sharing while keeping the preview available. Camera frames still accompany questions when **Use live camera in my questions** is enabled. **Stop Camera** or **Stop** ends capture and cancels pending analysis.
- Vision analyzes periodic snapshots, not continuous motion. Observations can be delayed or mistaken; use a direct visual question for a specific detail.
- JARVIS does not identify people from camera frames and does not infer sensitive personal information.
- Never commit `.env` or API keys. The service binds only to localhost.

### Example commands

- “Set a timer for five minutes.”
- “Cancel the current timer.”
- “Remember that I prefer concise answers.”
- “Forget my memory.”
- “Repeat that.”
- “What do you see?” (with the camera running)
- “Read the text in front of me.” (with the camera running)
- “Create a reminder: call the dentist.” (requires confirmation)
- “Pause the music.” (requires confirmation)

For production-style local serving:

```bash
JARVIS_PRODUCTION=true python3 app.py
```
