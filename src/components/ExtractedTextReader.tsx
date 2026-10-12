import React, { useState, useEffect, useRef, useCallback } from 'react';
import { pdfjsLib } from '../lib/pdfWorker';
import {
  PdfItem,
  Bookmark,
  ReadingSettings,
  ReadingTheme,
  TextFontFamily,
  TextLineHeight,
  TextAlign,
  ExtractedPageText
} from '../types';
import {
  extractTextFromPage,
  extractAllPages,
  copyTextToClipboard,
  downloadTextAsFile
} from '../lib/pdfTextExtractor';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Bookmark as BookmarkIcon,
  Volume2,
  VolumeX,
  Play,
  Pause,
  Square,
  Copy,
  Check,
  Download,
  Settings2,
  FileText,
  Search,
  X,
  Sparkles,
  BookOpen,
  Eye,
  Sliders,
  Type,
  AlignLeft,
  AlignJustify,
  Maximize2,
  Minimize2,
  RefreshCw,
  Info
} from 'lucide-react';

interface Props {
  doc: pdfjsLib.PDFDocumentProxy;
  pdf: PdfItem;
  currentPage: number;
  numPages: number;
  settings: ReadingSettings;
  bookmarks: Bookmark[];
  onPageChange: (page: number) => void;
  onUpdateSettings: (settings: ReadingSettings) => void;
  onToggleBookmark: (page: number) => void;
  onSwitchToPdfMode: () => void;
  onBackToLibrary: () => void;
  onOpenBookmarksModal: () => void;
}

