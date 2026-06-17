import React, { useState, useEffect, useRef } from "react";
import { Play, Square, Pause, Clipboard, Volume2, HelpCircle, ChevronDown, ChevronUp, Settings, Edit3, Palette } from "lucide-react";

// Themes configuration
const THEMES = {
  light: { label: "ライト" },
  dark: { label: "ダーク" },
  pastel: { label: "モノトーン" },
  brown: { label: "ブラウン" },
  ocean: { label: "オーシャン" }
};

const FONTS = {
  mono: { label: "Monospace", css: "'Courier New',Consolas,monospace" },
  roboto: { label: "Roboto", css: "Roboto,Arial,sans-serif" },
  noto: { label: "Noto Sans JP", css: "'Noto Sans JP','Hiragino Kaku Gothic ProN',sans-serif" },
  rounded: { label: "丸ゴシック", css: "'M PLUS Rounded 1c','Hiragino Maru Gothic Pro',sans-serif" }
};

export default function App() {
  // Load settings from localStorage
  const [theme, setTheme] = useState(() => localStorage.getItem("aist-tts-theme") || "dark");
  const [font, setFont] = useState(() => localStorage.getItem("aist-tts-font") || "mono");
  const [fontSize, setFontSize] = useState(() => parseInt(localStorage.getItem("aist-tts-font-size") || "11"));
  const [activeTab, setActiveTab] = useState(() => localStorage.getItem("aist-tts-active-tab") || "voice");

  // Collapsible states (default to collapsed)
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [isTextareaExpanded, setIsTextareaExpanded] = useState(false);

  const [textToRead, setTextToRead] = useState("");
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceIdx, setSelectedVoiceIdx] = useState<number>(0);
  
  // Presets state
  const [currentPreset, setCurrentPreset] = useState(() => localStorage.getItem("aist-tts-preset-active") || "A");
  const [presetALabel, setPresetALabel] = useState(() => localStorage.getItem("aist-tts-preset-a-label") || "ボイス A");
  const [presetBLabel, setPresetBLabel] = useState(() => localStorage.getItem("aist-tts-preset-b-label") || "ボイス B");
  const [tempPresetLabel, setTempPresetLabel] = useState("");

  // Sync temporary input label when active preset or labels change
  useEffect(() => {
    setTempPresetLabel(currentPreset === "A" ? presetALabel : presetBLabel);
  }, [currentPreset, presetALabel, presetBLabel]);

  // Temporary local state for sliders that syncs with current preset
  const [speed, setSpeed] = useState(() => {
    const active = localStorage.getItem("aist-tts-preset-active") || "A";
    const prefix = `aist-tts-preset-${active.toLowerCase()}-`;
    return parseFloat(localStorage.getItem(prefix + "speed") || "1.2");
  });
  const [pitch, setPitch] = useState(() => {
    const active = localStorage.getItem("aist-tts-preset-active") || "A";
    const prefix = `aist-tts-preset-${active.toLowerCase()}-`;
    return parseFloat(localStorage.getItem(prefix + "pitch") || "1.0");
  });
  const [volume, setVolume] = useState(() => {
    const active = localStorage.getItem("aist-tts-preset-active") || "A";
    const prefix = `aist-tts-preset-${active.toLowerCase()}-`;
    return parseInt(localStorage.getItem(prefix + "volume") || "80");
  });

  const [status, setStatus] = useState("待機中");
  const [isPaused, setIsPaused] = useState(false);

  const ttsGeneration = useRef(0);
  const speechQueue = useRef<string[]>([]);

  // Apply Theme & Fonts to HTML elements
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("aist-tts-theme", theme);
  }, [theme]);

  // Reset collapse state when switching tabs
  useEffect(() => {
    setIsCollapsed(true);
  }, [activeTab]);

  useEffect(() => {
    const f = FONTS[font as keyof typeof FONTS] || FONTS.mono;
    document.documentElement.style.setProperty("--font-family-current", f.css);
    localStorage.setItem("aist-tts-font", font);
  }, [font]);

  useEffect(() => {
    document.documentElement.style.setProperty("--font-size-current", `${fontSize}px`);
    localStorage.setItem("aist-tts-font-size", String(fontSize));
  }, [fontSize]);

  useEffect(() => {
    localStorage.setItem("aist-tts-active-tab", activeTab);
  }, [activeTab]);

  // Save active preset settings when sliders change
  useEffect(() => {
    const prefix = `aist-tts-preset-${currentPreset.toLowerCase()}-`;
    localStorage.setItem(prefix + "speed", String(speed));
  }, [speed, currentPreset]);

  useEffect(() => {
    const prefix = `aist-tts-preset-${currentPreset.toLowerCase()}-`;
    localStorage.setItem(prefix + "pitch", String(pitch));
  }, [pitch, currentPreset]);

  useEffect(() => {
    const prefix = `aist-tts-preset-${currentPreset.toLowerCase()}-`;
    localStorage.setItem(prefix + "volume", String(volume));
  }, [volume, currentPreset]);

  useEffect(() => {
    localStorage.setItem("aist-tts-preset-a-label", presetALabel);
  }, [presetALabel]);

  useEffect(() => {
    localStorage.setItem("aist-tts-preset-b-label", presetBLabel);
  }, [presetBLabel]);

  // Sync selected voice name to preset
  useEffect(() => {
    if (voices[selectedVoiceIdx]) {
      const prefix = `aist-tts-preset-${currentPreset.toLowerCase()}-`;
      localStorage.setItem(prefix + "voice", voices[selectedVoiceIdx].name);
    }
  }, [selectedVoiceIdx, voices, currentPreset]);

  // Load voices list
  useEffect(() => {
    const loadVoicesList = () => {
      const all = window.speechSynthesis.getVoices();
      let jaVoices = all.filter(v => /ja|JP/i.test(v.lang));
      if (!jaVoices.length) jaVoices = all;
      setVoices(jaVoices);

      const active = localStorage.getItem("aist-tts-preset-active") || "A";
      const prefix = `aist-tts-preset-${active.toLowerCase()}-`;
      const savedName = localStorage.getItem(prefix + "voice") || "";
      let idx = jaVoices.findIndex(v => v.name === savedName);
      
      if (idx < 0 && !savedName) {
        // Fallback defaults for Ichiro / Haruka
        if (active === "A") {
          idx = jaVoices.findIndex(v => /haruka/i.test(v.name));
        } else {
          idx = jaVoices.findIndex(v => /ichiro/i.test(v.name));
        }
      }
      if (idx < 0) idx = 0;
      setSelectedVoiceIdx(idx);
    };

    if (window.speechSynthesis.getVoices().length === 0) {
      window.speechSynthesis.onvoiceschanged = loadVoicesList;
    } else {
      loadVoicesList();
    }

    return () => {
      window.speechSynthesis.cancel();
    };
  }, []);

  const switchPreset = (presetName: string) => {
    // Save current parameters to the active preset before switching
    const prefixOld = `aist-tts-preset-${currentPreset.toLowerCase()}-`;
    localStorage.setItem(prefixOld + "speed", String(speed));
    localStorage.setItem(prefixOld + "pitch", String(pitch));
    localStorage.setItem(prefixOld + "volume", String(volume));
    if (voices[selectedVoiceIdx]) {
      localStorage.setItem(prefixOld + "voice", voices[selectedVoiceIdx].name);
    }

    // Switch active state
    setCurrentPreset(presetName);
    localStorage.setItem("aist-tts-preset-active", presetName);

    // Load new preset parameters
    const prefixNew = `aist-tts-preset-${presetName.toLowerCase()}-`;
    const newSpeed = parseFloat(localStorage.getItem(prefixNew + "speed") || "1.2");
    const newPitch = parseFloat(localStorage.getItem(prefixNew + "pitch") || "1.0");
    const newVolume = parseInt(localStorage.getItem(prefixNew + "volume") || "80");
    const newVoiceName = localStorage.getItem(prefixNew + "voice") || "";

    setSpeed(newSpeed);
    setPitch(newPitch);
    setVolume(newVolume);

    if (newVoiceName) {
      const idx = voices.findIndex(v => v.name === newVoiceName);
      if (idx >= 0) {
        setSelectedVoiceIdx(idx);
      }
    } else {
      // Defaults fallback
      let idx = -1;
      if (presetName === "A") {
        idx = voices.findIndex(v => /haruka/i.test(v.name));
      } else {
        idx = voices.findIndex(v => /ichiro/i.test(v.name));
      }
      if (idx >= 0) setSelectedVoiceIdx(idx);
    }
  };

  const handleSavePresetName = () => {
    if (currentPreset === "A") {
      setPresetALabel(tempPresetLabel);
    } else {
      setPresetBLabel(tempPresetLabel);
    }
  };

  const handleVoiceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const idx = parseInt(e.target.value);
    setSelectedVoiceIdx(idx);
  };

  // Text chunking for Web Speech API stability
  const splitIntoChunks = (text: string, maxLen = 180): string[] => {
    const sentences = text.split(/(?<=[。！？\n])/);
    const chunks: string[] = [];
    let cur = "";
    sentences.forEach(s => {
      if ((cur + s).length > maxLen && cur) {
        chunks.push(cur);
        cur = s;
      } else {
        cur += s;
      }
      while (cur.length > maxLen) {
        chunks.push(cur.slice(0, maxLen));
        cur = cur.slice(maxLen);
      }
    });
    if (cur.trim()) chunks.push(cur);
    return chunks.filter(c => c.trim().length);
  };

  const playNextChunk = (gen: number) => {
    if (gen !== ttsGeneration.current) return;
    if (!speechQueue.current.length) {
      setStatus("待機中");
      return;
    }
    const chunk = speechQueue.current.shift()!;
    const utter = new SpeechSynthesisUtterance(chunk);
    
    // Apply configs
    const selectedVoice = voices[selectedVoiceIdx];
    if (selectedVoice) {
      utter.voice = selectedVoice;
      utter.lang = selectedVoice.lang || "ja-JP";
    } else {
      utter.lang = "ja-JP";
    }
    utter.rate = speed;
    utter.pitch = pitch;
    utter.volume = volume / 100;

    utter.onend = utter.onerror = () => {
      if (gen === ttsGeneration.current) {
        playNextChunk(gen);
      }
    };

    window.speechSynthesis.speak(utter);
  };

  const startSpeaking = (text: string) => {
    if (!text || !text.trim()) return;
    const chunks = splitIntoChunks(text);
    if (!chunks.length) return;

    ttsGeneration.current++;
    const gen = ttsGeneration.current;
    window.speechSynthesis.cancel();
    speechQueue.current = chunks;
    setStatus("再生中");
    setIsPaused(false);

    // Firefox/Safari delay safety
    setTimeout(() => playNextChunk(gen), 150);
  };

  const stopSpeaking = () => {
    ttsGeneration.current++;
    window.speechSynthesis.cancel();
    speechQueue.current = [];
    setStatus("待機中");
    setIsPaused(false);
  };

  const togglePause = () => {
    if (status === "待機中") return;
    if (isPaused) {
      window.speechSynthesis.resume();
      setIsPaused(false);
      setStatus("再生中");
    } else {
      window.speechSynthesis.pause();
      setIsPaused(true);
      setStatus("一時停止中");
    }
  };

  // Clipboard Reading function
  const readClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text || !text.trim()) {
        alert("クリップボードにテキストがありません。");
        return;
      }
      setTextToRead(text);
      startSpeaking(text);
    } catch (e: any) {
      alert("クリップボードの読み取りに失敗しました。ブラウザの権限設定を確認してください。\n" + e.message);
    }
  };

  return (
    <div className="app-card">
      {/* Header */}
      <div className="app-header">
        <span className="header-title">
          <Volume2 size={13} style={{ color: "var(--bg-btn-primary)" }} />
          SOLID TTS CLIPBOARD READER
        </span>
        <span className="status-badge">
          {status}
        </span>
      </div>

      {/* Tabs */}
      <div className="tabs-container">
        <button
          onClick={() => setActiveTab("voice")}
          className="tab-button"
          style={{
            background: activeTab === "voice" ? "var(--bg-tab-active)" : "var(--bg-tab-inactive)",
            color: activeTab === "voice" ? "var(--text-tab-active)" : "var(--text-tab-inactive)"
          }}
        >
          音声コントロール
        </button>
        <button
          onClick={() => setActiveTab("theme")}
          className="tab-button"
          style={{
            background: activeTab === "theme" ? "var(--bg-tab-active)" : "var(--bg-tab-inactive)",
            color: activeTab === "theme" ? "var(--text-tab-active)" : "var(--text-tab-inactive)"
          }}
        >
          テーマ＆フォント
        </button>
      </div>

      {/* Main Panel Content */}
      <div className="panel-content">
        {activeTab === "voice" ? (
          <div className="tab-pane">
            {/* Preset select strip */}
            <div className="preset-strip">
              <button
                onClick={() => switchPreset("A")}
                className={`preset-btn ${currentPreset === "A" ? "active" : ""}`}
              >
                {presetALabel}
              </button>
              <button
                onClick={() => switchPreset("B")}
                className={`preset-btn ${currentPreset === "B" ? "active" : ""}`}
              >
                {presetBLabel}
              </button>
            </div>

            {/* Quick clipboard button - Always visible at the top */}
            <button onClick={readClipboard} className="btn-primary">
              <Clipboard size={14} />
              📋 クリップボードを読み上げる
            </button>

            {/* Actions grid (Play, Pause, Stop) - Always Visible */}
            <div className="actions-strip">
              <button
                onClick={() => startSpeaking(textToRead)}
                disabled={!textToRead.trim()}
                className="btn-action"
              >
                <Play size={11} />
                再生
              </button>
              <button
                onClick={togglePause}
                disabled={status === "待機中"}
                className="btn-action"
              >
                <Pause size={11} />
                {isPaused ? "再開" : "一時停止"}
              </button>
              <button
                onClick={stopSpeaking}
                className="btn-action btn-stop"
              >
                <Square size={11} />
                全停止
              </button>
            </div>

            {/* Textarea collapse toggle */}
            <button
              onClick={() => setIsTextareaExpanded(!isTextareaExpanded)}
              className="btn-action"
              style={{
                width: "100%",
                marginTop: "4px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "6px",
                borderStyle: "dashed",
                borderColor: "var(--border-btn-secondary)"
              }}
            >
              <Edit3 size={11} />
              {isTextareaExpanded ? "✏️ テキスト入力欄を閉じる" : "✏️ テキスト入力欄を展開"}
              {isTextareaExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>

            {/* Input area - stretches to fill available height when expanded */}
            {isTextareaExpanded && (
              <div className="text-area-container">
                <label className="field-label">
                  読み上げテキスト
                </label>
                <textarea
                  value={textToRead}
                  onChange={(e) => setTextToRead(e.target.value)}
                  placeholder="ここにテキストを入力するか、貼り付けて再生してください..."
                  className="textarea-field"
                />
              </div>
            )}

            {/* Collapsible settings toggle button */}
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="btn-action"
              style={{
                width: "100%",
                marginTop: "4px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "6px",
                borderStyle: "dashed",
                borderColor: "var(--border-btn-secondary)"
              }}
            >
              <Settings size={11} />
              {isCollapsed ? "⚙️ 詳細設定を展開 (ボイス・話速)" : "⚙️ 詳細設定を閉じる"}
              {isCollapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
            </button>

            {/* Collapsible Content Section */}
            {!isCollapsed && (
              <div className="space-y-4" style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "8px" }}>
                {/* Settings controls */}
                <div className="settings-grid" style={{ paddingTop: "12px" }}>
                  {/* Voice select */}
                  <div className="setting-row">
                    <label className="field-label">ボイス</label>
                    <select
                      value={selectedVoiceIdx}
                      onChange={handleVoiceChange}
                      className="select-field"
                    >
                      {voices.map((v, i) => (
                        <option key={i} value={i}>
                          {v.name} ({v.lang})
                        </option>
                      ))}
                      {!voices.length && <option value="0">音声読み込み中...</option>}
                    </select>
                  </div>

                  {/* Speed slider */}
                  <div className="setting-row">
                    <div className="setting-label-row">
                      <span>話速</span>
                      <span>{speed.toFixed(1)}x</span>
                    </div>
                    <input
                      type="range"
                      min="0.5"
                      max="3.0"
                      step="0.1"
                      value={speed}
                      onChange={(e) => setSpeed(parseFloat(e.target.value))}
                    />
                  </div>

                  {/* Pitch slider */}
                  <div className="setting-row">
                    <div className="setting-label-row">
                      <span>ピッチ (高低)</span>
                      <span>{pitch.toFixed(1)}x</span>
                    </div>
                    <input
                      type="range"
                      min="0.5"
                      max="2.0"
                      step="0.1"
                      value={pitch}
                      onChange={(e) => setPitch(parseFloat(e.target.value))}
                    />
                  </div>

                  {/* Volume slider */}
                  <div className="setting-row">
                    <div className="setting-label-row">
                      <span>音量</span>
                      <span>{volume}%</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={volume}
                      onChange={(e) => setVolume(parseInt(e.target.value))}
                    />
                  </div>

                  {/* Preset Label Rename */}
                  <div className="setting-row">
                    <label className="field-label">選択中のプリセット名</label>
                    <div style={{ display: "flex", gap: "8px", width: "100%" }}>
                      <input
                        type="text"
                        className="select-field"
                        style={{ flex: 1, padding: "6px 10px", boxSizing: "border-box" }}
                        value={tempPresetLabel}
                        onChange={(e) => setTempPresetLabel(e.target.value)}
                        placeholder="新しいプリセット名..."
                      />
                      <button
                        onClick={handleSavePresetName}
                        className="btn-action"
                        style={{
                          flexShrink: 0,
                          padding: "6px 12px",
                          borderStyle: "solid",
                          borderColor: "var(--bg-btn-primary)",
                          color: "var(--bg-btn-primary)"
                        }}
                      >
                        決定
                      </button>
                    </div>
                  </div>
                </div>

                {/* Info Box */}
                <div className="info-alert">
                  <HelpCircle size={12} style={{ flexShrink: 0, marginTop: "1px" }} />
                  <span>
                    「クリップボードを読み上げる」はコピーした文章を自動取得して再生します。入力ボックスへ貼り付け・直接編集して通常の「再生」を行うことも可能です。
                  </span>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="tab-pane">
            {/* Collapsible themes toggle button */}
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="btn-action"
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "6px",
                borderStyle: "dashed",
                borderColor: "var(--border-btn-secondary)"
              }}
            >
              <Palette size={11} />
              {isCollapsed ? "⚙️ テーマ・フォント設定を展開" : "⚙️ テーマ・フォント設定を閉じる"}
              {isCollapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
            </button>

            {!isCollapsed && (
              <div className="space-y-4" style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "8px" }}>
                {/* Theme select */}
                <div className="setting-row">
                  <label className="field-label" style={{ marginBottom: "6px" }}>
                    カラーテーマ
                  </label>
                  <div className="themes-grid">
                    {Object.entries(THEMES).map(([key, item]) => (
                      <button
                        key={key}
                        onClick={() => setTheme(key)}
                        className="theme-button"
                        style={{
                          background: theme === key ? "var(--bg-btn-primary)" : "var(--bg-btn-secondary)",
                          color: theme === key ? "var(--text-btn-primary)" : "var(--text-btn-secondary)",
                          borderColor: theme === key ? "transparent" : "var(--border-btn-secondary)",
                          outline: theme === key ? "2px solid var(--bg-btn-primary)" : "none"
                        }}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Font selector */}
                <div className="setting-row">
                  <label className="field-label">パネルのフォント</label>
                  <select
                    value={font}
                    onChange={(e) => setFont(e.target.value)}
                    className="select-field"
                  >
                    {Object.entries(FONTS).map(([key, item]) => (
                      <option key={key} value={key}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Font Size Selector */}
                <div className="setting-row">
                  <label className="field-label">文字サイズ</label>
                  <select
                    value={fontSize}
                    onChange={(e) => setFontSize(parseInt(e.target.value))}
                    className="select-field"
                  >
                    <option value="9">9px (小)</option>
                    <option value="10">10px</option>
                    <option value="11">11px (標準)</option>
                    <option value="12">12px</option>
                    <option value="13">13px (大)</option>
                  </select>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
