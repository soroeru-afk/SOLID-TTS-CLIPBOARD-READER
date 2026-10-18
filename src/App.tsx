import React, { useState, useEffect, useRef } from "react";
import { Play, Square, Pause, Clipboard, Volume2, HelpCircle, ChevronDown, ChevronUp, Settings, Edit3, Palette, Video, Trash2, Eye, EyeOff, Maximize2, Minimize2, PanelTop } from "lucide-react";

// Themes configuration
const THEMES: Record<string, { label: string; headerColor: string }> = {
  light: { label: "ライト", headerColor: "#f1f3f4" },
  dark: { label: "ダーク", headerColor: "#1b1b2a" },
  pastel: { label: "モノトーン", headerColor: "#111111" },
  brown: { label: "ブラウン", headerColor: "#4c2c19" },
  ocean: { label: "パステルピンク", headerColor: "#B07A76" }
};

const FONTS = {
  mono: { label: "Monospace", css: "'Courier New',Consolas,monospace" },
  roboto: { label: "Roboto", css: "Roboto,Arial,sans-serif" },
  noto: { label: "Noto Sans JP", css: "'Noto Sans JP','Hiragino Kaku Gothic ProN',sans-serif" },
  rounded: { label: "丸ゴシック", css: "'M PLUS Rounded 1c','Hiragino Maru Gothic Pro',sans-serif" }
};

// Window Sizes (Music Player compatible)
const DEFAULT_WINDOW_SIZES: Record<"video" | "mini", { width: number; height: number }> = {
  video: { width: 380, height: 860 },
  mini: { width: 380, height: 490 }
};

