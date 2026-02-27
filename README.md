# Anglo-Saxon vs Latinate Dial

A browser app that listens to your microphone and shows a live dial from **Anglo-Saxon** to **Latinate** based on your most recent speech.

## Features

- Microphone listening in-browser (Web Speech API).
- Rolling analysis window (default: 60 seconds, configurable).
- Live dial needle with `Anglo-Saxon`, `Balanced`, and `Latinate` bias.
- Running transcript view for the active window.

## Run

Because browser microphone APIs usually require an HTTP origin, run from a local server:

```powershell
python -m http.server 8000
```

Then open:

`http://localhost:8000`

## Notes

- Best support is in Chromium-based browsers (Chrome/Edge) with `webkitSpeechRecognition`.
- The score is heuristic, based on a small Anglo-Saxon/Latinate lexicon plus prefix/suffix cues.
