# Demo and reviewer guide

This walkthrough uses the actual app. A reviewer can inspect the screenshot, architecture, and credential-free tests without granting camera or native automation access.

## Before the demo

1. Follow the [README setup](../README.md#quick-start). Configure one working AI provider. If using only Ollama for camera analysis, use a vision-capable model and `VISION_MODE=local-only`.
2. Open `http://127.0.0.1:8765` in a browser with speech recognition support if demonstrating voice.
3. Use an ordinary object such as a mug. Keep personal documents and other people out of the camera view.
4. Check `http://127.0.0.1:8765/api/status` for configured provider names. This endpoint does not perform a provider health check.

## Suggested three-minute walkthrough

| Step | Action | What it demonstrates |
| --- | --- | --- |
| 1. Workspace | Show the chat, top Mac controls, and Focus / Fullscreen buttons. | Interface layout and browser interaction. |
| 2. Chat | Ask “Explain what an API is in two sentences.” Then ask “Give me an example.” | Provider response and recent conversation context. |
| 3. Voice | Click Start listening and speak a question. Wait for the response. | Browser recognition, synthesis, and speech-event illumination. |
| 4. Vision | Start camera, allow access, and hold up a mug. Ask “What am I holding?” then “What color is it?” | Fresh snapshots attached to questions and visual follow-ups. |
| 5. Lifecycle | Pause background analysis, then stop the camera. | Explicit sharing controls and cleanup. Pausing background analysis alone does not disable camera context for questions. |
| 6. Mac bridge | Open Mac controls, select Calculator, and approve the launch. | Explicit user action through an allowlisted native operation. |
| 7. Memory | Type “Remember that I prefer concise answers.” Inspect the entry in Mac controls, then delete it. | Persistent local data with visible user control. |

Background observations are sampled after requests finish; they are not a live video stream. Avoid promising fixed model latency or perfect visual recognition during a demo.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Chat returns a provider error | Confirm the Gemini key and model are valid for your account, or that Ollama is running and the configured model is downloaded. |
| Text works but camera analysis fails | Use a vision-capable provider. The example `llama3.2` configuration is for text, not image input. |
| Camera permission is denied | Allow access in browser site settings and macOS Privacy & Security → Camera. Open the app through localhost rather than a file URL. |
| Camera is busy or missing | Close other camera apps, connect the device, and retry Start camera. |
| Speech input is unavailable | Try a browser that supports SpeechRecognition; typed chat remains available. Browser and OS microphone permissions are separate. |
| No automatic observation appears | Keep the tab visible, resume analysis if paused, and allow time for provider inference. Background work defers to chat. |
| Native app action fails | Run on macOS and inspect system automation permissions. Calendar operations expect a calendar named `Calendar`; Notes operations expect a `Notes` folder. |
| Weather shows N/A | Set both weather coordinates in `.env`; weather is optional. |
| Updated controls are missing | Refresh the page and restart Flask after backend changes. Local template reloading is enabled. |

## Recording a portfolio demo

A short recording should show real responses and interaction: one text exchange, one object question with a follow-up, and one approved Mac action. Explain where browser state, model calls, and native actions live. Keep provider errors visible if they occur; discuss fallback and limitations rather than editing them into claimed reliability metrics.

The README screenshot is an actual browser capture of the idle interface. It is not evidence of model accuracy, a recorded camera session, or a performance benchmark.
