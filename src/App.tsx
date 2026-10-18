import React, { useState, useEffect, useRef } from "react";
import { Play, Square, Pause, Clipboard, Volume2, HelpCircle, ChevronDown, ChevronUp, Settings, Edit3, Palette, Video, Trash2, Eye, EyeOff, Maximize2, Minimize2 } from "lucide-react";

// Themes configuration
const THEMES = {
  light: { label: "ライト" },
  dark: { label: "ダーク" },
  pastel: { label: "モノトーン" },
  brown: { label: "ブラウン" },
  pink: { label: "パステルピンク" }
};

// ヘッダー＆ブラウザ/PWA theme-color 動的同期マッピング
const THEME_HEADER_COLORS: Record<string, string> = {
  light: "#f1f3f4",
  dark: "#1b1b2a",
  pastel: "#111111",
  brown: "#4c2c19",
  pink: "#3a2528",
  ocean: "#3a2528"
};

const FONTS = {
  mono: { label: "Monospace", css: "'Courier New',Consolas,monospace" },
  roboto: { label: "Roboto", css: "Roboto,Arial,sans-serif" },
  noto: { label: "Noto Sans JP", css: "'Noto Sans JP','Hiragino Kaku Gothic ProN',sans-serif" },
  rounded: { label: "丸ゴシック", css: "'M PLUS Rounded 1c','Hiragino Maru Gothic Pro',sans-serif" }
};

// IndexedDB for Avatar Videos (3 Slots)
const TTS_VID_DB_NAME = "solidTtsVideoDB";
const TTS_VID_STORE = "videos";
const VID_SLOT_COUNT = 3;
const vidSlotDbKey = (n: number) => `tts_vid_slot_blob_${n}`;

const openVidDB = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(TTS_VID_DB_NAME, 1);
    req.onupgradeneeded = (e) => (e.target as any).result.createObjectStore(TTS_VID_STORE);
    req.onsuccess = (e) => resolve((e.target as any).result);
    req.onerror = (e) => reject((e.target as any).error);
  });

const saveVidToDB = (file: File | Blob, slotN: number): Promise<void> =>
  openVidDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(TTS_VID_STORE, "readwrite");
        tx.objectStore(TTS_VID_STORE).put(file, vidSlotDbKey(slotN));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      })
  );

const loadVidFromDB = (slotN: number): Promise<Blob | null> =>
  openVidDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(TTS_VID_STORE, "readonly");
        const req = tx.objectStore(TTS_VID_STORE).get(vidSlotDbKey(slotN));
        req.onsuccess = (e) => resolve((e.target as any).result || null);
        req.onerror = () => reject(req.error);
      })
  );

const deleteVidFromDB = (slotN: number): Promise<void> =>
  openVidDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(TTS_VID_STORE, "readwrite");
        tx.objectStore(TTS_VID_STORE).delete(vidSlotDbKey(slotN));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      })
  );

