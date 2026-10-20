import React, { useState, useEffect, useRef } from "react";
import { Play, Square, Pause, Clipboard, Volume2, HelpCircle, ChevronDown, ChevronUp, Settings, Edit3, Palette, Video, Trash2, Eye, EyeOff, Maximize2, Minimize2, PanelTop, ExternalLink, Layers, Mic, Sliders, RotateCcw, History, Copy, Check } from "lucide-react";

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

// ボイス推奨初期値（カオルさま添付画像の各パラメータに完全準拠）
export interface VoiceDefaultConfig {
  speed: number;
  pitch: number;
  volume: number;
}

export const VOICE_DEFAULT_PRESETS: { pattern: RegExp; config: VoiceDefaultConfig }[] = [
  // 1. Microsoft Ichiro (スロット1標準) -> 話速: 2.0x, ピッチ: 1.0x, 音量: 100%
  { pattern: /ichiro/i, config: { speed: 2.0, pitch: 1.0, volume: 100 } },
  // 2. Microsoft Haruka (スロット2標準) -> 話速: 1.9x, ピッチ: 1.1x, 音量: 85%
  { pattern: /haruka/i, config: { speed: 1.9, pitch: 1.1, volume: 85 } },
  // 3. Microsoft Sayaka -> 話速: 1.9x, ピッチ: 1.1x, 音量: 85%
  { pattern: /sayaka/i, config: { speed: 1.9, pitch: 1.1, volume: 85 } },
  // 4. Microsoft Ayumi -> 話速: 2.3x, ピッチ: 1.4x, 音量: 85%
  { pattern: /ayumi/i, config: { speed: 2.3, pitch: 1.4, volume: 85 } },
  // 5. Google 日本語 -> 話速: 1.2x, ピッチ: 1.1x, 音量: 85%
  { pattern: /google.*(ja|jp|日本)/i, config: { speed: 1.2, pitch: 1.1, volume: 85 } },
  { pattern: /google/i, config: { speed: 1.2, pitch: 1.1, volume: 85 } }
];

export const getDefaultConfigForVoice = (voiceName: string): VoiceDefaultConfig => {
  if (!voiceName) return { speed: 1.2, pitch: 1.0, volume: 85 };
  for (const item of VOICE_DEFAULT_PRESETS) {
    if (item.pattern.test(voiceName)) {
      return item.config;
    }
  }
  return { speed: 1.2, pitch: 1.0, volume: 85 };
};

// スロット別デフォルト推奨設定（未保存時のフォールバック）
export const DEFAULT_SLOT_CONFIGS: { voicePattern: RegExp; config: VoiceDefaultConfig }[] = [
  // スロット 1 (idx 0): Microsoft Ichiro (2.0x / 1.0x / 100%)
  { voicePattern: /ichiro/i, config: { speed: 2.0, pitch: 1.0, volume: 100 } },
  // スロット 2 (idx 1): Microsoft Haruka (1.9x / 1.1x / 85%)
  { voicePattern: /haruka/i, config: { speed: 1.9, pitch: 1.1, volume: 85 } },
  // スロット 3 (idx 2): Microsoft Sayaka / Ayumi / Google (1.9x / 1.1x / 85%)
  { voicePattern: /sayaka|ayumi|google/i, config: { speed: 1.9, pitch: 1.1, volume: 85 } }
];

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