export const ExtractedTextReader: React.FC<Props> = ({
  doc,
  pdf,
  currentPage,
  numPages,
  settings,
  bookmarks,
  onPageChange,
  onUpdateSettings,
  onToggleBookmark,
  onSwitchToPdfMode,
  onBackToLibrary,
  onOpenBookmarksModal,
}) => {
  // Page Cache
  const [pageCache, setPageCache] = useState<Record<number, ExtractedPageText>>({});
  const [isLoadingCurrent, setIsLoadingCurrent] = useState<boolean>(true);

  // Full document extraction
  const [isExtractingAll, setIsExtractingAll] = useState<boolean>(false);
  const [extractAllProgress, setExtractAllProgress] = useState<{ current: number; total: number } | null>(null);
  const [viewScope, setViewScope] = useState<'page' | 'all'>('page');

  // UI Panels
  const [showTypographyPanel, setShowTypographyPanel] = useState<boolean>(false);
  const [showSearchPanel, setShowSearchPanel] = useState<boolean>(false);
  const [textSearchQuery, setTextSearchQuery] = useState<string>('');
  const [copiedToast, setCopiedToast] = useState<string | null>(null);

  // Text-to-Speech (Sintesi Vocale)
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [speechRate, setSpeechRate] = useState<number>(1.0);
  const [activeSpeakingParagraph, setActiveSpeakingParagraph] = useState<number | null>(null);
  const speechUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Reading settings with fallbacks
  const fontSize = settings.textFontSize && settings.textFontSize >= 16 ? settings.textFontSize : 22;
  const fontFamily: TextFontFamily = settings.textFontFamily || 'serif';
  const lineHeight: TextLineHeight = settings.textLineHeight || 'relaxed';
  const textAlign: TextAlign = settings.textAlign || 'left';
  const theme: ReadingTheme = settings.theme || 'light';
  const smartParagraphs = settings.smartParagraphs !== false;

  const isCurrentBookmarked = bookmarks.some(b => b.pdfId === pdf.id && b.pageNumber === currentPage);

  // Load and cache text for current page (and preload adjacent pages)
  useEffect(() => {
    let active = true;

    const loadPage = async (pageNum: number) => {
      if (pageCache[pageNum]) return pageCache[pageNum];
      const extracted = await extractTextFromPage(doc, pageNum, smartParagraphs);
      if (active) {
        setPageCache(prev => ({ ...prev, [pageNum]: extracted }));
      }
      return extracted;
    };

    if (!pageCache[currentPage]) {
      setIsLoadingCurrent(true);
      loadPage(currentPage).then(() => {
        if (active) setIsLoadingCurrent(false);
      });
    } else {
      setIsLoadingCurrent(false);
    }

    // Preload next page in background for seamless turning
    if (currentPage < numPages && !pageCache[currentPage + 1]) {
      loadPage(currentPage + 1);
    }
    // Preload previous page
    if (currentPage > 1 && !pageCache[currentPage - 1]) {
      loadPage(currentPage - 1);
    }

    return () => {
      active = false;
    };
  }, [doc, currentPage, numPages, smartParagraphs]);

  // Stop speech synthesis when changing pages or unmounting
  const stopSpeech = useCallback(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
    setIsPaused(false);
    setActiveSpeakingParagraph(null);
  }, []);

  useEffect(() => {
    stopSpeech();
    return () => {
      stopSpeech();
    };
  }, [currentPage, stopSpeech]);

  // Handle Full Extraction
  const handleExtractAll = async () => {
    if (isExtractingAll) return;
    setIsExtractingAll(true);
    setExtractAllProgress({ current: 0, total: numPages });

    try {
      const allPages = await extractAllPages(doc, smartParagraphs, (cur, total) => {
        setExtractAllProgress({ current: cur, total });
      });

      const newCache: Record<number, ExtractedPageText> = {};
      allPages.forEach(p => {
        newCache[p.pageNumber] = p;
      });

      setPageCache(prev => ({ ...prev, ...newCache }));
      setViewScope('all');
      showToast('Tutte le ' + numPages + ' pagine sono state estratte!');
    } catch (err) {
      console.error('Error extracting all pages:', err);
    } finally {
      setIsExtractingAll(false);
      setExtractAllProgress(null);
    }
  };

  // Toast feedback helper
  const showToast = (message: string) => {
    setCopiedToast(message);
    setTimeout(() => setCopiedToast(null), 2500);
  };

  // Copy current page or full text
  const handleCopyText = async (onlyCurrent: boolean = true) => {
    let contentToCopy = '';
    if (onlyCurrent) {
      const curData = pageCache[currentPage];
      contentToCopy = curData?.text || '';
    } else {
      const pageNumbers = Array.from({ length: numPages }, (_, i) => i + 1);
      const textParts = pageNumbers.map(n => {
        const p = pageCache[n];
        return `--- PAGINA ${n} ---\n\n${p?.text || '[Testo non ancora estratto]'}`;
      });
      contentToCopy = `${pdf.title}\n\n` + textParts.join('\n\n\n');
    }

    if (!contentToCopy.trim()) {
      showToast('Nessun testo da copiare.');
      return;
    }

    const ok = await copyTextToClipboard(contentToCopy);
    if (ok) {
      showToast(onlyCurrent ? `Testo pagina ${currentPage} copiato!` : 'Testo completo del documento copiato!');
    } else {
      showToast('Impossibile copiare il testo.');
    }
  };

  // Download .txt file
  const handleDownloadTxt = (onlyCurrent: boolean = false) => {
    let content = '';
    if (onlyCurrent) {
      const curData = pageCache[currentPage];
      content = `--- ${pdf.title} • Pagina ${currentPage} ---\n\n${curData?.text || ''}`;
      downloadTextAsFile(`${pdf.title}_pag_${currentPage}`, content);
    } else {
      const pageNumbers = Array.from({ length: numPages }, (_, i) => i + 1);
      const parts = pageNumbers.map(n => {
        const p = pageCache[n];
        return `========================================\n[PAGINA ${n} di ${numPages}]\n========================================\n\n${p?.text || ''}`;
      });
      content = `${pdf.title}\nAutore: ${pdf.author || 'Sconosciuto'}\nEstratto il: ${new Date().toLocaleDateString('it-IT')}\n\n` + parts.join('\n\n\n');
      downloadTextAsFile(pdf.title, content);
    }
    showToast('File di testo scaricato!');
  };

  // Text-To-Speech Execution
  const handleToggleSpeech = () => {
    if (!('speechSynthesis' in window)) {
      showToast('La sintesi vocale non è supportata da questo browser.');
      return;
    }

    if (isSpeaking) {
      if (isPaused) {
        window.speechSynthesis.resume();
        setIsPaused(false);
      } else {
        window.speechSynthesis.pause();
        setIsPaused(true);
      }
      return;
    }

    const currentData = pageCache[currentPage];
    if (!currentData || !currentData.text.trim()) {
      showToast('Nessun testo da riprodurre su questa pagina.');
      return;
    }

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(currentData.text);
    utterance.lang = 'it-IT';
    utterance.rate = speechRate;

    // Pick best Italian voice if available
    const voices = window.speechSynthesis.getVoices();
    const italianVoice = voices.find(v => v.lang.startsWith('it'));
    if (italianVoice) {
      utterance.voice = italianVoice;
    }

    utterance.onstart = () => {
      setIsSpeaking(true);
      setIsPaused(false);
    };

    utterance.onend = () => {
      setIsSpeaking(false);
      setIsPaused(false);
      setActiveSpeakingParagraph(null);
    };

    utterance.onerror = (e) => {
      console.error('TTS error:', e);
      setIsSpeaking(false);
      setIsPaused(false);
      setActiveSpeakingParagraph(null);
    };

    speechUtteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  };

  const handleSpeechRateChange = (newRate: number) => {
    setSpeechRate(newRate);
    if (isSpeaking) {
      // Restart speaking with new rate
      stopSpeech();
      setTimeout(() => {
        handleToggleSpeech();
      }, 100);
    }
  };

  // Change font size
  const adjustFontSize = (delta: number) => {
    const newSize = Math.max(16, Math.min(36, fontSize + delta));
    onUpdateSettings({ ...settings, textFontSize: newSize });
  };

  // Theme-specific styles for text reading mode (Zero artificial light, matte anti-glare natural paper)
  const getThemeClasses = () => {
    switch (theme) {
      case 'sepia':
        return {
          wrapper: 'bg-[#EAE0CA] text-[#332215]',
          header: 'bg-[#DFD3BA] text-[#332215] border-[#CFC0A0]',
          footer: 'bg-[#DFD3BA] text-[#332215] border-[#CFC0A0]',
          panel: 'bg-[#F5EDD8] text-[#332215] border-[#D5C6A8] shadow-md',
          sheet: 'bg-[#F6EED9] text-[#2D1E12] border-[#D8C9AA]',
          buttonActive: 'bg-[#D2C19E] text-[#1F140A] font-bold',
          buttonHover: 'hover:bg-[#D9CBAA]',
          card: 'bg-[#F6EED9] border-[#D8C9AA]',
          tag: 'bg-[#DFD2B4] text-[#422D1A]',
          divider: 'border-[#DFCDB0]',
        };
      case 'dark':
      case 'night':
        return {
          wrapper: 'bg-[#141517] text-[#D8D8D8]',
          header: 'bg-[#1B1C1F] text-[#E4E4E4] border-[#2A2B30]',
          footer: 'bg-[#1B1C1F] text-[#E4E4E4] border-[#2A2B30]',
          panel: 'bg-[#1E2024] text-[#E4E4E4] border-[#31333A] shadow-md',
          sheet: 'bg-[#1B1C1F] text-[#E0E0E0] border-[#2D2E33]',
          buttonActive: 'bg-[#35373E] text-white font-bold',
          buttonHover: 'hover:bg-[#2A2B30]',
          card: 'bg-[#1B1C1F] border-[#2D2E33]',
          tag: 'bg-[#2A2B30] text-[#A0A0A0]',
          divider: 'border-[#2A2B30]',
        };
      case 'emerald':
        return {
          wrapper: 'bg-[#E0EBE2] text-[#14331C]',
          header: 'bg-[#D2E2D5] text-[#14331C] border-[#BFD6C3]',
          footer: 'bg-[#D2E2D5] text-[#14331C] border-[#BFD6C3]',
          panel: 'bg-[#EBF5EC] text-[#14331C] border-[#BFD6C3] shadow-md',
          sheet: 'bg-[#EBF5EC] text-[#0F2916] border-[#BFD6C3]',
          buttonActive: 'bg-[#BEDBBF] text-[#0A2614] font-bold',
          buttonHover: 'hover:bg-[#CBE3CE]',
          card: 'bg-[#EBF5EC] border-[#BFD6C3]',
          tag: 'bg-[#CBE3CE] text-[#164428]',
          divider: 'border-[#CCE2CF]',
        };
      case 'light':
      default:
        // Bianco naturale e nero puro (carta bianca pulita, testo nero nitido, zero tinte artificiali)
        return {
          wrapper: 'bg-[#F4F4F5] text-black',
          header: 'bg-white text-stone-900 border-stone-200 shadow-xs',
          footer: 'bg-white text-stone-900 border-stone-200 shadow-xs',
          panel: 'bg-white text-stone-900 border-stone-200 shadow-xl',
          sheet: 'bg-white text-black border border-stone-200 shadow-xs',
          buttonActive: 'bg-stone-900 text-white font-bold',
          buttonHover: 'hover:bg-stone-100',
          card: 'bg-white border-stone-200',
          tag: 'bg-stone-100 text-stone-800 border border-stone-200',
          divider: 'border-stone-200',
        };
    }
  };

  const themeStyle = getThemeClasses();

  // Typography font class
  const getFontFamilyClass = () => {
    switch (fontFamily) {
      case 'sans':
        return 'font-sans';
      case 'mono':
        return 'font-mono text-[92%]';
      case 'serif':
      default:
        return 'font-serif';
    }
  };

  const getLineHeightClass = () => {
    switch (lineHeight) {
      case 'compact':
        return 'leading-relaxed';
      case 'relaxed':
        return 'leading-[2.2]';
      case 'normal':
      default:
        return 'leading-loose';
    }
  };

  const currentPageData = pageCache[currentPage];

  // Helper to render text with search highlights
  const renderParagraphText = (text: string) => {
    if (!textSearchQuery.trim()) {
      return text;
    }
    const regex = new RegExp(`(${textSearchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const parts = text.split(regex);
    return parts.map((part, i) =>
      regex.test(part) ? (
        <mark key={i} className="bg-amber-300 text-slate-900 px-0.5 rounded-xs font-semibold">
          {part}
        </mark>
      ) : (
        part
      )
    );
  };

  // Estimate read time
  const words = currentPageData?.wordCount || 0;
  const readMinutes = Math.max(1, Math.round(words / 200));

  return (
    <div className={`min-h-screen flex flex-col ${themeStyle.wrapper} select-text transition-colors duration-200`}>
      {/* 1. Header Toolbar Superiore */}
      <header className={`sticky top-0 z-30 px-3 py-2 border-b flex items-center justify-between gap-2 transition-colors ${themeStyle.header}`}>
        {/* Left: Back to Library & Switch to Visual PDF */}
        <div className="flex items-center gap-2 overflow-hidden">
          {/* Pulsante Torna alla Libreria ben visibile con icona e testo */}
          <button
            onClick={onBackToLibrary}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold text-xs uppercase tracking-wider bg-stone-100 hover:bg-stone-200 text-stone-900 border border-stone-300 transition-all shrink-0 cursor-pointer shadow-xs"
            title="Torna alla Libreria dei libri"
          >
            <ArrowLeft size={16} />
            <span>Libreria</span>
          </button>

          {/* Toggle Button to Switch back to Original PDF View */}
          <button
            onClick={onSwitchToPdfMode}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-stone-900 hover:bg-stone-800 text-white border border-stone-800 shadow-xs transition-all shrink-0 cursor-pointer"
            title="Torna alla visualizzazione PDF originale con grafica e impaginazione"
          >
            <BookOpen size={15} />
            <span>PDF Grafico</span>
          </button>

          <div className="truncate hidden sm:block">
            <h2 className="font-semibold text-xs truncate leading-tight text-stone-900">
              {pdf.title}
            </h2>
            <div className="text-[11px] text-stone-500 font-mono">
              Modalità Testo Estratto • Pagina {currentPage} di {numPages}
            </div>
          </div>
        </div>

        {/* Center: Scope Toggle (Pagina Singola vs Tutto il Documento) */}
        <div className="flex items-center bg-black/5 dark:bg-white/10 p-0.5 rounded-xl text-xs font-medium border border-black/10 dark:border-white/10">
          <button
            onClick={() => setViewScope('page')}
            className={`px-2.5 py-1 rounded-lg transition-all ${
              viewScope === 'page'
                ? `${themeStyle.buttonActive} shadow-xs font-semibold`
                : 'opacity-70 hover:opacity-100 cursor-pointer'
            }`}
          >
            Pagina
          </button>
          <button
            onClick={() => {
              if (Object.keys(pageCache).length < numPages && !isExtractingAll) {
                handleExtractAll();
              } else {
                setViewScope('all');
              }
            }}
            className={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1 cursor-pointer ${
              viewScope === 'all'
                ? `${themeStyle.buttonActive} shadow-xs font-semibold`
                : 'opacity-70 hover:opacity-100'
            }`}
            title="Mostra tutte le pagine in un flusso di lettura continuo"
          >
            <span>Tutto ({numPages})</span>
            {isExtractingAll && <RefreshCw size={11} className="animate-spin" />}
          </button>
        </div>

        {/* Right Actions: Quick Font A-/A+, TTS, Typography, Search, Copy, Bookmark */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Quick Font Size Controls (Ingrandisci / Rimpicciolisci Font) */}
          <div className="flex items-center bg-black/5 dark:bg-white/10 rounded-xl px-1 py-0.5 border border-black/10 dark:border-white/10 text-xs" title="Regola grandezza caratteri">
            <button
              onClick={() => adjustFontSize(-2)}
              disabled={fontSize <= 16}
              className="px-2 py-0.5 rounded font-bold hover:bg-black/10 dark:hover:bg-white/10 disabled:opacity-30 cursor-pointer"
              title="Riduci font (A-)"
            >
              A-
            </button>
            <span className="font-mono font-bold px-1.5 min-w-[34px] text-center select-none text-[11px]">
              {fontSize}px
            </span>
            <button
              onClick={() => adjustFontSize(2)}
              disabled={fontSize >= 36}
              className="px-2 py-0.5 rounded font-bold hover:bg-black/10 dark:hover:bg-white/10 disabled:opacity-30 cursor-pointer"
              title="Ingrandisci font (A+)"
            >
              A+
            </button>
          </div>

          {/* Text-To-Speech (Lettura Vocale) */}
          <button
            onClick={handleToggleSpeech}
            className={`p-2 rounded-xl transition-all border ${
              isSpeaking
                ? 'bg-amber-500 text-slate-950 border-amber-400 font-bold shadow-sm animate-pulse'
                : `${themeStyle.buttonHover} border-transparent opacity-80 hover:opacity-100`
            }`}
            title={isSpeaking ? (isPaused ? 'Riprendi lettura vocale' : 'Metti in pausa') : 'Ascolta testo (Lettura ad alta voce)'}
          >
            {isSpeaking ? (isPaused ? <Play size={18} /> : <Pause size={18} />) : <Volume2 size={18} />}
          </button>

          {/* Typography & Settings Panel Toggle */}
          <button
            onClick={() => {
              setShowTypographyPanel(!showTypographyPanel);
              setShowSearchPanel(false);
            }}
            className={`p-2 rounded-xl transition-all border ${
              showTypographyPanel
                ? `${themeStyle.buttonActive} border-sky-400/50`
                : `${themeStyle.buttonHover} border-transparent`
            }`}
            title="Regola carattere, dimensione font, interlinea e tema"
          >
            <Sliders size={18} />
          </button>

          {/* Search Trigger */}
          <button
            onClick={() => {
              setShowSearchPanel(!showSearchPanel);
              setShowTypographyPanel(false);
            }}
            className={`p-2 rounded-xl transition-all border ${
              showSearchPanel || textSearchQuery
                ? 'bg-sky-500/20 text-sky-600 border-sky-400/50'
                : `${themeStyle.buttonHover} border-transparent opacity-80 hover:opacity-100`
            }`}
            title="Cerca nel testo estratto"
          >
            <Search size={18} />
          </button>

          {/* Quick Copy Page Text */}
          <button
            onClick={() => handleCopyText(true)}
            className={`p-2 rounded-xl transition-all ${themeStyle.buttonHover} opacity-80 hover:opacity-100 hidden sm:flex`}
            title="Copia testo della pagina negli appunti"
          >
            <Copy size={17} />
          </button>

          {/* Bookmark Button */}
          <button
            onClick={() => onToggleBookmark(currentPage)}
            className={`p-2 rounded-xl transition-all ${
              isCurrentBookmarked
                ? 'bg-amber-500 text-slate-950 shadow-sm'
                : `${themeStyle.buttonHover} opacity-80 hover:opacity-100`
            }`}
            title={isCurrentBookmarked ? 'Rimuovi segnalibro' : 'Aggiungi segnalibro a questa pagina'}
          >
            <BookmarkIcon size={18} className={isCurrentBookmarked ? 'fill-slate-950' : ''} />
          </button>
        </div>
      </header>

      {/* Floating Toast Notification */}
      {copiedToast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-slate-900/95 text-white text-xs font-medium rounded-full shadow-2xl border border-slate-700 backdrop-blur-md transition-all flex items-center gap-2">
          <Check size={14} className="text-emerald-400" />
          <span>{copiedToast}</span>
        </div>
      )}

      {/* Audio Bar (when Speaking or paused) */}
      {isSpeaking && (
        <div className="sticky top-12 z-25 px-4 py-2 bg-amber-500/15 border-b border-amber-500/30 backdrop-blur-xs flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 font-medium">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
            <span>Lettura ad alta voce in corso (Pagina {currentPage})</span>
          </div>

          <div className="flex items-center gap-2">
            {/* Speed Toggle */}
            <div className="flex items-center bg-black/10 rounded-lg p-0.5 text-[11px] font-mono">
              {[0.8, 1.0, 1.25, 1.5].map(rate => (
                <button
                  key={rate}
                  onClick={() => handleSpeechRateChange(rate)}
                  className={`px-1.5 py-0.5 rounded-md ${speechRate === rate ? 'bg-amber-500 text-slate-950 font-bold' : 'opacity-70'}`}
                >
                  {rate}x
                </button>
              ))}
            </div>

            <button
              onClick={stopSpeech}
              className="p-1 rounded-lg hover:bg-black/10 text-rose-600 font-bold flex items-center gap-1"
              title="Ferma audio"
            >
              <Square size={14} />
              <span className="hidden sm:inline">Stop</span>
            </button>
          </div>
        </div>
      )}

      {/* Typography & Appearance Dropdown Panel */}
      {showTypographyPanel && (
        <div className={`fixed top-14 right-4 z-40 w-80 sm:w-96 rounded-2xl border p-4 shadow-2xl animate-slideUp text-xs space-y-4 ${themeStyle.panel}`}>
          <div className="flex items-center justify-between pb-2 border-b border-black/10 dark:border-white/10">
            <h3 className="font-bold flex items-center gap-1.5 text-sm">
              <Type size={16} className="text-sky-500" /> Personalizza Lettura Testo
            </h3>
            <button
              onClick={() => setShowTypographyPanel(false)}
              className="p-1 rounded-md opacity-60 hover:opacity-100"
            >
              <X size={16} />
            </button>
          </div>

          {/* 1. Font Size Control */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-medium opacity-80">Dimensione Caratteri (Testo Grande)</span>
              <span className="font-mono font-bold text-amber-900 dark:text-amber-200">{fontSize}px</span>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => adjustFontSize(-2)}
                disabled={fontSize <= 16}
                className="px-2.5 py-1 rounded-lg border border-black/15 dark:border-white/15 hover:bg-black/5 disabled:opacity-30 font-bold cursor-pointer"
              >
                A-
              </button>
              <input
                type="range"
                min="16"
                max="36"
                step="1"
                value={fontSize}
                onChange={(e) => onUpdateSettings({ ...settings, textFontSize: parseInt(e.target.value, 10) })}
                className="flex-1 accent-amber-700 h-2 bg-black/10 dark:bg-white/10 rounded-lg cursor-pointer"
              />
              <button
                onClick={() => adjustFontSize(2)}
                disabled={fontSize >= 36}
                className="px-2.5 py-1 rounded-lg border border-black/15 dark:border-white/15 hover:bg-black/5 disabled:opacity-30 font-bold text-sm cursor-pointer"
              >
                A+
              </button>
            </div>
          </div>

          {/* 2. Font Family */}
          <div>
            <span className="font-medium opacity-80 block mb-1.5">Stile Carattere</span>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                onClick={() => onUpdateSettings({ ...settings, textFontFamily: 'serif' })}
                className={`p-2 rounded-xl border text-center transition-all cursor-pointer ${
                  fontFamily === 'serif' ? 'border-amber-800 bg-amber-800/10 font-bold' : 'border-black/10 dark:border-white/10 opacity-70 hover:opacity-100'
                }`}
              >
                <div className="font-serif text-base">Serif</div>
                <div className="text-[10px] opacity-70">Libro classico</div>
              </button>
              <button
                onClick={() => onUpdateSettings({ ...settings, textFontFamily: 'sans' })}
                className={`p-2 rounded-xl border text-center transition-all cursor-pointer ${
                  fontFamily === 'sans' ? 'border-amber-800 bg-amber-800/10 font-bold' : 'border-black/10 dark:border-white/10 opacity-70 hover:opacity-100'
                }`}
              >
                <div className="font-sans text-base">Sans</div>
                <div className="text-[10px] opacity-70">Moderno pulito</div>
              </button>
              <button
                onClick={() => onUpdateSettings({ ...settings, textFontFamily: 'mono' })}
                className={`p-2 rounded-xl border text-center transition-all cursor-pointer ${
                  fontFamily === 'mono' ? 'border-amber-800 bg-amber-800/10 font-bold' : 'border-black/10 dark:border-white/10 opacity-70 hover:opacity-100'
                }`}
              >
                <div className="font-mono text-base">Mono</div>
                <div className="text-[10px] opacity-70">Monospazio</div>
              </button>
            </div>
          </div>

          {/* 3. Reading Themes */}
          <div>
            <span className="font-medium opacity-80 block mb-1.5">Carta e Tonalità (Zero riflessi)</span>
            <div className="grid grid-cols-4 gap-1.5">
              <button
                onClick={() => onUpdateSettings({ ...settings, theme: 'light' })}
                className={`p-2 rounded-xl border flex flex-col items-center gap-1 transition-all bg-[#FAF7F0] text-[#111111] cursor-pointer ${
                  theme === 'light' ? 'ring-2 ring-amber-800 font-bold border-transparent' : 'border-[#DFD9CD]'
                }`}
              >
                <div className="w-4 h-4 rounded-full bg-[#FAF7F0] border border-[#C5BDAF]" />
                <span className="text-[10px]">Bianco</span>
              </button>
              <button
                onClick={() => onUpdateSettings({ ...settings, theme: 'sepia' })}
                className={`p-2 rounded-xl border flex flex-col items-center gap-1 transition-all bg-[#F6EED9] text-[#2D1E12] cursor-pointer ${
                  theme === 'sepia' ? 'ring-2 ring-amber-800 font-bold border-transparent' : 'border-[#DAC8A8]'
                }`}
              >
                <div className="w-4 h-4 rounded-full bg-[#E8DCBF] border border-[#C5B38F]" />
                <span className="text-[10px]">Sepia</span>
              </button>
              <button
                onClick={() => onUpdateSettings({ ...settings, theme: 'emerald' })}
                className={`p-2 rounded-xl border flex flex-col items-center gap-1 transition-all bg-[#EBF5EC] text-[#0F2916] cursor-pointer ${
                  theme === 'emerald' ? 'ring-2 ring-emerald-800 font-bold border-transparent' : 'border-[#C3DCC6]'
                }`}
              >
                <div className="w-4 h-4 rounded-full bg-[#CCE2CF] border border-[#A7CCA9]" />
                <span className="text-[10px]">Verde</span>
              </button>
              <button
                onClick={() => onUpdateSettings({ ...settings, theme: 'dark' })}
                className={`p-2 rounded-xl border flex flex-col items-center gap-1 transition-all bg-[#1B1C1F] text-[#E0E0E0] cursor-pointer ${
                  theme === 'dark' || theme === 'night' ? 'ring-2 ring-stone-400 font-bold border-transparent' : 'border-stone-700'
                }`}
              >
                <div className="w-4 h-4 rounded-full bg-[#1A1B1E] border border-stone-600" />
                <span className="text-[10px]">Notte</span>
              </button>
            </div>
          </div>

          {/* 4. Line Spacing & Alignment */}
          <div className="grid grid-cols-2 gap-3 pt-1 border-t border-black/10 dark:border-white/10">
            <div>
              <span className="font-medium opacity-80 block mb-1">Interlinea</span>
              <div className="flex bg-black/5 dark:bg-white/10 p-0.5 rounded-lg">
                <button
                  onClick={() => onUpdateSettings({ ...settings, textLineHeight: 'compact' })}
                  className={`flex-1 py-1 rounded text-center text-[10px] ${lineHeight === 'compact' ? 'bg-sky-500 text-white font-bold' : 'opacity-70'}`}
                >
                  Compatta
                </button>
                <button
                  onClick={() => onUpdateSettings({ ...settings, textLineHeight: 'normal' })}
                  className={`flex-1 py-1 rounded text-center text-[10px] ${lineHeight === 'normal' ? 'bg-sky-500 text-white font-bold' : 'opacity-70'}`}
                >
                  Normale
                </button>
                <button
                  onClick={() => onUpdateSettings({ ...settings, textLineHeight: 'relaxed' })}
                  className={`flex-1 py-1 rounded text-center text-[10px] ${lineHeight === 'relaxed' ? 'bg-sky-500 text-white font-bold' : 'opacity-70'}`}
                >
                  Ampia
                </button>
              </div>
            </div>

            <div>
              <span className="font-medium opacity-80 block mb-1">Allineamento</span>
              <div className="flex bg-black/5 dark:bg-white/10 p-0.5 rounded-lg">
                <button
                  onClick={() => onUpdateSettings({ ...settings, textAlign: 'left' })}
                  className={`flex-1 py-1 rounded flex items-center justify-center ${textAlign === 'left' ? 'bg-sky-500 text-white font-bold' : 'opacity-70'}`}
                  title="Allinea a sinistra"
                >
                  <AlignLeft size={13} />
                </button>
                <button
                  onClick={() => onUpdateSettings({ ...settings, textAlign: 'justify' })}
                  className={`flex-1 py-1 rounded flex items-center justify-center ${textAlign === 'justify' ? 'bg-sky-500 text-white font-bold' : 'opacity-70'}`}
                  title="Giustifica"
                >
                  <AlignJustify size={13} />
                </button>
              </div>
            </div>
          </div>

          {/* 5. Document Tools */}
          <div className="pt-2 border-t border-black/10 dark:border-white/10 flex flex-col gap-1.5">
            <button
              onClick={() => handleCopyText(false)}
              className="w-full text-left px-3 py-1.5 rounded-xl border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-between"
            >
              <span className="flex items-center gap-2">
                <Copy size={14} className="text-sky-500" /> Copia tutto il testo del documento
              </span>
            </button>
            <button
              onClick={() => handleDownloadTxt(false)}
              className="w-full text-left px-3 py-1.5 rounded-xl border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-between"
            >
              <span className="flex items-center gap-2">
                <Download size={14} className="text-emerald-500" /> Scarica documento come file .txt
              </span>
            </button>
          </div>
        </div>
      )}

      {/* Search in Extracted Text Bar */}
      {showSearchPanel && (
        <div className={`px-4 py-2.5 border-b flex items-center gap-2 transition-all ${themeStyle.panel}`}>
          <Search size={16} className="text-sky-500 shrink-0" />
          <input
            type="text"
            placeholder="Cerca parole o frasi nel testo estratto..."
            value={textSearchQuery}
            onChange={(e) => setTextSearchQuery(e.target.value)}
            className="flex-1 bg-transparent border-none text-xs focus:outline-none"
            autoFocus
          />
          {textSearchQuery && (
            <button
              onClick={() => setTextSearchQuery('')}
              className="p-1 rounded-full opacity-60 hover:opacity-100"
            >
              <X size={14} />
            </button>
          )}
          <button
            onClick={() => setShowSearchPanel(false)}
            className="px-2 py-1 rounded-lg bg-black/10 dark:bg-white/10 text-xs font-semibold"
          >
            Chiudi
          </button>
        </div>
      )}

      {/* 2. Main Reading Viewport */}
      <main className="flex-1 overflow-y-auto px-4 py-8 sm:py-12 sm:px-8">
        <div className="max-w-3xl mx-auto space-y-8">
          {/* Extraction in progress bar */}
          {extractAllProgress && (
            <div className="p-3.5 rounded-2xl bg-sky-500/10 border border-sky-400/30 text-xs flex flex-col gap-2">
              <div className="flex items-center justify-between font-medium">
                <span className="flex items-center gap-2">
                  <RefreshCw size={14} className="animate-spin text-sky-500" />
                  Estrazione testo in corso...
                </span>
                <span className="font-mono font-bold text-sky-600 dark:text-sky-400">
                  {extractAllProgress.current} / {extractAllProgress.total} pagine
                </span>
              </div>
              <div className="w-full bg-black/10 dark:bg-white/10 h-1.5 rounded-full overflow-hidden">
                <div
                  className="bg-sky-500 h-full rounded-full transition-all duration-200"
                  style={{ width: `${(extractAllProgress.current / extractAllProgress.total) * 100}%` }}
                />
              </div>
            </div>
          )}

          {/* VIEW SCOPE: SINGLE PAGE */}
          {viewScope === 'page' && (
            <div>
              {isLoadingCurrent ? (
                <div className="py-24 flex flex-col items-center justify-center text-center space-y-3">
                  <div className="w-8 h-8 border-3 border-sky-500 border-t-transparent rounded-full animate-spin" />
                  <p className="text-xs opacity-70">Estrazione testo da pagina {currentPage} in corso...</p>
                </div>
              ) : currentPageData && !currentPageData.hasText ? (
                /* Empty / Non-text page fallback (e.g. Scanned image or pure graphic) */
                <div className={`p-8 rounded-2xl border text-center space-y-4 max-w-lg mx-auto ${themeStyle.card}`}>
                  <div className="w-12 h-12 rounded-2xl bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto">
                    <Info size={24} />
                  </div>
                  <div>
                    <h3 className="font-bold text-base mb-1">Nessun testo estraibile in Pagina {currentPage}</h3>
                    <p className="text-xs opacity-75 leading-relaxed">
                      Questa pagina non include testo digitale selezionabile (potrebbe trattarsi di una scansione fotografica, un grafico vettoriale o un'illustrazione).
                    </p>
                  </div>
                  <div className="flex flex-col sm:flex-row items-center justify-center gap-2 pt-2">
                    <button
                      onClick={onSwitchToPdfMode}
                      className="w-full sm:w-auto px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold text-xs flex items-center justify-center gap-1.5 shadow-sm"
                    >
                      <BookOpen size={15} />
                      Visualizza come PDF Grafico
                    </button>
                    {currentPage < numPages && (
                      <button
                        onClick={() => onPageChange(currentPage + 1)}
                        className="w-full sm:w-auto px-4 py-2 rounded-xl border border-black/15 dark:border-white/15 hover:bg-black/5 text-xs font-semibold"
                      >
                        Vai a Pagina {currentPage + 1}
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                /* Actual Extracted Text Content inside a natural matte book sheet (Zero artificial light) */
                <div className={`w-full rounded-2xl p-6 sm:p-12 md:p-16 border ${themeStyle.sheet} transition-all`}>
                  <article className="space-y-8 animate-fadeIn">
                    {/* Page Metadata Header Banner */}
                    <div className={`flex items-center justify-between pb-4 border-b text-xs ${themeStyle.divider}`}>
                      <div className="flex items-center gap-2 font-mono">
                        <span className={`px-2.5 py-1 rounded-md font-bold ${themeStyle.tag}`}>
                          PAGINA {currentPage} DI {numPages}
                        </span>
                        <span className="opacity-50 hidden sm:inline">•</span>
                        <span className="opacity-70 hidden sm:inline font-mono">
                          {words} parole • ~{readMinutes} min di lettura
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleCopyText(true)}
                          className={`p-1.5 px-2.5 rounded-lg border text-xs flex items-center gap-1 ${themeStyle.buttonHover} opacity-75 hover:opacity-100 cursor-pointer`}
                          title="Copia testo pagina"
                        >
                          <Copy size={13} />
                          <span className="hidden sm:inline">Copia</span>
                        </button>
                        <button
                          onClick={() => handleDownloadTxt(true)}
                          className={`p-1.5 px-2.5 rounded-lg border text-xs flex items-center gap-1 ${themeStyle.buttonHover} opacity-75 hover:opacity-100 cursor-pointer`}
                          title="Scarica pagina come .txt"
                        >
                          <Download size={13} />
                          <span className="hidden sm:inline">Scarica</span>
                        </button>
                      </div>
                    </div>

                    {/* Rendered Paragraphs with Custom Typography */}
                    <div
                      className={`${getFontFamilyClass()} ${getLineHeightClass()} ${
                        textAlign === 'justify' ? 'text-justify' : 'text-left'
                      } space-y-6 transition-all font-normal text-black`}
                      style={{ fontSize: `${fontSize}px`, lineHeight: 1.85 }}
                    >
                      {currentPageData?.paragraphs && currentPageData.paragraphs.length > 0 ? (
                        currentPageData.paragraphs.map((para, idx) => (
                          <p
                            key={idx}
                            className={`transition-all text-black ${
                              activeSpeakingParagraph === idx ? 'bg-amber-200/50 px-2 py-1 rounded-lg' : ''
                            }`}
                          >
                            {renderParagraphText(para)}
                          </p>
                        ))
                      ) : (
                        <p className="italic opacity-60 text-black">Nessun testo presente.</p>
                      )}
                    </div>
                  </article>
                </div>
              )}
            </div>
          )}

          {/* VIEW SCOPE: ALL PAGES (CONTINUOUS READING) */}
          {viewScope === 'all' && (
            <div className="space-y-12 animate-fadeIn">
              {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNum) => {
                const pageData = pageCache[pageNum];
                return (
                  <div
                    key={pageNum}
                    id={`page-${pageNum}`}
                    className={`rounded-2xl p-6 sm:p-12 md:p-16 border ${themeStyle.sheet} space-y-6`}
                  >
                    <div className="flex items-center justify-between text-xs opacity-75 font-mono pb-3 border-b border-black/10 dark:border-white/10">
                      <div className="flex items-center gap-2">
                        <span className={`px-2.5 py-1 rounded-md font-bold ${themeStyle.tag}`}>
                          PAGINA {pageNum} DI {numPages}
                        </span>
                        {pageData && (
                          <span className="opacity-60">{pageData.wordCount} parole</span>
                        )}
                      </div>
                      <button
                        onClick={() => {
                          onPageChange(pageNum);
                          setViewScope('page');
                        }}
                        className="underline text-[11px] hover:opacity-100 cursor-pointer"
                      >
                        Leggi solo questa pagina
                      </button>
                    </div>

                    {!pageData ? (
                      <div className="py-6 text-center opacity-60 text-xs">
                        Caricamento testo pagina {pageNum}...
                      </div>
                    ) : !pageData.hasText ? (
                      <div className="p-4 rounded-xl border opacity-70 text-xs italic text-center text-black">
                        [Nessun testo estraibile su Pagina {pageNum} - Immagine o grafica]
                      </div>
                    ) : (
                      <div
                        className={`${getFontFamilyClass()} ${getLineHeightClass()} ${
                          textAlign === 'justify' ? 'text-justify' : 'text-left'
                        } space-y-6 font-normal text-black`}
                        style={{ fontSize: `${fontSize}px`, lineHeight: 1.85 }}
                      >
                        {pageData.paragraphs.map((para, pIdx) => (
                          <p key={pIdx} className="text-black">{renderParagraphText(para)}</p>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* 3. Bottom Navigation Footer */}
      <footer className={`sticky bottom-0 z-30 px-3 py-2 border-t flex items-center justify-between gap-2 shadow-sm transition-colors ${themeStyle.footer}`}>
        {/* Previous Page & Return to Library */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={onBackToLibrary}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-stone-300 bg-stone-100 hover:bg-stone-200 text-stone-900 text-xs font-bold transition-all shrink-0 cursor-pointer shadow-2xs"
            title="Torna alla Libreria principale"
          >
            <ArrowLeft size={14} />
            <span className="hidden xs:inline">Libreria</span>
          </button>

          <button
            onClick={() => {
              if (currentPage > 1) onPageChange(currentPage - 1);
            }}
            disabled={currentPage <= 1}
            className={`p-2 rounded-xl border border-black/15 dark:border-white/15 disabled:opacity-25 transition-all ${themeStyle.buttonHover} cursor-pointer`}
            title="Pagina precedente"
          >
            <ChevronLeft size={19} />
          </button>
        </div>

        {/* Page Slider / Jump */}
        <div className="flex items-center gap-2 flex-1 max-w-xs mx-auto">
          <input
            type="range"
            min="1"
            max={numPages}
            value={currentPage}
            onChange={(e) => onPageChange(parseInt(e.target.value, 10))}
            className="w-full accent-stone-900 h-2 rounded-lg cursor-pointer bg-black/10 dark:bg-white/10"
          />
          <span className="font-mono text-xs font-bold whitespace-nowrap min-w-[50px] text-center">
            {currentPage} / {numPages}
          </span>
        </div>

        {/* Next Page & Quick PDF Return */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => {
              if (currentPage < numPages) onPageChange(currentPage + 1);
            }}
            disabled={currentPage >= numPages}
            className={`p-2 rounded-xl border border-black/15 dark:border-white/15 disabled:opacity-25 transition-all ${themeStyle.buttonHover} cursor-pointer`}
            title="Pagina successiva"
          >
            <ChevronRight size={19} />
          </button>

          <button
            onClick={onSwitchToPdfMode}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-stone-300 bg-stone-100 hover:bg-stone-200 text-stone-900 text-xs font-bold transition-all shrink-0 cursor-pointer shadow-2xs"
            title="Torna alla vista PDF grafica originale"
          >
            <BookOpen size={14} />
            <span className="hidden sm:inline">Vedi PDF</span>
          </button>
        </div>
      </footer>
    </div>
  );
};
