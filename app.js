(function () {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  const toggleButton = document.getElementById("toggleButton");
  const windowInput = document.getElementById("windowSeconds");
  const statusEl = document.getElementById("status");
  const dialReadingEl = document.getElementById("dialReading");
  const wordCountEl = document.getElementById("wordCount");
  const recentTranscriptEl = document.getElementById("recentTranscript");
  const barAngloEl = document.getElementById("barAnglo");
  const barLatinateEl = document.getElementById("barLatinate");
  const angloCountEl = document.getElementById("angloCount");
  const latinateCountEl = document.getElementById("latinateCount");
  const angloWordsEl = document.getElementById("angloWords");
  const latinateWordsEl = document.getElementById("latinateWords");

  const DEFAULT_WINDOW_SECONDS = 60;
  const segments = [];
  const classifiedWords = [];
  let interimText = "";
  let listening = false;
  let recognition = null;
  let restartTimer = null;

  const ANGLO_WORDS = new Set([
    "ask", "back", "bad", "bear", "become", "begin", "big", "birth", "bit", "black",
    "blame", "bleed", "blow", "blue", "body", "bone", "book", "break", "broad", "brother",
    "burn", "call", "care", "carry", "catch", "child", "choose", "cold", "come", "cook",
    "deal", "deep", "do", "dog", "draw", "drink", "drive", "eat", "end", "fall",
    "fast", "father", "feel", "fight", "find", "fire", "folk", "follow", "foot", "forgive",
    "friend", "give", "go", "good", "great", "green", "grow", "hand", "hard", "have",
    "head", "help", "hide", "hold", "home", "hope", "house", "keep", "kind", "king",
    "know", "land", "last", "learn", "leave", "let", "life", "light", "live", "long",
    "look", "love", "make", "man", "meet", "mother", "name", "night", "old", "right",
    "rise", "room", "run", "say", "see", "seek", "send", "set", "ship", "short",
    "show", "sing", "sit", "sleep", "small", "speak", "stand", "star", "start", "stay",
    "stone", "strong", "sun", "take", "talk", "tell", "think", "throw", "time", "true",
    "trust", "understand", "walk", "want", "warm", "wash", "watch", "way", "wear", "west",
    "wife", "will", "win", "wind", "wise", "woman", "work", "world", "write", "year"
  ]);

  const LATINATE_WORDS = new Set([
    "abundant", "abstract", "accelerate", "accommodate", "accumulate", "accurate", "activate", "adequate", "adjacent", "administration",
    "advocate", "aggregate", "allocate", "ambiguous", "annual", "anticipate", "apparent", "appreciate", "appropriate", "approximate",
    "argument", "articulate", "assist", "assume", "attribute", "authoritative", "beneficial", "capacity", "categorize", "circumstance",
    "clarify", "coherent", "collaborate", "communicate", "complex", "comprehensive", "conceptual", "conclude", "concrete", "configure",
    "considerable", "consistent", "constitute", "construct", "context", "continuous", "contribute", "conventional", "coordinate", "corporate",
    "credible", "critical", "cultivate", "deactivate", "decimal", "declare", "definitive", "demonstrate", "derive", "designate",
    "detailed", "determine", "differentiate", "dimension", "distribute", "document", "dominate", "duration", "effective", "elaborate",
    "eliminate", "emphasize", "enable", "encounter", "equivalent", "evaluate", "evidence", "evolve", "explicit", "facilitate",
    "fundamental", "generate", "identical", "illustrate", "implement", "imply", "impose", "incentive", "incorporate", "indicate",
    "individual", "inevitable", "influence", "informative", "initiate", "innovative", "integrate", "intellectual", "interact", "interpret",
    "interval", "justify", "legitimate", "maintain", "manipulate", "maximize", "mediate", "minimize", "modify", "objective",
    "obtain", "optimal", "parallel", "participate", "perceive", "perspective", "positive", "precise", "predict", "preliminary",
    "preserve", "primary", "prioritize", "procedure", "process", "professional", "project", "proportion", "protocol", "qualitative",
    "quantitative", "rational", "reactivate", "regulate", "relevant", "representative", "resource", "restrict", "separate", "significant",
    "similar", "simulate", "specify", "stabilize", "strategy", "sufficient", "summarize", "supervise", "sustain", "technical",
    "transform", "transmit", "ultimate", "validate", "variable", "verbalize", "viable", "visualize"
  ]);

  const LATINATE_SUFFIXES = [
    "ation", "ition", "tion", "sion", "ment", "ence", "ance", "ity", "ive", "ous",
    "al", "ary", "ory", "ent", "ant", "ize", "ise", "ify", "ate", "ible", "able"
  ];

  const LATINATE_PREFIXES = [
    "inter", "trans", "super", "sub", "pre", "post", "multi", "uni", "re", "de",
    "con", "com", "pro", "intra", "extra", "circum", "contra"
  ];

  // Germanic / Anglo-Saxon affixes (used as heuristic fallback for unlisted words)
  const ANGLO_SUFFIXES = [
    "ness", "dom", "ship", "hood", "ful", "less", "ward", "ish"
  ];

  const ANGLO_PREFIXES = [
    "un", "mis", "over", "under", "out", "fore", "with"
  ];

  const NEUTRAL_COMMON = new Set([
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from",
    "i", "if", "in", "into", "is", "it", "me", "my", "of", "on",
    "or", "our", "so", "that", "the", "their", "them", "then", "there", "these",
    "they", "this", "to", "we", "with", "you", "your"
  ]);

  // Load extended etymology dataset generated by scripts/build-wordlist.js.
  // Merges into the existing Sets so the hardcoded words act as an immediate
  // fallback while the fetch completes (or if it fails entirely).
  fetch("data/etymology.json")
    .then(r => r.json())
    .then(data => {
      (data.g || []).forEach(w => ANGLO_WORDS.add(w));
      (data.l || []).forEach(w => LATINATE_WORDS.add(w));
    })
    .catch(() => { /* silently use hardcoded fallback */ });

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function getWindowMs() {
    const parsed = Number(windowInput.value);
    if (!Number.isFinite(parsed)) {
      windowInput.value = String(DEFAULT_WINDOW_SECONDS);
      return DEFAULT_WINDOW_SECONDS * 1000;
    }
    const normalized = clamp(Math.round(parsed), 10, 600);
    if (normalized !== parsed) {
      windowInput.value = String(normalized);
    }
    return normalized * 1000;
  }

  function pruneSegments() {
    const cutoff = Date.now() - getWindowMs();
    while (segments.length > 0 && segments[0].timestamp < cutoff) {
      segments.shift();
    }
  }

  function pruneClassifiedWords() {
    const cutoff = Date.now() - getWindowMs();
    while (classifiedWords.length > 0 && classifiedWords[0].timestamp < cutoff && !classifiedWords[0].fading) {
      const entry = classifiedWords[0];
      entry.fading = true;
      entry.el.classList.add("fading");
      entry.el.addEventListener("transitionend", () => { entry.el.remove(); }, { once: true });
      setTimeout(() => { entry.el.remove(); }, 700);
      classifiedWords.shift();
    }
  }

  function addClassifiedWord(word, timestamp) {
    const score = classifyWord(word);
    if (score.anglo === 0 && score.latinate === 0) return;

    const origin = score.anglo >= score.latinate ? "anglo" : "latinate";
    const effectiveScore = Math.max(score.anglo, score.latinate);

    const pill = document.createElement("span");
    pill.className = "word-pill";
    pill.textContent = word;

    const container = origin === "anglo" ? angloWordsEl : latinateWordsEl;
    container.appendChild(pill);
    container.scrollTop = container.scrollHeight;

    classifiedWords.push({ word, origin, score: effectiveScore, timestamp, el: pill, fading: false });
  }

  function tokenize(inputText) {
    return inputText
      .toLowerCase()
      .replace(/[^a-z'\s]/g, " ")
      .split(/\s+/)
      .map((word) => word.replace(/^'+|'+$/g, ""))
      .filter(Boolean);
  }

  function classifyWord(word) {
    if (NEUTRAL_COMMON.has(word)) {
      return { anglo: 0, latinate: 0 };
    }

    if (LATINATE_WORDS.has(word)) {
      return { anglo: 0, latinate: 1 };
    }
    if (ANGLO_WORDS.has(word)) {
      return { anglo: 1, latinate: 0 };
    }

    // Suffix matching (more decisive than prefixes — check first)
    const hasLatinateSuffix = LATINATE_SUFFIXES.some((s) => word.endsWith(s) && word.length > s.length + 2);
    const hasAngloSuffix = ANGLO_SUFFIXES.some((s) => word.endsWith(s) && word.length > s.length + 2);

    if (hasLatinateSuffix && !hasAngloSuffix) return { anglo: 0, latinate: 0.7 };
    if (hasAngloSuffix && !hasLatinateSuffix) return { anglo: 0.7, latinate: 0 };

    // Prefix matching (fallback when no suffix signal)
    if (!hasLatinateSuffix && !hasAngloSuffix) {
      const hasLatinatePrefix = LATINATE_PREFIXES.some((p) => word.startsWith(p) && word.length > p.length + 2);
      const hasAngloPrefix = ANGLO_PREFIXES.some((p) => word.startsWith(p) && word.length > p.length + 2);

      if (hasLatinatePrefix && !hasAngloPrefix) return { anglo: 0, latinate: 0.7 };
      if (hasAngloPrefix && !hasLatinatePrefix) return { anglo: 0.7, latinate: 0 };
    }

    if (word.length <= 4) {
      return { anglo: 0.25, latinate: 0 };
    }

    return { anglo: 0, latinate: 0 };
  }

  function analyzeRecentSpeech() {
    pruneSegments();
    pruneClassifiedWords();

    const recentText = segments.map((segment) => segment.text).join(" ");

    const totals = classifiedWords.reduce(
      (acc, entry) => {
        if (entry.origin === "anglo") acc.anglo += entry.score;
        else acc.latinate += entry.score;
        return acc;
      },
      { anglo: 0, latinate: 0 }
    );

    // Include interim text for responsiveness without creating persistent pills
    if (interimText) {
      tokenize(interimText).forEach((word) => {
        const s = classifyWord(word);
        totals.anglo += s.anglo;
        totals.latinate += s.latinate;
      });
    }

    const classified = totals.anglo + totals.latinate;
    if (classified < 0.001) {
      return { balance: 0, label: "Balanced", classifiedWords: 0, transcript: recentText, angloScore: 0, latinateScore: 0 };
    }

    const balance = (totals.latinate - totals.anglo) / classified;
    const label =
      balance <= -0.35
        ? "Anglo-Saxon leaning"
        : balance >= 0.35
          ? "Latinate leaning"
          : "Balanced";

    return {
      balance,
      label,
      classifiedWords: Math.round(classified),
      transcript: recentText,
      angloScore: totals.anglo,
      latinateScore: totals.latinate
    };
  }

  function renderAnalysis() {
    const analysis = analyzeRecentSpeech();
    const total = analysis.angloScore + analysis.latinateScore;
    const angloPct = total > 0 ? (analysis.angloScore / total) * 100 : 0;
    const latinatePct = total > 0 ? (analysis.latinateScore / total) * 100 : 0;

    barAngloEl.style.height = `${angloPct.toFixed(1)}%`;
    barLatinateEl.style.height = `${latinatePct.toFixed(1)}%`;

    angloCountEl.textContent = String(classifiedWords.filter((w) => w.origin === "anglo").length);
    latinateCountEl.textContent = String(classifiedWords.filter((w) => w.origin === "latinate").length);

    dialReadingEl.textContent = analysis.label;
    wordCountEl.textContent = String(analysis.classifiedWords);
    recentTranscriptEl.textContent = analysis.transcript || "No speech captured yet.";
  }

  function setStatus(text, isError) {
    statusEl.textContent = `Status: ${text}`;
    statusEl.classList.toggle("error", Boolean(isError));
  }

  function attachRecognitionHandlers(instance) {
    instance.onstart = () => {
      setStatus("listening");
    };

    instance.onerror = (event) => {
      setStatus(`error (${event.error})`, true);
    };

    instance.onend = () => {
      if (listening) {
        // Auto-restart so recognition can continue after browser pauses.
        clearTimeout(restartTimer);
        restartTimer = setTimeout(() => {
          try {
            instance.start();
          } catch (_) {
            setStatus("restarting recognizer...");
          }
        }, 250);
      } else {
        setStatus("stopped");
      }
    };

    instance.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = result[0].transcript.trim();
        if (!transcript) {
          continue;
        }
        if (result.isFinal) {
          const now = Date.now();
          segments.push({ timestamp: now, text: transcript });
          tokenize(transcript).forEach((w) => addClassifiedWord(w, now));
          interimText = "";
        } else {
          interimText = transcript;
        }
      }
      renderAnalysis();
    };
  }

  function startListening() {
    if (!SpeechRecognition) {
      setStatus("Web Speech API unsupported in this browser", true);
      return;
    }
    if (!recognition) {
      recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";
      recognition.maxAlternatives = 1;
      attachRecognitionHandlers(recognition);
    }

    listening = true;
    toggleButton.textContent = "Stop Listening";
    toggleButton.setAttribute("aria-pressed", "true");
    setStatus("starting microphone...");
    try {
      recognition.start();
    } catch (_) {
      setStatus("recognizer is already active");
    }
  }

  function stopListening() {
    listening = false;
    interimText = "";
    clearTimeout(restartTimer);
    toggleButton.textContent = "Start Listening";
    toggleButton.setAttribute("aria-pressed", "false");
    classifiedWords.forEach((entry) => entry.el.remove());
    classifiedWords.length = 0;
    if (recognition) {
      recognition.stop();
    } else {
      setStatus("stopped");
    }
    renderAnalysis();
  }

  toggleButton.addEventListener("click", () => {
    if (listening) {
      stopListening();
      return;
    }
    startListening();
  });

  windowInput.addEventListener("change", () => {
    getWindowMs();
    renderAnalysis();
  });

  setInterval(renderAnalysis, 1000);
  renderAnalysis();
})();