// 読上テキスト履歴の型定義 & 設定（最大10件）
export interface SpeechHistoryItem {
  id: string;
  text: string;
  timestamp: number;
  charCount: number;
  source: "clipboard" | "manual";
}
const MAX_HISTORY_ITEMS = 10;
const HISTORY_STORAGE_KEY = "solid-tts-history-v1";

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

  // 読上履歴リスト（最大10件）
  const [historyList, setHistoryList] = useState<SpeechHistoryItem[]>(() => {
    try {
      const saved = localStorage.getItem(HISTORY_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed.slice(0, MAX_HISTORY_ITEMS);
      }
    } catch (e) {}
    return [];
  });
  const [copiedHistoryId, setCopiedHistoryId] = useState<string | null>(null);

  // 履歴への自動追加（同一テキスト重複は先頭に更新、最大10件維持）
  const addToHistory = (text: string, source: "clipboard" | "manual" = "clipboard") => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setHistoryList((prev) => {
      const filtered = prev.filter((item) => item.text !== trimmed);
      const newItem: SpeechHistoryItem = {
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        text: trimmed,
        timestamp: Date.now(),
        charCount: trimmed.length,
        source
      };
      const updated = [newItem, ...filtered].slice(0, MAX_HISTORY_ITEMS);
      try {
        localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(updated));
      } catch (e) {}
      return updated;
    });
  };

  const removeHistoryItem = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setHistoryList((prev) => {
      const updated = prev.filter((item) => item.id !== id);
      try {
        localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(updated));
      } catch (e) {}
      return updated;
    });
  };

  const clearHistory = () => {
    if (!confirm("読上履歴（最大10件）をすべて消去しますか？")) return;
    setHistoryList([]);
    try {
      localStorage.removeItem(HISTORY_STORAGE_KEY);
    } catch (e) {}
  };

  const handleCopyHistory = async (item: SpeechHistoryItem, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(item.text);
        setCopiedHistoryId(item.id);
        setTimeout(() => setCopiedHistoryId(null), 1500);
      }
    } catch (err) {
      console.warn("Clipboard write failed", err);
    }
  };

  // 上にシュッと出るドロワー状態（"none" | "text" | "voice_settings" | "history"）
  const [drawerMode, setDrawerMode] = useState<"none" | "text" | "voice_settings" | "history">("none");
  const [isDrawerMaximized, setIsDrawerMaximized] = useState(false);
  const [drawerCustomHeight, setDrawerCustomHeight] = useState<number | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const isResizingDrawerRef = useRef(false);

  const isDrawerOpen = activeTab === "avatar" || activeTab === "theme" || (activeTab === "voice" && drawerMode !== "none");
  const closeDrawer = () => {
    setDrawerMode("none");
    if (activeTab !== "voice") {
      setActiveTab("voice");
    }
  };

  const toggleMaximizeDrawer = () => {
    setIsDrawerMaximized((prev) => !prev);
  };

  const handleResizerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    isResizingDrawerRef.current = true;
    const stageEl = stageRef.current;
    if (!stageEl) return;
    const stageRect = stageEl.getBoundingClientRect();

    const handleMouseMove = (moveEvt: MouseEvent) => {
      if (!isResizingDrawerRef.current) return;
      const stageH = stageRect.height;
      if (stageH <= 0) return;
      // ドロワーはステージ下端に固定されているため、上端ドラッグ時の高さ = ステージ下端Y - マウスY
      const drawerH = stageRect.bottom - moveEvt.clientY;
      const minH = 140;
      const maxH = stageH - 8;
      const clampedH = Math.max(minH, Math.min(drawerH, maxH));
      const pct = Math.round((clampedH / stageH) * 100);
      setDrawerCustomHeight(pct);
      setIsDrawerMaximized(false);
    };

    const handleMouseUp = () => {
      isResizingDrawerRef.current = false;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  const handleResizerTouchStart = (e: React.TouchEvent) => {
    const stageEl = stageRef.current;
    if (!stageEl || !e.touches[0]) return;
    const stageRect = stageEl.getBoundingClientRect();

    const handleTouchMove = (moveEvt: TouchEvent) => {
      if (!moveEvt.touches[0]) return;
      const stageH = stageRect.height;
      if (stageH <= 0) return;
      const drawerH = stageRect.bottom - moveEvt.touches[0].clientY;
      const minH = 140;
      const maxH = stageH - 8;
      const clampedH = Math.max(minH, Math.min(drawerH, maxH));
      const pct = Math.round((clampedH / stageH) * 100);
      setDrawerCustomHeight(pct);
      setIsDrawerMaximized(false);
    };

    const handleTouchEnd = () => {
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
    };

    window.addEventListener("touchmove", handleTouchMove);
    window.addEventListener("touchend", handleTouchEnd);
  };

  // iFrame環境判定
  const [isInIframe, setIsInIframe] = useState(false);
  useEffect(() => {
    try {
      setIsInIframe(window.self !== window.top);
    } catch (e) {
      setIsInIframe(true);
    }
  }, []);

  // 別窓（独立ウィンドウ / 新タブ）で開く
  const openInStandaloneWindow = () => {
    const curWidth = windowSizes[viewMode]?.width || 380;
    const curHeight = windowSizes[viewMode]?.height || (viewMode === "video" ? 860 : 490);
    const targetUrl = window.location.href;
    const win = window.open(
      targetUrl,
      "solidTtsWindow",
      `width=${curWidth},height=${curHeight},menubar=no,toolbar=no,location=no,status=no`
    );
    if (!win) {
      window.open(targetUrl, "_blank");
    }
  };

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

  // Temporary local state for sliders that syncs with current slot and preset
  const [speed, setSpeed] = useState(() => {
    const curSlot = parseInt(localStorage.getItem("solid-tts-vid-slot") || "0");
    const slotIdx = isNaN(curSlot) || curSlot < 0 || curSlot >= VID_SLOT_COUNT ? 0 : curSlot;
    const slotSaved = localStorage.getItem(`solid-tts-slot-${slotIdx}-speed`);
    if (slotSaved) return parseFloat(slotSaved);
    const active = localStorage.getItem("aist-tts-preset-active") || "A";
    const prefix = `aist-tts-preset-${active.toLowerCase()}-`;
    const oldSaved = localStorage.getItem(prefix + "speed");
    if (oldSaved) return parseFloat(oldSaved);
    return DEFAULT_SLOT_CONFIGS[slotIdx]?.config.speed ?? 1.2;
  });
  const [pitch, setPitch] = useState(() => {
    const curSlot = parseInt(localStorage.getItem("solid-tts-vid-slot") || "0");
    const slotIdx = isNaN(curSlot) || curSlot < 0 || curSlot >= VID_SLOT_COUNT ? 0 : curSlot;
    const slotSaved = localStorage.getItem(`solid-tts-slot-${slotIdx}-pitch`);
    if (slotSaved) return parseFloat(slotSaved);
    const active = localStorage.getItem("aist-tts-preset-active") || "A";
    const prefix = `aist-tts-preset-${active.toLowerCase()}-`;
    const oldSaved = localStorage.getItem(prefix + "pitch");
    if (oldSaved) return parseFloat(oldSaved);
    return DEFAULT_SLOT_CONFIGS[slotIdx]?.config.pitch ?? 1.0;
  });
  const [volume, setVolume] = useState(() => {
    const curSlot = parseInt(localStorage.getItem("solid-tts-vid-slot") || "0");
    const slotIdx = isNaN(curSlot) || curSlot < 0 || curSlot >= VID_SLOT_COUNT ? 0 : curSlot;
    const slotSaved = localStorage.getItem(`solid-tts-slot-${slotIdx}-volume`);
    if (slotSaved) return parseInt(slotSaved);
    const active = localStorage.getItem("aist-tts-preset-active") || "A";
    const prefix = `aist-tts-preset-${active.toLowerCase()}-`;
    const oldSaved = localStorage.getItem(prefix + "volume");
    if (oldSaved) return parseInt(oldSaved);
    return DEFAULT_SLOT_CONFIGS[slotIdx]?.config.volume ?? 85;
  });

  const [resetFeedbackMsg, setResetFeedbackMsg] = useState<string | null>(null);

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
  const stripEmojis = (str: string) => {
    return str
      .replace(/\p{Extended_Pictographic}|\uFE0F|\u200D|\u20E3/gu, "")
      .replace(/[🤖👱‍♀️👨🎬🎙️🎨📋✏️⚙️⬛⬜]/gu, "")
      .trim();
  };

  const [slotNames, setSlotNames] = useState<string[]>(() => {
    return [0, 1, 2].map((idx) => {
      const raw = localStorage.getItem(`solid-tts-slot-${idx}-name`);
      if (raw) {
        const cleaned = stripEmojis(raw);
        if (cleaned && cleaned !== raw) {
          localStorage.setItem(`solid-tts-slot-${idx}-name`, cleaned);
        }
        return cleaned || `スロット ${idx + 1}`;
      }
      return `スロット ${idx + 1}`;
    });
  });

  const [vidSyncEnabled, setVidSyncEnabled] = useState(() => localStorage.getItem("solid-tts-vid-sync") !== "0"); // デフォルトON
  const [vidVisible, setVidVisible] = useState(() => localStorage.getItem("solid-tts-vid-visible") !== "0"); // デフォルトON
  const [viewMode, setViewMode] = useState<"video" | "mini">(() => {
    const saved = localStorage.getItem("solid-tts-view-mode");
    if (saved === "video" || saved === "mini") return saved as "video" | "mini";
    const v = localStorage.getItem("solid-tts-vid-visible");
    return v === "0" ? "mini" : "video";
  });

  // 帯の色（黒 / 白）State
  const [vidBgColor, setVidBgColor] = useState<"black" | "white">(() => {
    return (localStorage.getItem("solid-tts-vid-bg") as "black" | "white") || "black";
  });

  const handleVidBgChange = (c: "black" | "white") => {
    setVidBgColor(c);
    localStorage.setItem("solid-tts-vid-bg", c);
  };

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

  // 動画が表示状態（DOMに存在）になり、かつ読み上げ中であれば自動で動画再生を再開（ミニモードから戻した時の再開バグ解消）
  useEffect(() => {
    if (viewMode === "video" && vidVisible && videoBlobUrl && status === "再生中" && !isPaused) {
      const timer = setTimeout(() => {
        playAvatarVideo();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [viewMode, vidVisible, videoBlobUrl, status, isPaused]);

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

    // 3. 音声設定の復元（スロット専用ボイス・話速・ピッチ・音量）
    const slotDef = DEFAULT_SLOT_CONFIGS[idx]?.config || { speed: 2.0, pitch: 1.0, volume: 100 };
    const savedVoice = localStorage.getItem(`solid-tts-slot-${idx}-voice`);

    let nextVoice: SpeechSynthesisVoice | undefined;
    if (savedVoice && voices.length > 0) {
      const vIdx = voices.findIndex((v) => v.name === savedVoice);
      if (vIdx >= 0) {
        setSelectedVoiceIdx(vIdx);
        nextVoice = voices[vIdx];
      }
    } else if (voices.length > 0) {
      const pattern = DEFAULT_SLOT_CONFIGS[idx]?.voicePattern;
      let vIdx = -1;
      if (pattern) {
        vIdx = voices.findIndex((v) => pattern.test(v.name));
      }
      if (vIdx < 0) {
        vIdx = idx === 0 ? voices.findIndex((v) => /ichiro/i.test(v.name)) : voices.findIndex((v) => /haruka/i.test(v.name));
      }
      if (vIdx < 0) vIdx = 0;
      setSelectedVoiceIdx(vIdx);
      nextVoice = voices[vIdx];
    }

    const savedSpeedStr = localStorage.getItem(`solid-tts-slot-${idx}-speed`);
    const savedPitchStr = localStorage.getItem(`solid-tts-slot-${idx}-pitch`);
    const savedVolumeStr = localStorage.getItem(`solid-tts-slot-${idx}-volume`);

    const voiceDef = nextVoice ? getDefaultConfigForVoice(nextVoice.name) : slotDef;
    const finalSpeed = savedSpeedStr ? parseFloat(savedSpeedStr) : voiceDef.speed;
    const finalPitch = savedPitchStr ? parseFloat(savedPitchStr) : voiceDef.pitch;
    const finalVolume = savedVolumeStr ? parseInt(savedVolumeStr) : voiceDef.volume;

    setSpeed(finalSpeed);
    setPitch(finalPitch);
    setVolume(finalVolume);

    // 発声設定Refを即時同期（ワンフレーズ目だけでなく最後のチャンクまで100%この声を維持）
    if (nextVoice) {
      activeVoiceRef.current = nextVoice;
    }
    activeSpeedRef.current = finalSpeed;
    activePitchRef.current = finalPitch;
    activeVolumeRef.current = finalVolume;

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

  // タブ切り替え時にドロワー状態を整理
  useEffect(() => {
    if (activeTab === "voice") {
      setDrawerMode("none");
    }
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
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
      const all = window.speechSynthesis.getVoices();
      if (!all || all.length === 0) return;
      let jaVoices = all.filter((v) => /ja|JP/i.test(v.lang));
      if (!jaVoices.length) jaVoices = all;
      setVoices(jaVoices);

      const curSlot = parseInt(localStorage.getItem("solid-tts-vid-slot") || "0");
      const slotIdx = isNaN(curSlot) || curSlot < 0 || curSlot >= VID_SLOT_COUNT ? 0 : curSlot;
      const savedSlotVoice = localStorage.getItem(`solid-tts-slot-${slotIdx}-voice`);
      let idx = -1;

      if (savedSlotVoice) {
        idx = jaVoices.findIndex((v) => v.name === savedSlotVoice);
      }
      if (idx < 0) {
        const pattern = DEFAULT_SLOT_CONFIGS[slotIdx]?.voicePattern;
        if (pattern) {
          idx = jaVoices.findIndex((v) => pattern.test(v.name));
        }
      }
      if (idx < 0) {
        const active = localStorage.getItem("aist-tts-preset-active") || "A";
        if (active === "A") {
          idx = jaVoices.findIndex((v) => /haruka/i.test(v.name));
        } else {
          idx = jaVoices.findIndex((v) => /ichiro/i.test(v.name));
        }
      }
      if (idx < 0) idx = 0;
      setSelectedVoiceIdx(idx);
      if (jaVoices[idx]) {
        activeVoiceRef.current = jaVoices[idx];
      }
    };

    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      loadVoicesList();
      window.speechSynthesis.onvoiceschanged = loadVoicesList;
      const t1 = setTimeout(loadVoicesList, 200);
      const t2 = setTimeout(loadVoicesList, 800);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
        try {
          window.speechSynthesis.cancel();
        } catch (e) {}
        pauseAvatarVideo();
      };
    }
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
    const v = voices[idx];
    if (v) {
      activeVoiceRef.current = v;
      // カオルさまご指定の初期値（画像の数字）を自動適用してスロットに保存
      const def = getDefaultConfigForVoice(v.name);
      setSpeed(def.speed);
      setPitch(def.pitch);
      setVolume(def.volume);
      activeSpeedRef.current = def.speed;
      activePitchRef.current = def.pitch;
      activeVolumeRef.current = def.volume;

      localStorage.setItem(`solid-tts-slot-${vidSlot}-voice`, v.name);
      localStorage.setItem(`solid-tts-slot-${vidSlot}-speed`, String(def.speed));
      localStorage.setItem(`solid-tts-slot-${vidSlot}-pitch`, String(def.pitch));
      localStorage.setItem(`solid-tts-slot-${vidSlot}-volume`, String(def.volume));
    }
  };

  // 選択中ボイスの初期値にリセット
  const handleResetToVoiceDefaults = () => {
    const curVoice = voices[selectedVoiceIdx];
    const def = curVoice ? getDefaultConfigForVoice(curVoice.name) : { speed: 1.2, pitch: 1.0, volume: 85 };
    setSpeed(def.speed);
    setPitch(def.pitch);
    setVolume(def.volume);
    activeSpeedRef.current = def.speed;
    activePitchRef.current = def.pitch;
    activeVolumeRef.current = def.volume;

    localStorage.setItem(`solid-tts-slot-${vidSlot}-speed`, String(def.speed));
    localStorage.setItem(`solid-tts-slot-${vidSlot}-pitch`, String(def.pitch));
    localStorage.setItem(`solid-tts-slot-${vidSlot}-volume`, String(def.volume));

    setResetFeedbackMsg("初期値にリセットしました");
    setTimeout(() => {
      setResetFeedbackMsg(null);
    }, 2000);
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

    utter.onend = () => {
      if (gen === ttsGeneration.current) {
        playNextChunk(gen);
      }
    };

    utter.onerror = (e: SpeechSynthesisErrorEvent) => {
      console.warn("TTS Error:", e.error);
      if (e.error === "canceled" || e.error === "interrupted") {
        return;
      }
      if (e.error === "not-allowed") {
        setStatus("ブラウザ制限(別窓推奨)");
        pauseAvatarVideo();
        return;
      }
      if (gen === ttsGeneration.current) {
        playNextChunk(gen);
      }
    };

    try {
      window.speechSynthesis.speak(utter);
    } catch (err) {
      console.error("SpeechSynthesis speak exception:", err);
    }
  };

  const startSpeaking = (text: string) => {
    if (!text || !text.trim()) return;
    const chunks = splitIntoChunks(text);
    if (!chunks.length) return;

    ttsGeneration.current++;
    const gen = ttsGeneration.current;

    try {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }
        window.speechSynthesis.cancel();
      }
    } catch (e) {}

    speechQueue.current = chunks;
    setStatus("再生中");
    setIsPaused(false);

    // 発声開始と同時に動画再生始動！
    playAvatarVideo();

    setTimeout(() => {
      try {
        if (typeof window !== "undefined" && "speechSynthesis" in window && window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }
      } catch (e) {}
      playNextChunk(gen);
    }, 50);
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
      if (!navigator.clipboard || !navigator.clipboard.readText) {
        throw new Error("お使いのブラウザでは直接読み取りAPIが非対応です。テキスト入力欄に貼り付けて再生してください。");
      }
      const text = await navigator.clipboard.readText();
      if (!text || !text.trim()) {
        alert("クリップボードにテキストがありません。");
        return;
      }
      setTextToRead(text);
      addToHistory(text, "clipboard");
      startSpeaking(text);
    } catch (e: any) {
      if (isInIframe) {
        alert(
          "【iFrame制限について】\nプレビューの埋め込み枠内では、ブラウザのセキュリティ保護によりクリップボードへのアクセスが制限されています。\n\n" +
          "上部の「別窓アイコン（↗）」をクリックして別タブ/別窓で開くと、クリップボードや音声・口パクが100%完全動作します。\n" +
          "（または、テキスト入力欄に直接貼り付けて「再生」ボタンを押してください）"
        );
      } else {
        alert("クリップボードの読み取りに失敗しました。ブラウザの権限設定を確認してください。\n" + e.message);
      }
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

          {/* 別窓（独立ウィンドウ / 新タブ）で開くボタン */}
          <button
            onClick={openInStandaloneWindow}
            className="btn-mode-icon"
            title="別窓・別タブで開く (ブラウザ制限を解除し、音声・口パク連動・クリップボードを完全稼働)"
          >
            <ExternalLink size={12} />
          </button>

          <span className="status-badge" style={{ marginLeft: "2px" }}>{status}</span>
        </div>
      </div>

      {/* iFrame埋め込み時のインフォメーションバー */}
      {isInIframe && (
        <div
          style={{
            padding: "5px 10px",
            fontSize: "10.5px",
            background: "var(--bg-info)",
            borderBottom: "1px solid var(--border-app)",
            color: "var(--text-secondary)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "8px"
          }}
        >
          <span>埋め込み制限回避：別窓で音声・口パク・クリップボードが完全動作</span>
          <button
            onClick={openInStandaloneWindow}
            style={{
              background: "var(--bg-btn-primary)",
              color: "var(--text-btn-primary)",
              border: "none",
              padding: "2px 8px",
              borderRadius: "3px",
              cursor: "pointer",
              fontSize: "10px",
              fontWeight: 600,
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              flexShrink: 0
            }}
          >
            別窓で開く
            <ExternalLink size={10} />
          </button>
        </div>
      )}

      {/* ── 最上部キャラクタースロット切替タブ（カオルさまご要望機能） ── */}
      <div className="tabs-container">
        {[0, 1, 2].map((idx) => (
          <button
            key={idx}
            onClick={() => switchCharacterSlot(idx)}
            className="tab-button"
            style={{
              background: vidSlot === idx ? "var(--bg-tab-active)" : "var(--bg-tab-inactive)",
              color: vidSlot === idx ? "var(--text-tab-active)" : "var(--text-tab-inactive)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px"
            }}
            title={`スロット${idx + 1}: ${slotNames[idx]}`}
          >
            <span
              style={{
                fontFamily: "monospace",
                fontSize: "10px",
                fontWeight: 700,
                padding: "1px 5px",
                borderRadius: "3px",
                background: vidSlot === idx ? "rgba(0,0,0,0.22)" : "rgba(255,255,255,0.08)",
                border: "1px solid currentColor",
                opacity: 0.9,
                letterSpacing: "0.5px"
              }}
            >
              {`0${idx + 1}`}
            </span>
            <span>{slotNames[idx] || `スロット ${idx + 1}`}</span>
          </button>
        ))}
      </div>

      {/* ── アバターステージ領域（中央・可変フレックス領域） ── */}
      <div ref={stageRef} className={`avatar-stage-container ${vidBgColor === "white" ? "white-bg" : ""}`}>
        {/* 動画表示（動画があり、かつ video モード時のみ表示） */}
        {videoBlobUrl && vidVisible && viewMode === "video" ? (
          <div
            className="avatar-video-wrapper"
            style={{
              backgroundColor: vidBgColor === "white" ? "#ffffff" : "#000000",
              maxHeight: vidMode === "expanded" ? "100%" : `${vidHeight}px`,
              height: "100%",
              width: "100%"
            }}
          >
            <video
              ref={videoRef}
              src={videoBlobUrl}
              loop
              muted
              playsInline
              onCanPlay={() => {
                if (status === "再生中" && !isPaused) {
                  playAvatarVideo();
                }
              }}
              onClick={handleVideoClick}
              className={`avatar-video-element ${vidMode}`}
              style={{
                cursor: "pointer"
              }}
              title="クリックで一時停止 / 再生"
            />
            {/* 右上ノーマル ↔ 拡大 切り替え ＆ 帯色切り替えボタン */}
            <div className="avatar-size-bar">
              <button
                onClick={() => handleVidBgChange(vidBgColor === "black" ? "white" : "black")}
                className="btn-size-toggle"
                title={vidBgColor === "black" ? "白帯に変更" : "黒帯に変更"}
                style={{ fontSize: "10px" }}
              >
                {vidBgColor === "black" ? "帯: 黒" : "帯: 白"}
              </button>
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
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-secondary)",
              gap: "8px",
              padding: "20px",
              textAlign: "center"
            }}
          >
            <Volume2 size={32} style={{ opacity: 0.3 }} />
            <div style={{ fontSize: "11px", fontWeight: "bold" }}>
              {slotNames[vidSlot] || `スロット ${vidSlot + 1}`}
            </div>
            <div style={{ fontSize: "10px", opacity: 0.6 }}>
              {viewMode === "mini" ? "ミニパネル稼働中" : "「アバター動画」タブから動画を登録できます"}
            </div>
          </div>
        )}

        {/* ── 上にシュッと出るスライドアップ・ドロワー（カオルさまご要望機能） ── */}
        <div
          className={`slide-up-drawer ${isDrawerOpen ? "open" : ""}`}
          style={{
            height: isDrawerMaximized
              ? "92%"
              : drawerCustomHeight !== null
              ? `${drawerCustomHeight}%`
              : activeTab === "voice" && (drawerMode === "text" || drawerMode === "history")
              ? "62%"
              : undefined,
            maxHeight: "94%"
          }}
        >
          {/* 上部ドラッグリサイズ用グリップバー（上へエリアを広げる） */}
          <div
            className="slide-up-drawer-resizer"
            onMouseDown={handleResizerMouseDown}
            onTouchStart={handleResizerTouchStart}
            onDoubleClick={toggleMaximizeDrawer}
            title="上下にドラッグして上にエリアを広げます（ダブルクリックで最大化 / 標準）"
          >
            <div className="resizer-handle-pill" />
          </div>

          {/* ドロワー・ヘッダー */}
          <div className="slide-up-drawer-header">
            <span className="slide-up-drawer-title">
              {activeTab === "avatar" && (
                <>
                  <Video size={13} style={{ color: "var(--bg-btn-primary)" }} />
                  アバター動画設定 ({slotNames[vidSlot]})
                </>
              )}
              {activeTab === "theme" && (
                <>
                  <Palette size={13} style={{ color: "var(--bg-btn-primary)" }} />
                  テーマ＆フォント設定
                </>
              )}
              {activeTab === "voice" && drawerMode === "text" && (
                <>
                  <Edit3 size={13} style={{ color: "var(--bg-btn-primary)" }} />
                  読み上げテキスト入力 ({textToRead.length}文字)
                </>
              )}
              {activeTab === "voice" && drawerMode === "history" && (
                <>
                  <History size={13} style={{ color: "var(--bg-btn-primary)" }} />
                  読上テキスト履歴 ({historyList.length}/10件)
                </>
              )}
              {activeTab === "voice" && drawerMode === "voice_settings" && (
                <>
                  <Settings size={13} style={{ color: "var(--bg-btn-primary)" }} />
                  音声詳細設定 ({slotNames[vidSlot]})
                </>
              )}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <button
                onClick={toggleMaximizeDrawer}
                className="slide-up-drawer-btn"
                title={isDrawerMaximized ? "標準サイズに戻す" : "上にエリアを広げる（最大化）"}
              >
                {isDrawerMaximized ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
                <span>{isDrawerMaximized ? "縮小" : "上に広げる"}</span>
              </button>
              <button
                onClick={closeDrawer}
                className="slide-up-drawer-close"
                title="このパネルを閉じて動画全画面に戻る"
              >
                <ChevronDown size={12} />
                閉じる
              </button>
            </div>
          </div>

          {/* ドロワー・ボディ（スクロール領域） */}
          <div className="slide-up-drawer-body">
            {/* 1. 音声テキスト入力ドロワー */}
            {activeTab === "voice" && drawerMode === "text" && (
              <div className="text-area-container" style={{ margin: 0, height: "100%", display: "flex", flexDirection: "column", flex: 1 }}>
                <textarea
                  value={textToRead}
                  onChange={(e) => setTextToRead(e.target.value)}
                  placeholder="ここにテキストを入力するか、貼り付けてください..."
                  className="textarea-field"
                  style={{
                    flex: 1,
                    width: "100%",
                    minHeight: "100px",
                    height: "100%",
                    resize: "none"
                  }}
                />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "8px", flexShrink: 0, gap: "6px" }}>
                  <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                    <button
                      onClick={() => setTextToRead("")}
                      className="btn-action"
                      disabled={!textToRead}
                      style={{ fontSize: "10px", padding: "4px 8px" }}
                    >
                      クリア
                    </button>
                    {historyList.length > 0 && (
                      <button
                        onClick={() => setDrawerMode("history")}
                        className="btn-action"
                        style={{ fontSize: "10px", padding: "4px 8px" }}
                        title="過去10件の読上履歴からテキストを選ぶ"
                      >
                        <History size={10} style={{ display: "inline", verticalAlign: "middle", marginRight: "3px" }} />
                        履歴から呼出 ({historyList.length})
                      </button>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      if (textToRead.trim()) {
                        addToHistory(textToRead, "manual");
                        startSpeaking(textToRead);
                        closeDrawer();
                      }
                    }}
                    disabled={!textToRead.trim()}
                    className="btn-action"
                    style={{
                      fontSize: "10px",
                      padding: "4px 12px",
                      background: "var(--bg-btn-primary)",
                      color: "var(--text-btn-primary)",
                      fontWeight: "bold"
                    }}
                  >
                    <Play size={10} style={{ display: "inline", verticalAlign: "middle", marginRight: "3px" }} />
                    閉じて再生
                  </button>
                </div>
              </div>
            )}

            {/* 2. 読上履歴ドロワー（最大10件） */}
            {activeTab === "voice" && drawerMode === "history" && (
              <div className="history-drawer-wrapper">
                <div className="history-toolbar">
                  <div className="history-toolbar-info">
                    <span className="history-tag">BUFFER 10</span>
                    <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                      直近のクリップボード・入力読上履歴
                    </span>
                  </div>
                  {historyList.length > 0 && (
                    <button
                      onClick={clearHistory}
                      className="history-clear-all-btn"
                      title="保存されている履歴をすべて消去します"
                    >
                      <Trash2 size={11} />
                      <span>全消去</span>
                    </button>
                  )}
                </div>

                {historyList.length === 0 ? (
                  <div className="history-empty-box">
                    <History size={28} style={{ opacity: 0.3, marginBottom: "4px" }} />
                    <div style={{ fontWeight: 600, fontSize: "12px" }}>読上履歴がありません</div>
                    <div style={{ fontSize: "10.5px", color: "var(--text-secondary)", marginTop: "2px" }}>
                      クリップボード読み上げを実行すると、ここに直近10件が自動保持されます。
                    </div>
                  </div>
                ) : (
                  <div className="history-items-list">
                    {historyList.map((item, index) => {
                      const dateObj = new Date(item.timestamp);
                      const timeStr = dateObj.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
                      const dateStr = `${dateObj.getMonth() + 1}/${dateObj.getDate()}`;
                      return (
                        <div key={item.id} className="history-entry-card">
                          <div className="history-entry-top">
                            <div className="history-entry-badges">
                              <span className="history-entry-num">#{index + 1}</span>
                              <span className="history-entry-type">
                                {item.source === "clipboard" ? "CLIPBOARD" : "MANUAL"}
                              </span>
                              <span className="history-entry-chars">{item.charCount}文字</span>
                              <span className="history-entry-time">{dateStr} {timeStr}</span>
                            </div>

                            <div className="history-entry-actions">
                              <button
                                onClick={(e) => handleCopyHistory(item, e)}
                                className="history-icon-btn"
                                title="クリップボードにコピー"
                              >
                                {copiedHistoryId === item.id ? <Check size={11} style={{ color: "var(--bg-btn-primary)" }} /> : <Copy size={11} />}
                                <span>{copiedHistoryId === item.id ? "済" : "コピー"}</span>
                              </button>
                              <button
                                onClick={(e) => removeHistoryItem(item.id, e)}
                                className="history-icon-btn delete-btn"
                                title="この項目を履歴から削除"
                              >
                                <Trash2 size={11} />
                              </button>
                            </div>
                          </div>

                          <div
                            className="history-entry-content"
                            title="クリックでテキスト入力欄に読み込み"
                            onClick={() => {
                              setTextToRead(item.text);
                            }}
                          >
                            {item.text}
                          </div>

                          <div className="history-entry-bottom">
                            <button
                              onClick={() => {
                                setTextToRead(item.text);
                                closeDrawer();
                              }}
                              className="history-btn-load"
                              title="テキスト欄にセットして閉じる"
                            >
                              <Edit3 size={11} />
                              <span>入力欄にセット</span>
                            </button>
                            <button
                              onClick={() => {
                                setTextToRead(item.text);
                                addToHistory(item.text, item.source);
                                startSpeaking(item.text);
                              }}
                              className="history-btn-replay"
                              title="このテキストをもう一度読み上げ"
                            >
                              <Play size={11} />
                              <span>もう一度読む</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* 2. 音声詳細設定（話速・ピッチ・音量・ボイス） */}
            {activeTab === "voice" && drawerMode === "voice_settings" && (
              <div className="settings-grid">
                {/* Voice select */}
                <div className="setting-row">
                  <label className="field-label">ボイス選択</label>
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

                {/* Reset to voice defaults */}
                {(() => {
                  const curVoice = voices[selectedVoiceIdx];
                  const curDef = curVoice ? getDefaultConfigForVoice(curVoice.name) : { speed: 1.2, pitch: 1.0, volume: 85 };
                  return (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", marginTop: "4px", padding: "6px 8px", background: "var(--bg-input)", border: "1px solid var(--border-input)", borderRadius: "4px", flexWrap: "wrap" }}>
                      <button
                        onClick={handleResetToVoiceDefaults}
                        className="btn-action"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "5px",
                          padding: "4px 9px",
                          fontSize: "11px",
                          background: "var(--bg-btn-secondary)",
                          color: "var(--text-btn-secondary)",
                          border: "1px solid var(--border-btn-secondary)",
                          borderRadius: "3px",
                          cursor: "pointer",
                          fontWeight: 500
                        }}
                        title="このボイスの初期値（話速・ピッチ・音量）に戻す"
                      >
                        <RotateCcw size={11} />
                        <span>初期値にリセット</span>
                      </button>
                      <div style={{ fontSize: "10px", color: "var(--text-secondary)", fontFamily: "monospace" }}>
                        {resetFeedbackMsg ? (
                          <span style={{ color: "var(--text-primary)", fontWeight: "bold" }}>{resetFeedbackMsg}</span>
                        ) : (
                          <span>
                            初期値: {curDef.speed.toFixed(1)}x / {curDef.pitch.toFixed(1)}x / {curDef.volume}%
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* Info Box */}
                <div className="info-alert" style={{ marginTop: "6px" }}>
                  <HelpCircle size={12} style={{ flexShrink: 0, marginTop: "1px" }} />
                  <span>
                    話速・ピッチ・音量・ボイスは現在選択中の【{slotNames[vidSlot]}】に自動保存されます。
                  </span>
                </div>
              </div>
            )}

            {/* 3. アバター動画設定 */}
            {activeTab === "avatar" && (
              <div className="tab-pane" style={{ padding: 0 }}>
                {/* スロット選択 */}
                <div className="setting-row">
                  <div className="setting-label-row">
                    <span>対象スロット</span>
                    <span style={{ fontWeight: "bold" }}>{slotNames[vidSlot]}</span>
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

                {/* スロット名変更 */}
                <div className="setting-row" style={{ marginTop: "6px" }}>
                  <label className="field-label">スロット表示名 (キャラクター / 動画名)</label>
                  <input
                    type="text"
                    value={slotNames[vidSlot] || ""}
                    onChange={(e) => {
                      const val = stripEmojis(e.target.value);
                      setSlotNames((prev) => {
                        const next = [...prev];
                        next[vidSlot] = val;
                        localStorage.setItem(`solid-tts-slot-${vidSlot}-name`, val);
                        return next;
                      });
                    }}
                    placeholder={`スロット ${vidSlot + 1} の名称を入力`}
                    className="input-field"
                    style={{ width: "100%", padding: "6px 8px", boxSizing: "border-box" }}
                  />
                </div>

                {/* 動画ファイル選択 & 削除 */}
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
                      動画ファイルを選択
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

                {/* 口パク連動トグル */}
                <div className="setting-row" style={{ marginTop: "8px" }}>
                  <button
                    onClick={toggleVidSync}
                    className="btn-action"
                    style={{
                      width: "100%",
                      padding: "7px",
                      fontWeight: "bold",
                      background: vidSyncEnabled ? "var(--bg-btn-primary)" : "var(--bg-btn-secondary)",
                      color: vidSyncEnabled ? "var(--text-btn-primary)" : "var(--text-btn-secondary)"
                    }}
                  >
                    {vidSyncEnabled ? "読み上げ・動画連動: ON" : "読み上げ・動画連動: OFF"}
                  </button>
                </div>

                {/* 動画表示トグル */}
                <div className="setting-row" style={{ marginTop: "6px" }}>
                  <button
                    onClick={toggleVidVisible}
                    className="btn-action"
                    style={{
                      width: "100%",
                      padding: "6px",
                      borderColor: "var(--border-btn-secondary)"
                    }}
                  >
                    {vidVisible ? "プレビュー枠: 常時表示中" : "プレビュー枠: 非表示中"}
                  </button>
                </div>

                {/* 動画再生速度 */}
                <div className="setting-row" style={{ marginTop: "8px" }}>
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
              </div>
            )}

            {/* 4. テーマ＆フォント設定 */}
            {activeTab === "theme" && (
              <div className="tab-pane" style={{ padding: 0 }}>
                {/* テーマ選択 */}
                <div className="setting-row">
                  <label className="field-label" style={{ marginBottom: "6px" }}>カラーテーマ</label>
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

                {/* 動画の帯（背景）カラー選択 */}
                <div className="setting-row" style={{ marginTop: "8px" }}>
                  <label className="field-label" style={{ marginBottom: "6px" }}>動画の帯（背景）カラー</label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                    <button
                      onClick={() => handleVidBgChange("black")}
                      className="btn-action"
                      style={{
                        padding: "6px 10px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "6px",
                        background: vidBgColor === "black" ? "var(--bg-btn-primary)" : "var(--bg-btn-secondary)",
                        color: vidBgColor === "black" ? "var(--text-btn-primary)" : "var(--text-btn-secondary)",
                        borderColor: vidBgColor === "black" ? "transparent" : "var(--border-btn-secondary)",
                        outline: vidBgColor === "black" ? "2px solid var(--bg-btn-primary)" : "none",
                        borderRadius: "4px",
                        fontWeight: vidBgColor === "black" ? "bold" : "normal"
                      }}
                    >
                      <span style={{ display: "inline-block", width: "10px", height: "10px", borderRadius: "2px", background: "#000000", border: "1px solid #555" }} />
                      <span>黒帯</span>
                    </button>
                    <button
                      onClick={() => handleVidBgChange("white")}
                      className="btn-action"
                      style={{
                        padding: "6px 10px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "6px",
                        background: vidBgColor === "white" ? "var(--bg-btn-primary)" : "var(--bg-btn-secondary)",
                        color: vidBgColor === "white" ? "var(--text-btn-primary)" : "var(--text-btn-secondary)",
                        borderColor: vidBgColor === "white" ? "transparent" : "var(--border-btn-secondary)",
                        outline: vidBgColor === "white" ? "2px solid var(--bg-btn-primary)" : "none",
                        borderRadius: "4px",
                        fontWeight: vidBgColor === "white" ? "bold" : "normal"
                      }}
                    >
                      <span style={{ display: "inline-block", width: "10px", height: "10px", borderRadius: "2px", background: "#ffffff", border: "1px solid #888" }} />
                      <span>白帯</span>
                    </button>
                  </div>
                </div>

                {/* フォント選択 */}
                <div className="setting-row" style={{ marginTop: "8px" }}>
                  <label className="field-label" style={{ marginBottom: "6px" }}>フォント</label>
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

                {/* フォントサイズ */}
                <div className="setting-row" style={{ marginTop: "8px" }}>
                  <label className="field-label" style={{ marginBottom: "6px" }}>文字サイズ</label>
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
        </div>
      </div>

      {/* ── 常に画面最下部に固定されるコントロールバー（カオルさまご要望機能） ── */}
      <div className="pinned-bottom-bar">
        {/* パネル内設定サブタブ（音声コントロール / アバター動画 / テーマ＆フォント） */}
        <div
          className="tabs-container"
          style={{
            borderRadius: "6px",
            overflow: "hidden",
            marginBottom: "2px",
            flexShrink: 0,
            border: "1px solid var(--border-btn-secondary)"
          }}
        >
          <button
            onClick={() => {
              setActiveTab("voice");
              setDrawerMode("none");
            }}
            className="tab-button"
            style={{
              padding: "7px 4px",
              fontSize: "calc(var(--font-size-current) * 0.95)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "5px",
              background: activeTab === "voice" && drawerMode === "none" ? "var(--bg-btn-primary)" : "var(--bg-btn-secondary)",
              color: activeTab === "voice" && drawerMode === "none" ? "var(--text-btn-primary)" : "var(--text-btn-secondary)"
            }}
          >
            <Mic size={12} />
            <span>音声コントロール</span>
          </button>
          <button
            onClick={() => {
              setActiveTab("avatar");
            }}
            className="tab-button"
            style={{
              padding: "7px 4px",
              fontSize: "calc(var(--font-size-current) * 0.95)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "5px",
              background: activeTab === "avatar" ? "var(--bg-btn-primary)" : "var(--bg-btn-secondary)",
              color: activeTab === "avatar" ? "var(--text-btn-primary)" : "var(--text-btn-secondary)"
            }}
          >
            <Video size={12} />
            <span>アバター動画</span>
          </button>
          <button
            onClick={() => {
              setActiveTab("theme");
            }}
            className="tab-button"
            style={{
              padding: "7px 4px",
              fontSize: "calc(var(--font-size-current) * 0.95)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "5px",
              background: activeTab === "theme" ? "var(--bg-btn-primary)" : "var(--bg-btn-secondary)",
              color: activeTab === "theme" ? "var(--text-btn-primary)" : "var(--text-btn-secondary)"
            }}
          >
            <Sliders size={12} />
            <span>テーマ＆フォント</span>
          </button>
        </div>

        {/* クリップボード読み上げボタン（常時最前面・ワンクリック） */}
        <button onClick={readClipboard} className="btn-primary" style={{ padding: "8px 12px" }}>
          <Clipboard size={14} />
          <span>クリップボードを読み上げる</span>
        </button>

        {/* アクションボタングループ（再生・一時停止・全停止） */}
        <div className="actions-strip" style={{ margin: "1px 0" }}>
          <button
            onClick={() => {
              if (textToRead.trim()) {
                addToHistory(textToRead, "manual");
                startSpeaking(textToRead);
              }
            }}
            disabled={!textToRead.trim()}
            className="btn-action"
            title={!textToRead.trim() ? "テキストを入力または貼り付けてください" : "再生"}
          >
            <Play size={11} />
            <span>再生</span>
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
            <span>{isPaused ? "再開" : "一時停止"}</span>
          </button>
          <button onClick={stopSpeaking} className="btn-action btn-stop">
            <Square size={11} />
            <span>全停止</span>
          </button>
        </div>

        {/* 上にシュッと開くトグルボタン列（テキスト入力 ＆ 読上履歴 ＆ ボイス・話速詳細） */}
        <div className="drawer-trigger-row">
          <button
            onClick={() => {
              if (activeTab !== "voice") setActiveTab("voice");
              setDrawerMode(drawerMode === "text" ? "none" : "text");
            }}
            className={`drawer-trigger-btn ${activeTab === "voice" && drawerMode === "text" ? "active" : ""}`}
            title="テキスト入力欄の表示切替"
          >
            <Edit3 size={11} />
            <span>{activeTab === "voice" && drawerMode === "text" ? "入力欄を閉じる" : "テキスト入力"}</span>
          </button>
          <button
            onClick={() => {
              if (activeTab !== "voice") setActiveTab("voice");
              setDrawerMode(drawerMode === "history" ? "none" : "history");
            }}
            className={`drawer-trigger-btn ${activeTab === "voice" && drawerMode === "history" ? "active" : ""}`}
            title="直近10件の読上履歴リストを表示"
          >
            <History size={11} />
            <span>
              {activeTab === "voice" && drawerMode === "history"
                ? "履歴を閉じる"
                : `読上履歴 (${historyList.length})`}
            </span>
          </button>
          <button
            onClick={() => {
              if (activeTab !== "voice") setActiveTab("voice");
              setDrawerMode(drawerMode === "voice_settings" ? "none" : "voice_settings");
            }}
            className={`drawer-trigger-btn ${activeTab === "voice" && drawerMode === "voice_settings" ? "active" : ""}`}
            title="ボイス・話速の詳細設定の表示切替"
          >
            <Settings size={11} />
            <span>{activeTab === "voice" && drawerMode === "voice_settings" ? "設定を閉じる" : "ボイス詳細"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