export default function App() {
  // Load settings from localStorage
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem("aist-tts-theme") || "dark";
    return saved === "ocean" ? "pink" : saved;
  });
  const [font, setFont] = useState(() => localStorage.getItem("aist-tts-font") || "mono");
  const [fontSize, setFontSize] = useState(() => parseInt(localStorage.getItem("aist-tts-font-size") || "13"));
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
  const currentChunkText = useRef<string>("");
  const currentChunkCharIndex = useRef<number>(0);

  // =============================================
  // アバター動画（口パク動画）State & 制御
  // =============================================
  const getSlotVidSpeed = (slot: number) => {
    const v = localStorage.getItem(`solid-tts-vid-speed-slot-${slot}`);
    if (v) return parseFloat(v);
    const old = localStorage.getItem("solid-tts-vid-speed");
    return old ? parseFloat(old) : 1.25;
  };

  const [vidSlot, setVidSlot] = useState(() => {
    const v = parseInt(localStorage.getItem("solid-tts-vid-slot") || "0");
    return isNaN(v) || v < 0 || v >= VID_SLOT_COUNT ? 0 : v;
  });
  const [vidSpeed, setVidSpeed] = useState(() => getSlotVidSpeed(vidSlot));
  const [vidHeight, setVidHeight] = useState(() => parseInt(localStorage.getItem("solid-tts-vid-height") || "480"));
  const [vidFitMode, setVidFitMode] = useState<"auto" | "cover" | "contain">(() => (localStorage.getItem("solid-tts-vid-fit") as "auto" | "cover" | "contain") || "auto"); // デフォルト上下ノーカット全幅
  const [isVidCollapsed, setIsVidCollapsed] = useState(() => localStorage.getItem("solid-tts-vid-collapsed") === "1"); // 動画折りたたみ状態
  const [vidSyncEnabled, setVidSyncEnabled] = useState(() => localStorage.getItem("solid-tts-vid-sync") !== "0"); // デフォルトON
  const [vidVisible, setVidVisible] = useState(() => localStorage.getItem("solid-tts-vid-visible") !== "0"); // デフォルトON
  const [videoBlobUrl, setVideoBlobUrl] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 指定スロットの動画をIndexedDBからロード
  const loadSlotVideo = async (slotIdx: number) => {
    try {
      const blob = await loadVidFromDB(slotIdx);
      if (blob) {
        const url = URL.createObjectURL(blob);
        setVideoBlobUrl(url);
      } else {
        setVideoBlobUrl(null);
      }
    } catch (e) {
      setVideoBlobUrl(null);
    }
  };

  useEffect(() => {
    loadSlotVideo(vidSlot);
  }, [vidSlot]);

  // 動画速度の反映
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = vidSpeed;
    }
  }, [vidSpeed, videoBlobUrl]);

  // 動画表示高さの保存
  const changeVidHeight = (h: number) => {
    setVidHeight(h);
    localStorage.setItem("solid-tts-vid-height", String(h));
  };

  // 全幅フィット（auto: 上下ノーカット全幅 / cover: 枠内全幅カバー / contain: 全体収容）の切り替え
  const toggleVidFitMode = () => {
    const next = vidFitMode === "auto" ? "cover" : vidFitMode === "cover" ? "contain" : "auto";
    setVidFitMode(next);
    localStorage.setItem("solid-tts-vid-fit", next);
  };

  // 動画の折りたたみトグル
  const toggleVidCollapse = () => {
    setIsVidCollapsed(prev => {
      const next = !prev;
      localStorage.setItem("solid-tts-vid-collapsed", next ? "1" : "0");
      return next;
    });
  };

  // スロットごとの動画再生速度変更
  const handleVidSpeedChange = (spd: number) => {
    setVidSpeed(spd);
    localStorage.setItem(`solid-tts-vid-speed-slot-${vidSlot}`, String(spd));
    localStorage.setItem("solid-tts-vid-speed", String(spd));
    if (videoRef.current) {
      videoRef.current.playbackRate = spd;
    }
  };

  // スロット切り替え（スロットごとの再生速度も自動復元）
  const switchVidSlot = (idx: number) => {
    pauseAvatarVideo();
    setVidSlot(idx);
    localStorage.setItem("solid-tts-vid-slot", String(idx));
    const slotSpd = getSlotVidSpeed(idx);
    setVidSpeed(slotSpd);
    if (videoRef.current) {
      videoRef.current.playbackRate = slotSpd;
    }
  };

  // アバター動画の再生・一時停止処理
  const playAvatarVideo = () => {
    if (!vidSyncEnabled) return;
    const vid = videoRef.current;
    if (vid) {
      vid.muted = true;
      vid.loop = true;
      vid.playbackRate = vidSpeed;
      const p = vid.play();
      if (p && p.catch) p.catch(() => {});
    }
  };

  const pauseAvatarVideo = () => {
    const vid = videoRef.current;
    if (vid && !vid.paused) {
      vid.pause();
    }
  };

  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 200 * 1024 * 1024) {
      alert("200MBを超えるファイルは非対応です。");
      return;
    }
    const sizeMB = (file.size / 1024 / 1024).toFixed(1);
    try {
      await saveVidToDB(file, vidSlot);
      await loadSlotVideo(vidSlot);
      alert(`スロット${vidSlot + 1}に動画を保存しました（${sizeMB}MB）`);
    } catch (err: any) {
      alert("動画の保存に失敗しました: " + err.message);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDeleteVideo = async () => {
    if (!confirm(`スロット${vidSlot + 1}の動画を削除しますか？`)) return;
    pauseAvatarVideo();
    try {
      await deleteVidFromDB(vidSlot);
      setVideoBlobUrl(null);
    } catch (e) {}
  };

  const toggleVidSync = () => {
    const next = !vidSyncEnabled;
    setVidSyncEnabled(next);
    localStorage.setItem("solid-tts-vid-sync", next ? "1" : "0");
    if (!next) pauseAvatarVideo();
    else if (status === "再生中" && !isPaused) playAvatarVideo();
  };

  const toggleVidVisible = () => {
    const next = !vidVisible;
    setVidVisible(next);
    localStorage.setItem("solid-tts-vid-visible", next ? "1" : "0");
  };

  // Apply Theme & Fonts to HTML elements
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("aist-tts-theme", theme);

    // ブラウザ/PWA最上部ヘッダーの <meta name="theme-color"> を動的同期
    const headerColor = THEME_HEADER_COLORS[theme] || "#1b1b2a";
    let metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (!metaThemeColor) {
      metaThemeColor = document.createElement("meta");
      metaThemeColor.setAttribute("name", "theme-color");
      document.head.appendChild(metaThemeColor);
    }
    metaThemeColor.setAttribute("content", headerColor);
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
      let jaVoices = all.filter((v) => /ja|JP/i.test(v.lang));
      if (!jaVoices.length) jaVoices = all;
      setVoices(jaVoices);

      const active = localStorage.getItem("aist-tts-preset-active") || "A";
      const prefix = `aist-tts-preset-${active.toLowerCase()}-`;
      const savedName = localStorage.getItem(prefix + "voice") || "";
      let idx = jaVoices.findIndex((v) => v.name === savedName);

      if (idx < 0 && !savedName) {
        if (active === "A") {
          idx = jaVoices.findIndex((v) => /haruka/i.test(v.name));
        } else {
          idx = jaVoices.findIndex((v) => /ichiro/i.test(v.name));
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
      pauseAvatarVideo();
    };
  }, []);

  const switchPreset = (presetName: string) => {
    const prefixOld = `aist-tts-preset-${currentPreset.toLowerCase()}-`;
    localStorage.setItem(prefixOld + "speed", String(speed));
    localStorage.setItem(prefixOld + "pitch", String(pitch));
    localStorage.setItem(prefixOld + "volume", String(volume));
    if (voices[selectedVoiceIdx]) {
      localStorage.setItem(prefixOld + "voice", voices[selectedVoiceIdx].name);
    }

    setCurrentPreset(presetName);
    localStorage.setItem("aist-tts-preset-active", presetName);

    const prefixNew = `aist-tts-preset-${presetName.toLowerCase()}-`;
    const newSpeed = parseFloat(localStorage.getItem(prefixNew + "speed") || "1.2");
    const newPitch = parseFloat(localStorage.getItem(prefixNew + "pitch") || "1.0");
    const newVolume = parseInt(localStorage.getItem(prefixNew + "volume") || "80");
    const newVoiceName = localStorage.getItem(prefixNew + "voice") || "";

    setSpeed(newSpeed);
    setPitch(newPitch);
    setVolume(newVolume);

    if (newVoiceName) {
      const idx = voices.findIndex((v) => v.name === newVoiceName);
      if (idx >= 0) {
        setSelectedVoiceIdx(idx);
      }
    } else {
      let idx = -1;
      if (presetName === "A") {
        idx = voices.findIndex((v) => /haruka/i.test(v.name));
      } else {
        idx = voices.findIndex((v) => /ichiro/i.test(v.name));
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
  const splitIntoChunks = (text: string, maxLen = 140): string[] => {
    const sentences = text.split(/(?<=[。！？\n])/);
    const chunks: string[] = [];
    let cur = "";
    sentences.forEach((s) => {
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
    return chunks.filter((c) => c.trim().length);
  };

  // Keep-Alive & Safety Watcher for Speech and Video
  useEffect(() => {
    const watcher = setInterval(() => {
      if (status === "再生中" && !isPaused) {
        if (!window.speechSynthesis.speaking && !speechQueue.current.length) {
          setStatus("待機中");
          pauseAvatarVideo();
        } else if (window.speechSynthesis.speaking) {
          // Chrome 15s pause bug workaround
          window.speechSynthesis.pause();
          window.speechSynthesis.resume();
        }
      }
    }, 8000);
    return () => clearInterval(watcher);
  }, [status, isPaused]);

  // 高頻度監視タイマー（音声終了時の即時動画停止用）
  useEffect(() => {
    const interval = setInterval(() => {
      if (status === "待機中" || isPaused) {
        pauseAvatarVideo();
      }
    }, 200);
    return () => clearInterval(interval);
  }, [status, isPaused]);

  const playNextChunk = (gen: number) => {
    if (gen !== ttsGeneration.current) return;
    if (!speechQueue.current.length) {
      currentChunkText.current = "";
      currentChunkCharIndex.current = 0;
      setStatus("待機中");
      pauseAvatarVideo(); // 読み上げキュー完了で動画自動停止！
      return;
    }
    const chunk = speechQueue.current.shift()!;
    currentChunkText.current = chunk;
    currentChunkCharIndex.current = 0;

    const utter = new SpeechSynthesisUtterance(chunk);

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

    // 単語/文字境界を記録して一時停止時の即時再開位置を追跡
    utter.onboundary = (e) => {
      if (e.charIndex !== undefined && e.charIndex > 0) {
        currentChunkCharIndex.current = e.charIndex;
      }
    };

    utter.onstart = () => {
      if (gen === ttsGeneration.current) {
        playAvatarVideo(); // 発声開始で動画再生！
      }
    };

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

    // 発声開始と同時に動画再生始動！
    playAvatarVideo();

    setTimeout(() => playNextChunk(gen), 60);
  };

  const stopSpeaking = () => {
    ttsGeneration.current++;
    window.speechSynthesis.cancel();
    speechQueue.current = [];
    currentChunkText.current = "";
    currentChunkCharIndex.current = 0;
    setStatus("待機中");
    setIsPaused(false);
    pauseAvatarVideo(); // 全停止で即時動画停止！
  };

  // 一時停止 / 再開（即時レスポンス仕様）
  const togglePause = () => {
    if (status === "待機中") return;

    if (isPaused) {
      // ── 再開 ──
      setIsPaused(false);
      setStatus("再生中");
      playAvatarVideo();

      ttsGeneration.current++;
      const gen = ttsGeneration.current;
      setTimeout(() => playNextChunk(gen), 40);
    } else {
      // ── 一時停止（0ms 即時消音＆即時動画停止） ──
      pauseAvatarVideo();
      setIsPaused(true);
      setStatus("一時停止中");

      // 現在読み上げ中のチャンクの未読部分をキュー先頭に復元
      const curText = currentChunkText.current;
      const idx = currentChunkCharIndex.current;
      if (curText) {
        const remaining = idx > 0 && idx < curText.length ? curText.slice(idx).trim() : curText.trim();
        if (remaining) {
          speechQueue.current.unshift(remaining);
        }
      }
      currentChunkText.current = "";
      currentChunkCharIndex.current = 0;

      // 世代を進めてコールバックを即時遮断し、cancel() で音声を瞬時にカット
      ttsGeneration.current++;
      window.speechSynthesis.cancel();
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
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          {videoBlobUrl && (
            <button
              onClick={toggleVidVisible}
              className="btn-icon-subtle"
              title={vidVisible ? "動画枠を非表示" : "動画枠を表示"}
            >
              {vidVisible ? <Eye size={12} /> : <EyeOff size={12} />}
            </button>
          )}
          <span className="status-badge">{status}</span>
        </div>
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
          onClick={() => setActiveTab("avatar")}
          className="tab-button"
          style={{
            background: activeTab === "avatar" ? "var(--bg-tab-active)" : "var(--bg-tab-inactive)",
            color: activeTab === "avatar" ? "var(--text-tab-active)" : "var(--text-tab-inactive)"
          }}
        >
          🎬 アバター動画
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

      {/* アバター動画プレビュー領域（動画があり、かつ表示ONの場合に常時上部へ表示） */}
      {videoBlobUrl && vidVisible && (
        <>
          <div
            className={`avatar-video-wrapper ${isVidCollapsed ? "collapsed" : ""}`}
            style={{
              maxHeight: isVidCollapsed ? "0px" : (vidFitMode === "auto" ? "none" : `${vidHeight}px`)
            }}
          >
            <video
              ref={videoRef}
              src={videoBlobUrl}
              loop
              muted
              playsInline
              className={`avatar-video-element fit-${vidFitMode}`}
              style={{
                maxHeight: isVidCollapsed ? "0px" : (vidFitMode === "auto" ? "none" : `${vidHeight}px`)
              }}
            />
            {/* 右上クイックサイズ＆フィット切り替えボタン */}
            {!isVidCollapsed && (
              <div className="avatar-size-bar">
                <button
                  onClick={toggleVidFitMode}
                  className="btn-size-toggle"
                  title="表示形式切替（上下ノーカット全幅 ↔ 枠内全幅 ↔ 全体収容）"
                  style={{ marginRight: "4px" }}
                >
                  {vidFitMode === "auto" ? "📐 上下ノーカット" : vidFitMode === "cover" ? "✂️ 枠内全幅" : "🔲 全体収容"}
                </button>
                <button
                  onClick={toggleVidCollapse}
                  className="btn-size-toggle"
                  title="動画を折りたたむ"
                >
                  <ChevronUp size={11} /> 閉じる
                </button>
              </div>
            )}
          </div>

          {/* 動画の一番下の折りたたみバー（カオルさまご要望機能） */}
          <div
            onClick={toggleVidCollapse}
            className="avatar-collapse-bar"
            title={isVidCollapsed ? "動画を展開" : "動画を折りたたむ"}
          >
            {isVidCollapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
            <span>{isVidCollapsed ? "🎬 アバター動画を展開する" : "▲ アバター動画を折りたたむ"}</span>
          </div>
        </>
      )}

      {/* Main Panel Content */}
      <div className="panel-content">
        {activeTab === "voice" && (
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
                style={{
                  background: isPaused ? "var(--bg-btn-primary)" : "var(--bg-btn-secondary)",
                  color: isPaused ? "var(--text-btn-primary)" : "var(--text-btn-secondary)"
                }}
              >
                <Pause size={11} />
                {isPaused ? "再開" : "一時停止"}
              </button>
              <button onClick={stopSpeaking} className="btn-action btn-stop">
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
                marginTop: "2px",
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

            {/* Input area */}
            {isTextareaExpanded && (
              <div className="text-area-container">
                <label className="field-label">読み上げテキスト</label>
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
                marginTop: "2px",
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
              <div
                className="space-y-4"
                style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "6px" }}
              >
                {/* Settings controls */}
                <div className="settings-grid" style={{ paddingTop: "10px" }}>
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
        )}

        {/* ── アバター動画タブ ── */}
        {activeTab === "avatar" && (
          <div className="tab-pane">
            {/* スロット選択タブ */}
            <div className="setting-row">
              <label className="field-label">動画スロット選択（全3スロット保存）</label>
              <div className="slot-grid">
                {[0, 1, 2].map((i) => (
                  <button
                    key={i}
                    onClick={() => switchVidSlot(i)}
                    className={`slot-btn ${vidSlot === i ? "active" : ""}`}
                  >
                    スロット {i + 1}
                  </button>
                ))}
              </div>
            </div>

            {/* ファイル選択 & 削除ボタン */}
            <div className="setting-row" style={{ marginTop: "6px" }}>
              <input
                ref={fileInputRef}
                type="file"
                accept="video/mp4,video/webm,video/ogg,video/quicktime"
                onChange={handleVideoUpload}
                style={{ display: "none" }}
              />
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="btn-action"
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                    borderStyle: "dashed",
                    borderColor: "var(--bg-btn-primary)",
                    color: "var(--text-primary)"
                  }}
                >
                  <Video size={13} />
                  📂 動画ファイルを選択
                </button>
                {videoBlobUrl && (
                  <button
                    onClick={handleDeleteVideo}
                    className="btn-action"
                    style={{
                      flexShrink: 0,
                      padding: "6px 12px",
                      color: "#f87171",
                      borderColor: "#f87171"
                    }}
                    title="動画を削除"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </div>

            {/* 動画表示サイズ設定（カオルさまご要望機能） */}
            <div className="setting-row" style={{ marginTop: "10px" }}>
              <div className="setting-label-row">
                <span>動画の表示サイズ上限（高さ指定モード時）</span>
                <span>{vidHeight}px</span>
              </div>
              <div className="size-presets-grid" style={{ marginBottom: "6px" }}>
                <button
                  onClick={() => changeVidHeight(200)}
                  className={`slot-btn ${vidHeight === 200 ? "active" : ""}`}
                >
                  小 (200)
                </button>
                <button
                  onClick={() => changeVidHeight(340)}
                  className={`slot-btn ${vidHeight === 340 ? "active" : ""}`}
                >
                  中 (340)
                </button>
                <button
                  onClick={() => changeVidHeight(480)}
                  className={`slot-btn ${vidHeight === 480 ? "active" : ""}`}
                >
                  大 (480)
                </button>
                <button
                  onClick={() => changeVidHeight(620)}
                  className={`slot-btn ${vidHeight === 620 ? "active" : ""}`}
                >
                  特大 (620)
                </button>
              </div>
              <input
                type="range"
                min="160"
                max="720"
                step="10"
                value={vidHeight}
                onChange={(e) => changeVidHeight(parseInt(e.target.value))}
              />
            </div>

            {/* 表示フィット切替ボタン（上下ノーカット全幅 ↔ 枠内全幅カバー ↔ 全体収容） */}
            <div className="setting-row" style={{ marginTop: "6px" }}>
              <button
                onClick={toggleVidFitMode}
                className="btn-action"
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  fontSize: "0.85em",
                  borderColor: "var(--border-btn-secondary)"
                }}
              >
                {vidFitMode === "auto"
                  ? "📐 表示形式：上下ノーカット全幅（上下・左右切れ目なし全部表示）"
                  : vidFitMode === "cover"
                  ? "✂️ 表示形式：枠内全幅カバー（高さを固定し上下クロップ）"
                  : "🔲 表示形式：全体収容モード（等倍比率枠内収容）"}
              </button>
            </div>

            {/* 動画枠の折りたたみ切替ボタン */}
            <div className="setting-row" style={{ marginTop: "6px" }}>
              <button
                onClick={toggleVidCollapse}
                className="btn-action"
                style={{
                  width: "100%",
                  padding: "7px 10px",
                  fontSize: "0.85em",
                  borderColor: "var(--border-btn-secondary)"
                }}
              >
                {isVidCollapsed ? "🎬 アバター動画を展開する" : "▲ アバター動画を折りたたむ"}
              </button>
            </div>

            {/* 口パク動画連動トグル */}
            <div className="setting-row" style={{ marginTop: "10px" }}>
              <button
                onClick={toggleVidSync}
                className="btn-action"
                style={{
                  width: "100%",
                  padding: "8px",
                  fontWeight: "bold",
                  background: vidSyncEnabled ? "var(--bg-btn-primary)" : "var(--bg-btn-secondary)",
                  color: vidSyncEnabled ? "var(--text-btn-primary)" : "var(--text-btn-secondary)",
                  borderColor: vidSyncEnabled ? "transparent" : "var(--border-btn-secondary)"
                }}
              >
                {vidSyncEnabled ? "🎬 読み上げ・動画連動：ON" : "⏹ 読み上げ・動画連動：OFF"}
              </button>
            </div>

            {/* 動画表示トグル */}
            <div className="setting-row" style={{ marginTop: "6px" }}>
              <button
                onClick={toggleVidVisible}
                className="btn-action"
                style={{
                  width: "100%",
                  padding: "8px",
                  borderColor: "var(--border-btn-secondary)"
                }}
              >
                {vidVisible ? "👁️ プレビュー枠：常時表示中" : "🙈 プレビュー枠：非表示中"}
              </button>
            </div>

            {/* 動画再生速度スライダー（スロット別個別保存対応） */}
            <div className="setting-row" style={{ marginTop: "10px" }}>
              <div className="setting-label-row">
                <span>動画再生速度 (スロット {vidSlot} 個別保存)</span>
                <span>{vidSpeed.toFixed(2)}x</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="2.5"
                step="0.05"
                value={vidSpeed}
                onChange={(e) => handleVidSpeedChange(parseFloat(e.target.value))}
              />
            </div>

            {/* Info Box */}
            <div className="info-alert" style={{ marginTop: "12px" }}>
              <HelpCircle size={12} style={{ flexShrink: 0, marginTop: "1px" }} />
              <span>
                登録した口パク動画（MP4/WebM）はブラウザの内部ストレージ（IndexedDB）に安全に保存されます。「全幅フィット」を選ぶと、クリップボードリーダーの横幅いっぱいにロボットが大きく表示されます！
              </span>
            </div>
          </div>
        )}

        {/* ── テーマ＆フォントタブ ── */}
        {activeTab === "theme" && (
          <div className="tab-pane">
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
              <div
                className="space-y-4"
                style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "8px" }}
              >
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

                {/* Font Size Selector（拡大・反映強化） */}
                <div className="setting-row">
                  <label className="field-label">文字サイズ（パネル全体の文字拡大）</label>
                  <select
                    value={fontSize}
                    onChange={(e) => setFontSize(parseInt(e.target.value))}
                    className="select-field"
                  >
                    <option value="10">10px (小)</option>
                    <option value="11">11px (標準)</option>
                    <option value="13">13px (やや大)</option>
                    <option value="15">15px (大)</option>
                    <option value="17">17px (特大)</option>
                    <option value="19">19px (極大)</option>
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