const MIN_WINDOW_SIZES: Record<"video" | "mini", { width: number; height: number }> = {
  video: { width: 300, height: 500 },
  mini: { width: 300, height: 350 }
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
    const curSlot = parseInt(localStorage.getItem("solid-tts-vid-slot") || "0");
    const slotTheme = localStorage.getItem(`solid-tts-slot-${curSlot}-theme`);
    if (slotTheme) return slotTheme;
    return localStorage.getItem("aist-tts-theme") || (curSlot === 1 ? "ocean" : curSlot === 2 ? "brown" : "dark");
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

  // 常に最新の発声設定を保持するRef（クロージャや非同期Stateラグによる先祖返りを100%防止）
  const activeVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const activeSpeedRef = useRef<number>(speed);
  const activePitchRef = useRef<number>(pitch);
  const activeVolumeRef = useRef<number>(volume);

  useEffect(() => {
    if (voices[selectedVoiceIdx]) {
      activeVoiceRef.current = voices[selectedVoiceIdx];
    }
  }, [selectedVoiceIdx, voices]);

  useEffect(() => {
    activeSpeedRef.current = speed;
  }, [speed]);

  useEffect(() => {
    activePitchRef.current = pitch;
  }, [pitch]);

  useEffect(() => {
    activeVolumeRef.current = volume;
  }, [volume]);

  // =============================================
  // アバター動画（口パク動画）State & 制御
  // =============================================
  const [vidSlot, setVidSlot] = useState(() => {
    const v = parseInt(localStorage.getItem("solid-tts-vid-slot") || "0");
    return isNaN(v) || v < 0 || v >= VID_SLOT_COUNT ? 0 : v;
  });
  const getSlotVidSpeed = (slot: number) => {
    const v = localStorage.getItem(`solid-tts-vid-speed-slot-${slot}`);
    if (v) return parseFloat(v);
    const old = localStorage.getItem("solid-tts-vid-speed");
    return old ? parseFloat(old) : 1.25;
  };

  const [vidSpeed, setVidSpeed] = useState(() => getSlotVidSpeed(vidSlot));
  const [vidHeight, setVidHeight] = useState(() => parseInt(localStorage.getItem("solid-tts-vid-height") || "340")); // デフォルト標準340px
  const [vidMode, setVidMode] = useState<"normal" | "expanded">(() => {
    return (localStorage.getItem("solid-tts-vid-mode") as "normal" | "expanded") || "normal";
  });

  const toggleVidMode = () => {
    setVidMode((prev) => {
      const next = prev === "normal" ? "expanded" : "normal";
      localStorage.setItem("solid-tts-vid-mode", next);
      return next;
    });
  };
  const [slotNames, setSlotNames] = useState<string[]>(() => [
    localStorage.getItem("solid-tts-slot-0-name") || "🤖 スロット 1",
    localStorage.getItem("solid-tts-slot-1-name") || "👩 スロット 2",
    localStorage.getItem("solid-tts-slot-2-name") || "👨 スロット 3"
  ]);

  const [vidSyncEnabled, setVidSyncEnabled] = useState(() => localStorage.getItem("solid-tts-vid-sync") !== "0"); // デフォルトON
  const [vidVisible, setVidVisible] = useState(() => localStorage.getItem("solid-tts-vid-visible") !== "0"); // デフォルトON
  const [viewMode, setViewMode] = useState<"video" | "mini">(() => {
    const saved = localStorage.getItem("solid-tts-view-mode");
    if (saved === "video" || saved === "mini") return saved as "video" | "mini";
    const v = localStorage.getItem("solid-tts-vid-visible");
    return v === "0" ? "mini" : "video";
  });

  // ウィンドウサイズ記憶（ミュージックプレイヤー完全互換）
  const [windowSizes, setWindowSizes] = useState<Record<"video" | "mini", { width: number; height: number }>>(() => {
    try {
      const saved = localStorage.getItem("solid-tts-window-sizes");
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          video: {
            width: typeof parsed.video?.width === "number" ? Math.max(parsed.video.width, 300) : DEFAULT_WINDOW_SIZES.video.width,
            height: typeof parsed.video?.height === "number" ? Math.max(parsed.video.height, 500) : DEFAULT_WINDOW_SIZES.video.height
          },
          mini: {
            width: typeof parsed.mini?.width === "number" ? Math.max(parsed.mini.width, 300) : DEFAULT_WINDOW_SIZES.mini.width,
            height: typeof parsed.mini?.height === "number" ? Math.max(parsed.mini.height, 350) : DEFAULT_WINDOW_SIZES.mini.height
          }
        };
      }
    } catch (e) {}
    return DEFAULT_WINDOW_SIZES;
  });

  // ユーザーが手動で広げた下側（ウィンドウ高さ・幅）を各モードごとに自動記憶・永続保存
  useEffect(() => {
    let resizeTimer: any;
    const handleResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (typeof document !== "undefined" && document.fullscreenElement) return;
        const w = window.outerWidth || window.innerWidth;
        const h = window.outerHeight || window.innerHeight;
        const min = MIN_WINDOW_SIZES[viewMode];
        if (w >= min.width && h >= min.height) {
          setWindowSizes((prev) => {
            const current = prev[viewMode];
            if (Math.abs(current.width - w) > 10 || Math.abs(current.height - h) > 10) {
              const updated = {
                ...prev,
                [viewMode]: { width: Math.round(w), height: Math.round(h) }
              };
              try {
                localStorage.setItem("solid-tts-window-sizes", JSON.stringify(updated));
              } catch (e) {}
              return updated;
            }
            return prev;
          });
        }
      }, 300);
    };
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      clearTimeout(resizeTimer);
    };
  }, [viewMode]);

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
    localStorage.setItem("solid-tts-vid-speed", String(vidSpeed));
  }, [vidSpeed, videoBlobUrl]);

  // 動画表示高さの保存
  const changeVidHeight = (h: number) => {
    setVidHeight(h);
    localStorage.setItem("solid-tts-vid-height", String(h));
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

  const handleVidSpeedChange = (spd: number) => {
    setVidSpeed(spd);
    localStorage.setItem(`solid-tts-vid-speed-slot-${vidSlot}`, String(spd));
    localStorage.setItem("solid-tts-vid-speed", String(spd));
    if (videoRef.current) {
      videoRef.current.playbackRate = spd;
    }
  };

  // スロット切り替え（動画・音声・速度を完全同期 ＆ シームレス・バトンタッチ）
  const switchCharacterSlot = async (idx: number) => {
    const isSpeakingNow = status === "再生中" && !isPaused;

    if (isSpeakingNow) {
      // 1. 現在発声中のチャンクの未読部分をキュー先頭に復元
      const curText = currentChunkText.current;
      const charIdx = currentChunkCharIndex.current;
      if (curText) {
        const remaining = charIdx > 0 && charIdx < curText.length ? curText.slice(charIdx).trim() : curText.trim();
        if (remaining) {
          speechQueue.current.unshift(remaining);
        }
      }
      currentChunkText.current = "";
      currentChunkCharIndex.current = 0;

      // 音声を瞬時カット
      ttsGeneration.current++;
      window.speechSynthesis.cancel();
    } else {
      pauseAvatarVideo();
    }

    setVidSlot(idx);
    localStorage.setItem("solid-tts-vid-slot", String(idx));

    // 1. 動画再生速度の復元
    const slotVidSpd = getSlotVidSpeed(idx);
    setVidSpeed(slotVidSpd);
    if (videoRef.current) {
      videoRef.current.playbackRate = slotVidSpd;
    }

    // 2. テーマ設定の復元（スロット専用テーマ）
    const slotTheme = localStorage.getItem(`solid-tts-slot-${idx}-theme`) || (idx === 1 ? "ocean" : idx === 2 ? "brown" : "dark");
    setTheme(slotTheme);

    // 3. 音声設定の復元
    const savedPreset = localStorage.getItem(`solid-tts-slot-${idx}-preset`) || (idx === 1 ? "A" : "B");
    setCurrentPreset(savedPreset);

    const savedSpeed = parseFloat(localStorage.getItem(`solid-tts-slot-${idx}-speed`) || (idx === 0 ? "1.25" : idx === 1 ? "1.2" : "1.15"));
    const savedPitch = parseFloat(localStorage.getItem(`solid-tts-slot-${idx}-pitch`) || (idx === 0 ? "0.95" : idx === 1 ? "1.1" : "1.0"));
    const savedVolume = parseInt(localStorage.getItem(`solid-tts-slot-${idx}-volume`) || "80");
    const savedVoice = localStorage.getItem(`solid-tts-slot-${idx}-voice`);

    setSpeed(savedSpeed);
    setPitch(savedPitch);
    setVolume(savedVolume);

    let nextVoice: SpeechSynthesisVoice | undefined;
    if (savedVoice && voices.length > 0) {
      const vIdx = voices.findIndex((v) => v.name === savedVoice);
      if (vIdx >= 0) {
        setSelectedVoiceIdx(vIdx);
        nextVoice = voices[vIdx];
      }
    } else if (voices.length > 0) {
      let vIdx = -1;
      if (savedPreset === "A") {
        vIdx = voices.findIndex((v) => /haruka/i.test(v.name));
      } else {
        vIdx = voices.findIndex((v) => /ichiro/i.test(v.name));
      }
      if (vIdx >= 0) {
        setSelectedVoiceIdx(vIdx);
        nextVoice = voices[vIdx];
      }
    }

    // 発声設定Refを即時同期（ワンフレーズ目だけでなく最後のチャンクまで100%この声を維持）
    if (nextVoice) {
      activeVoiceRef.current = nextVoice;
    }
    activeSpeedRef.current = savedSpeed;
    activePitchRef.current = savedPitch;
    activeVolumeRef.current = savedVolume;

    // 3. 動画のロード
    await loadSlotVideo(idx);

    // 4. シームレス・バトンタッチ再開（再生中だった場合）
    if (isSpeakingNow && speechQueue.current.length > 0) {
      setStatus("再生中");
      playAvatarVideo();
      const gen = ttsGeneration.current;
      setTimeout(() => {
        playNextChunk(gen);
      }, 50);
    }
  };

  const switchVidSlot = switchCharacterSlot;

  // スロット別の音声設定保存
  useEffect(() => {
    localStorage.setItem(`solid-tts-slot-${vidSlot}-speed`, String(speed));
  }, [speed, vidSlot]);

  useEffect(() => {
    localStorage.setItem(`solid-tts-slot-${vidSlot}-pitch`, String(pitch));
  }, [pitch, vidSlot]);

  useEffect(() => {
    localStorage.setItem(`solid-tts-slot-${vidSlot}-volume`, String(volume));
  }, [volume, vidSlot]);

  useEffect(() => {
    localStorage.setItem(`solid-tts-slot-${vidSlot}-preset`, currentPreset);
  }, [currentPreset, vidSlot]);

  useEffect(() => {
    if (voices[selectedVoiceIdx]) {
      localStorage.setItem(`solid-tts-slot-${vidSlot}-voice`, voices[selectedVoiceIdx].name);
    }
  }, [selectedVoiceIdx, vidSlot, voices]);

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

  const changeViewMode = (mode: "video" | "mini") => {
    setViewMode(mode);
    localStorage.setItem("solid-tts-view-mode", mode);

    const target = windowSizes[mode] || DEFAULT_WINDOW_SIZES[mode];

    if (mode === "video") {
      setVidVisible(true);
      localStorage.setItem("solid-tts-vid-visible", "1");
      if (typeof window !== "undefined" && typeof window.resizeTo === "function") {
        try { window.resizeTo(target.width, target.height); } catch (e) {}
      }
    } else if (mode === "mini") {
      setVidVisible(false);
      localStorage.setItem("solid-tts-vid-visible", "0");
      setActiveTab("voice"); // 強制的に音声コントロールタブ！
      if (typeof window !== "undefined" && typeof window.resizeTo === "function") {
        try { window.resizeTo(target.width, target.height); } catch (e) {}
      }
    }
  };

  const toggleVidVisible = () => {
    if (viewMode === "video") {
      changeViewMode("mini");
    } else {
      changeViewMode("video");
    }
  };

  const handleThemeSelect = (newTheme: string) => {
    setTheme(newTheme);
    localStorage.setItem("aist-tts-theme", newTheme);
    localStorage.setItem(`solid-tts-slot-${vidSlot}-theme`, newTheme);
  };

  // Apply Theme & Fonts to HTML elements
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("aist-tts-theme", theme);

    // ブラウザ・PWA上部ヘッダー色（<meta name="theme-color">）をテーマ色に動的同期
    const headerColor = THEMES[theme]?.headerColor || "#1b1b2a";
    let metaTheme = document.querySelector('meta[name="theme-color"]');
    if (!metaTheme) {
      metaTheme = document.createElement("meta");
      metaTheme.setAttribute("name", "theme-color");
      document.head.appendChild(metaTheme);
    }
    metaTheme.setAttribute("content", headerColor);
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

    activeSpeedRef.current = newSpeed;
    activePitchRef.current = newPitch;
    activeVolumeRef.current = newVolume;

    let targetVoiceIdx = -1;
    if (newVoiceName) {
      targetVoiceIdx = voices.findIndex((v) => v.name === newVoiceName);
    } else {
      if (presetName === "A") {
        targetVoiceIdx = voices.findIndex((v) => /haruka/i.test(v.name));
      } else {
        targetVoiceIdx = voices.findIndex((v) => /ichiro/i.test(v.name));
      }
    }
    if (targetVoiceIdx >= 0) {
      setSelectedVoiceIdx(targetVoiceIdx);
      if (voices[targetVoiceIdx]) {
        activeVoiceRef.current = voices[targetVoiceIdx];
      }
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
    if (voices[idx]) {
      activeVoiceRef.current = voices[idx];
    }
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

    // 常に最新のアクティブ設定（Ref）を参照！クロージャやState更新ラグの影響を一切受けず、最後まで確実に維持！
    const selectedVoice = activeVoiceRef.current || voices[selectedVoiceIdx];
    if (selectedVoice) {
      utter.voice = selectedVoice;
      utter.lang = selectedVoice.lang || "ja-JP";
    } else {
      utter.lang = "ja-JP";
    }
    utter.rate = activeSpeedRef.current;
    utter.pitch = activePitchRef.current;
    utter.volume = activeVolumeRef.current / 100;

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

  // 動画クリックで一時停止 / 再開（カオルさまご要望機能）
  const handleVideoClick = () => {
    if (status === "再生中" || status === "一時停止中") {
      togglePause();
    } else {
      if (textToRead && textToRead.trim()) {
        startSpeaking(textToRead);
      }
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
    <div className={`app-card mode-${viewMode}`}>
      {/* Header */}
      <div className="app-header">
        <span className="header-title">
          <Volume2 size={13} style={{ color: "var(--bg-btn-primary)" }} />
          SOLID TTS CLIPBOARD READER
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
          {/* モード切替ボタングループ（動画モード ↔ ミニパネルモード） */}
          <button
            onClick={() => changeViewMode("video")}
            className={`btn-mode-icon ${viewMode === "video" ? "active" : ""}`}
            title="動画・標準モード (アバター動画を表示)"
          >
            <Video size={12} />
          </button>
          <button
            onClick={() => changeViewMode("mini")}
            className={`btn-mode-icon ${viewMode === "mini" ? "active" : ""}`}
            title="ミニパネルモード (動画非表示・音声コントロール直結)"
          >
            <PanelTop size={12} />
          </button>

          <span className="status-badge" style={{ marginLeft: "2px" }}>{status}</span>
        </div>
      </div>

      {/* ── 最上部キャラクタースロット切替タブ（カオルさまご要望機能） ── */}
      <div className="tabs-container">
            {[0, 1, 2].map((idx) => (
              <button
                key={idx}
                onClick={() => switchCharacterSlot(idx)}
                className="tab-button"
                style={{
                  background: vidSlot === idx ? "var(--bg-tab-active)" : "var(--bg-tab-inactive)",
                  color: vidSlot === idx ? "var(--text-tab-active)" : "var(--text-tab-inactive)"
                }}
                title={`スロット${idx + 1}: ${slotNames[idx]}（動画・音声・速度を完全同期）`}
              >
                {slotNames[idx] || `スロット ${idx + 1}`}
              </button>
            ))}
          </div>

          {/* アバター動画プレビュー領域（動画があり、かつ video モード時のみ常時上部へ表示） */}
          {videoBlobUrl && vidVisible && viewMode === "video" && (
        <div
          className="avatar-video-wrapper"
          style={{
            maxHeight: vidMode === "expanded" ? "none" : `${vidHeight}px`
          }}
        >
          <video
            ref={videoRef}
            src={videoBlobUrl}
            loop
            muted
            playsInline
            onClick={handleVideoClick}
            className={`avatar-video-element ${vidMode}`}
            style={{
              maxHeight: vidMode === "expanded" ? "none" : `${vidHeight}px`,
              cursor: "pointer"
            }}
            title="クリックで一時停止 / 再生"
          />
          {/* 右上ノーマル ↔ 拡大 切り替えボタン */}
          <div className="avatar-size-bar">
            <button
              onClick={toggleVidMode}
              className="btn-size-toggle"
              title={vidMode === "expanded" ? "ノーマル表示に戻す" : "拡大表示(横幅フィット＆全体表示)に切替"}
            >
              {vidMode === "expanded" ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
              {vidMode === "expanded" ? "ノーマル" : "拡大"}
            </button>
          </div>
        </div>
      )}

      {/* Main Panel Content */}
      <div className="panel-content">
        {/* パネル内設定サブタブ（音声コントロール / 🎬 アバター動画 / テーマ＆フォント） */}
        <div
          className="tabs-container"
          style={{
            borderRadius: "6px",
            overflow: "hidden",
            marginBottom: "12px",
            flexShrink: 0,
            border: "1px solid var(--border-btn-secondary)"
          }}
        >
          <button
            onClick={() => setActiveTab("voice")}
            className="tab-button"
            style={{
              padding: "8px 4px",
              fontSize: "calc(var(--font-size-current) * 0.95)",
              background: activeTab === "voice" ? "var(--bg-btn-primary)" : "var(--bg-btn-secondary)",
              color: activeTab === "voice" ? "var(--text-btn-primary)" : "var(--text-btn-secondary)"
            }}
          >
            🎙️ 音声コントロール
          </button>
          <button
            onClick={() => setActiveTab("avatar")}
            className="tab-button"
            style={{
              padding: "8px 4px",
              fontSize: "calc(var(--font-size-current) * 0.95)",
              background: activeTab === "avatar" ? "var(--bg-btn-primary)" : "var(--bg-btn-secondary)",
              color: activeTab === "avatar" ? "var(--text-btn-primary)" : "var(--text-btn-secondary)"
            }}
          >
            🎬 アバター動画
          </button>
          <button
            onClick={() => setActiveTab("theme")}
            className="tab-button"
            style={{
              padding: "8px 4px",
              fontSize: "calc(var(--font-size-current) * 0.95)",
              background: activeTab === "theme" ? "var(--bg-btn-primary)" : "var(--bg-btn-secondary)",
              color: activeTab === "theme" ? "var(--text-btn-primary)" : "var(--text-btn-secondary)"
            }}
          >
            🎨 テーマ＆フォント
          </button>
        </div>
        {activeTab === "voice" && (
          <div className="tab-pane">
            {/* Preset select strip (一郎・遥かの左右反転) */}
            <div className="preset-strip">
              <button
                onClick={() => switchPreset("B")}
                className={`preset-btn ${currentPreset === "B" ? "active" : ""}`}
              >
                {presetBLabel}
              </button>
              <button
                onClick={() => switchPreset("A")}
                className={`preset-btn ${currentPreset === "A" ? "active" : ""}`}
              >
                {presetALabel}
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
            {/* スロット選択 */}
            <div className="setting-row">
              <div className="setting-label-row">
                <span>登録対象キャラクター・スロット</span>
                <span style={{ opacity: 0.85, fontWeight: "bold" }}>
                  {slotNames[vidSlot]}
                </span>
              </div>
              <div className="slot-grid">
                {[0, 1, 2].map((i) => (
                  <button
                    key={i}
                    onClick={() => switchCharacterSlot(i)}
                    className={`slot-btn ${vidSlot === i ? "active" : ""}`}
                  >
                    {slotNames[i]}
                  </button>
                ))}
              </div>
            </div>

            {/* スロット表示名変更 */}
            <div className="setting-row" style={{ marginTop: "6px" }}>
              <label className="field-label">スロット表示名 (キャラクター名)</label>
              <input
                type="text"
                value={slotNames[vidSlot] || ""}
                onChange={(e) => {
                  const val = e.target.value;
                  setSlotNames((prev) => {
                    const next = [...prev];
                    next[vidSlot] = val;
                    localStorage.setItem(`solid-tts-slot-${vidSlot}-name`, val);
                    return next;
                  });
                }}
                placeholder="キャラクター名を入力 (例: 🤖 ロボット)"
                className="input-field"
                style={{
                  width: "100%",
                  padding: "7px 10px",
                  fontSize: "var(--font-size-current)",
                  boxSizing: "border-box"
                }}
              />
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

            {/* 動画表示サイズ設定（ノーマル ↔ 拡大） */}
            <div className="setting-row" style={{ marginTop: "10px" }}>
              <div className="setting-label-row">
                <span>動画の表示形式</span>
                <span>{vidMode === "expanded" ? "拡大 (全幅・全体表示)" : `ノーマル (${vidHeight}px)`}</span>
              </div>
              <div className="size-presets-grid" style={{ marginBottom: "6px", gridTemplateColumns: "1fr 1fr" }}>
                <button
                  onClick={() => {
                    setVidMode("normal");
                    localStorage.setItem("solid-tts-vid-mode", "normal");
                  }}
                  className={`slot-btn ${vidMode === "normal" ? "active" : ""}`}
                >
                  📐 ノーマル
                </button>
                <button
                  onClick={() => {
                    setVidMode("expanded");
                    localStorage.setItem("solid-tts-vid-mode", "expanded");
                  }}
                  className={`slot-btn ${vidMode === "expanded" ? "active" : ""}`}
                >
                  🔍 拡大 (全体表示)
                </button>
              </div>
              {vidMode === "normal" && (
                <input
                  type="range"
                  min="160"
                  max="480"
                  step="10"
                  value={vidHeight}
                  onChange={(e) => changeVidHeight(parseInt(e.target.value))}
                />
              )}
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

            {/* 動画再生速度スライダー */}
            <div className="setting-row" style={{ marginTop: "10px" }}>
              <div className="setting-label-row">
                <span>動画再生速度</span>
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
            <div
              className="space-y-4"
              style={{ display: "flex", flexDirection: "column", gap: "12px" }}
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
                      onClick={() => handleThemeSelect(key)}
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
          </div>
        )}
      </div>
    </div>
  );
}
