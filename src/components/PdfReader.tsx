import React, { useEffect, useRef, useState, useCallback } from 'react';
import { pdfjsLib } from '../lib/pdfWorker';
import { PdfItem, Bookmark, ReadingSettings, SearchResult, ReadingTheme } from '../types';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Bookmark as BookmarkIcon,
  Search as SearchIcon,
  List as OutlineIcon,
  Maximize,
  Minimize,
  X,
  ZoomIn,
  ZoomOut,
  Sun,
  Moon,
  Sparkles,
  Type
} from 'lucide-react';

interface Props {
  pdf: PdfItem;
  settings: ReadingSettings;
  bookmarks: Bookmark[];
  initialPage?: number;
  onUpdateSettings: (settings: ReadingSettings) => void;
  onToggleBookmark: (pageNumber: number) => void;
  onSaveProgress: (pageNumber: number, totalPages: number) => void;
  onBackToLibrary: () => void;
  onOpenBookmarksModal: () => void;
}

export const PdfReader: React.FC<Props> = ({
  pdf,
  settings,
  bookmarks,
  initialPage = 1,
  onUpdateSettings,
  onToggleBookmark,
  onSaveProgress,
  onBackToLibrary,
  onOpenBookmarksModal,
}) => {
  const [doc, setDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [currentPage, setCurrentPage] = useState<number>(initialPage);
  const [numPages, setNumPages] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // UI state
  const [showSearchPanel, setShowSearchPanel] = useState<boolean>(false);
  const [showOutlinePanel, setShowOutlinePanel] = useState<boolean>(false);
  const [showZoomMenu, setShowZoomMenu] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [outline, setOutline] = useState<any[]>([]);

  // Dual Canvas References for flicker-free double buffering
  const [activeCanvasId, setActiveCanvasId] = useState<'A' | 'B'>('A');
  const canvasRefA = useRef<HTMLCanvasElement | null>(null);
  const canvasRefB = useRef<HTMLCanvasElement | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const touchStartX = useRef<number | null>(null);
  const touchStartDistRef = useRef<number | null>(null);
  const touchInitialScaleRef = useRef<number>(1.0);
  const renderTaskRef = useRef<any>(null);

  const isCurrentBookmarked = bookmarks.some(b => b.pdfId === pdf.id && b.pageNumber === currentPage);

  // Load PDF Document
  useEffect(() => {
    let active = true;
    setLoading(true);
    setErrorMsg(null);

    const loadingTask = pdfjsLib.getDocument({
      url: pdf.url,
      cMapUrl: 'https://unpkg.com/pdfjs-dist@4.0.379/cmaps/',
      cMapPacked: true,
    });

    loadingTask.promise
      .then(async (loadedDoc) => {
        if (!active) return;
        setDoc(loadedDoc);
        setNumPages(loadedDoc.numPages);
        setLoading(false);

        // Fetch outline if available
        try {
          const navOutline = await loadedDoc.getOutline();
          if (navOutline && active) {
            setOutline(navOutline);
          }
        } catch (e) {
          // ignore outline errors
        }
      })
      .catch((err) => {
        if (!active) return;
        console.error('Failed to load PDF doc', err);
        setErrorMsg('Impossibile caricare il documento PDF: ' + (err.message || 'Errore sconosciuto'));
        setLoading(false);
      });

    return () => {
      active = false;
      loadingTask.destroy();
    };
  }, [pdf.url]);

  // Render Page with Direct Native High-DPI Vector Rendering and Double-Canvas Swap
  const renderPage = useCallback(
    async (pageNumber: number) => {
      if (!doc) return;

      try {
        if (renderTaskRef.current) {
          renderTaskRef.current.cancel();
        }

        const page = await doc.getPage(pageNumber);

        // Determine target canvas (the inactive one)
        const targetId = activeCanvasId === 'A' ? 'B' : 'A';
        const targetCanvas = targetId === 'A' ? canvasRefA.current : canvasRefB.current;
        if (!targetCanvas) return;

        // Container measurements with minimal padding to avoid squishing
        const isMobile = window.innerWidth < 640;
        const padding = isMobile ? 8 : 24;
        const containerWidth = containerRef.current && containerRef.current.clientWidth > 100
          ? Math.max(280, containerRef.current.clientWidth - padding)
          : (isMobile ? window.innerWidth - padding : 700);

        const unscaledViewport = page.getViewport({ scale: 1.0 });

        // Base scale fits width of page to container
        const baseWidthScale = containerWidth / unscaledViewport.width;

        // Target scale: ensure font scale is at least 1.0 (never shrinks smaller than page width)
        const currentScale = Math.max(1.0, settings.fontSizeScale || 1.2);
        const targetScale = baseWidthScale * currentScale;

        // Logical viewport
        const viewport = page.getViewport({ scale: targetScale });

        // High DPI multiplier (capped at 2.5 for optimal performance and crisp text)
        const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 2.0), 2.5);

        // Physical canvas buffer pixel dimensions
        const bufferWidth = Math.floor(viewport.width * dpr);
        const bufferHeight = Math.floor(viewport.height * dpr);

        // Exact CSS display size
        const cssWidth = Math.floor(viewport.width);
        const cssHeight = Math.floor(viewport.height);

        // Prepare target canvas
        targetCanvas.width = bufferWidth;
        targetCanvas.height = bufferHeight;
        targetCanvas.style.width = `${cssWidth}px`;
        targetCanvas.style.height = `${cssHeight}px`;

        const ctx = targetCanvas.getContext('2d', { alpha: false });
        if (!ctx) return;

        // Render directly with PDF.js vector engine (ultra-sharp, high-contrast, subpixel antialiasing)
        const renderContext = {
          canvasContext: ctx,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
          viewport: viewport,
        };

        const task = page.render(renderContext);
        renderTaskRef.current = task;
        await task.promise;

        // Swap to newly rendered canvas instantly (zero flicker, zero white flash)
        setActiveCanvasId(targetId);
      } catch (err: any) {
        if (err.name !== 'RenderingCancelledException') {
          console.error('Error rendering page:', err);
        }
      }
    },
    [doc, activeCanvasId, settings.fontSizeScale]
  );

  // Store onSaveProgress in ref to prevent infinite re-render loops
  const onSaveProgressRef = useRef(onSaveProgress);
  useEffect(() => {
    onSaveProgressRef.current = onSaveProgress;
  }, [onSaveProgress]);

  const lastViewportWidthRef = useRef<number>(0);

  // Effect 1: Render page canvas + Window Resize Listener
  useEffect(() => {
    if (!doc) return;

    let animFrameId: number;
    let timeoutId: any;

    const executeRender = () => {
      animFrameId = requestAnimationFrame(() => {
        renderPage(currentPage);
      });
    };

    // Render immediately when doc, currentPage or zoom scale changes
    executeRender();

    const handleResize = () => {
      const currentWidth = window.innerWidth;
      if (Math.abs(currentWidth - lastViewportWidthRef.current) > 15) {
        lastViewportWidthRef.current = currentWidth;
        clearTimeout(timeoutId);
        timeoutId = setTimeout(executeRender, 120);
      }
    };

    lastViewportWidthRef.current = window.innerWidth;
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
      cancelAnimationFrame(animFrameId);
      clearTimeout(timeoutId);
    };
  }, [doc, currentPage, renderPage]);

  // Effect 2: Save reading progress
  useEffect(() => {
    if (doc && numPages > 0) {
      onSaveProgressRef.current(currentPage, numPages);
    }
  }, [doc, currentPage, numPages]);

  // Navigation handlers
  const goToPage = (p: number) => {
    const validPage = Math.max(1, Math.min(numPages, p));
    setCurrentPage(validPage);
  };

  const nextPage = () => goToPage(currentPage + 1);
  const prevPage = () => goToPage(currentPage - 1);

  // Zoom handlers
  const [zoomToast, setZoomToast] = useState<string | null>(null);
  const lastTapRef = useRef<number>(0);

  const showZoomFeedback = (scale: number) => {
    const pct = Math.round(scale * 100);
    let desc = `${pct}%`;
    if (scale >= 1.7) desc += ' • Testo Molto Grande';
    else if (scale >= 1.35) desc += ' • Testo Grande (Confortevole)';
    else if (scale === 1.0) desc += ' • Adatta Pagina';
    setZoomToast(desc);
    setTimeout(() => setZoomToast(null), 1800);
  };

  const handleZoomIn = () => {
    const current = Math.max(1.0, settings.fontSizeScale || 1.2);
    const newScale = Math.min(3.5, Number((current + 0.2).toFixed(2)));
    onUpdateSettings({ ...settings, fontSizeScale: newScale });
    showZoomFeedback(newScale);
  };

  const handleZoomOut = () => {
    // Strictly minimum 1.0 so the font NEVER shrinks into micro-text
    const current = Math.max(1.0, settings.fontSizeScale || 1.2);
    const newScale = Math.max(1.0, Number((current - 0.2).toFixed(2)));
    onUpdateSettings({ ...settings, fontSizeScale: newScale });
    showZoomFeedback(newScale);
  };

  const handleSetScale = (scale: number) => {
    const clamped = Math.max(1.0, Math.min(3.5, scale));
    onUpdateSettings({ ...settings, fontSizeScale: clamped });
    showZoomFeedback(clamped);
    setShowZoomMenu(false);
  };

  // Double Tap on Canvas to toggle reading comfort zoom
  const handleCanvasDoubleTap = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 320) {
      // Cycle: 1.0x (Adatta) -> 1.45x (Testo Grande) -> 1.85x (Molto Grande) -> 1.0x
      let newScale: number;
      if (settings.fontSizeScale < 1.3) {
        newScale = 1.45;
      } else if (settings.fontSizeScale < 1.7) {
        newScale = 1.85;
      } else {
        newScale = 1.0;
      }
      onUpdateSettings({ ...settings, fontSizeScale: newScale });
      showZoomFeedback(newScale);
    }
    lastTapRef.current = now;
  };

  // Touch gestures
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      touchStartX.current = e.touches[0].clientX;
      touchStartDistRef.current = null;
    } else if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      touchStartDistRef.current = Math.sqrt(dx * dx + dy * dy);
      touchInitialScaleRef.current = settings.fontSizeScale || 1.2;
      touchStartX.current = null;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && touchStartDistRef.current !== null) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const diff = dist - touchStartDistRef.current;

      // Deliberate pinch gesture (prevent accidental zoom-outs)
      if (Math.abs(diff) > 50) {
        if (diff > 0) {
          handleZoomIn();
        } else if (settings.fontSizeScale > 1.0) {
          handleZoomOut();
        }
        touchStartDistRef.current = dist;
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current !== null && e.changedTouches.length === 1) {
      const touchEndX = e.changedTouches[0].clientX;
      const diffX = touchStartX.current - touchEndX;

      const container = containerRef.current;
      const isZoomed = container && (container.scrollWidth - container.clientWidth > 40);

      // Avoid accidental page swipe if user is horizontally scrolling a zoomed page
      if (!isZoomed && Math.abs(diffX) > 70) {
        if (diffX > 0) {
          nextPage();
        } else {
          prevPage();
        }
      }
    }
    touchStartX.current = null;
    touchStartDistRef.current = null;
  };

  // Reading Theme Toggler
  const cycleReadingTheme = () => {
    const themes: ReadingTheme[] = ['light', 'sepia', 'dark'];
    const currentIndex = themes.indexOf(settings.theme as ReadingTheme);
    const nextIndex = (currentIndex + 1) % themes.length;
    const nextTheme = themes[nextIndex];
    onUpdateSettings({ ...settings, theme: nextTheme });
  };

  const getThemeFilterStyle = (theme: ReadingTheme): React.CSSProperties => {
    switch (theme) {
      case 'sepia':
        return {
          filter: 'sepia(0.38) brightness(0.96) contrast(1.06)',
          backgroundColor: '#f7f1e5',
        };
      case 'dark':
      case 'night':
        return {
          filter: 'invert(0.92) hue-rotate(180deg) contrast(1.15) brightness(0.95)',
          backgroundColor: '#1e293b',
        };
      case 'emerald':
        return {
          filter: 'sepia(0.25) hue-rotate(60deg) brightness(0.95) contrast(1.05)',
          backgroundColor: '#edf4ee',
        };
      case 'light':
      default:
        return {
          filter: 'none',
          backgroundColor: '#ffffff',
        };
    }
  };

  // Search inside PDF
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!doc || !searchQuery.trim()) return;

    setIsSearching(true);
    setSearchResults([]);
    const results: SearchResult[] = [];
    const queryLower = searchQuery.toLowerCase();

    try {
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const textContent = await page.getTextContent();
        const fullText = textContent.items.map((item: any) => item.str).join(' ');

        if (fullText.toLowerCase().includes(queryLower)) {
          const idx = fullText.toLowerCase().indexOf(queryLower);
          const snippetStart = Math.max(0, idx - 30);
          const snippetEnd = Math.min(fullText.length, idx + queryLower.length + 30);
          const snippet = '...' + fullText.substring(snippetStart, snippetEnd) + '...';

          results.push({
            pageNumber: i,
            textSnippet: snippet,
            matchIndex: idx,
          });
        }
      }
      setSearchResults(results);
    } catch (err) {
      console.error('Search error', err);
    } finally {
      setIsSearching(false);
    }
  };

  // Fullscreen toggle
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-100 text-slate-900 select-none">
      {/* 1. Header Toolbar Superiore */}
      <header className="sticky top-0 z-30 px-3.5 py-2.5 bg-slate-900 text-slate-100 border-b border-slate-800 flex items-center justify-between gap-2 shadow-md">
        {/* Left: Back & Title */}
        <div className="flex items-center gap-2 overflow-hidden">
          <button
            onClick={onBackToLibrary}
            className="p-2 rounded-xl hover:bg-slate-800 text-slate-200 transition-colors shrink-0"
            title="Torna alla Libreria"
          >
            <ArrowLeft size={20} />
          </button>

          <div className="truncate">
            <h2 className="font-semibold text-xs sm:text-sm truncate leading-tight text-white">
              {pdf.title}
            </h2>
            <div className="text-[11px] text-slate-400 font-medium">
              Pagina <span className="font-mono font-bold text-sky-400">{currentPage}</span> di {numPages}
            </div>
          </div>
        </div>

        {/* Right: Actions (Zoom Bar, Reading Theme, Bookmarks, Search, Fullscreen) */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Quick Font Zoom Bar */}
          <div className="relative flex items-center bg-slate-800 rounded-xl p-0.5 border border-slate-700/80">
            <button
              onClick={handleZoomOut}
              className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-200 transition-colors"
              title="Riduci font (min 100%)"
            >
              <ZoomOut size={16} />
            </button>
            <button
              onClick={() => setShowZoomMenu(!showZoomMenu)}
              className="px-2 py-0.5 text-xs font-mono font-bold text-sky-400 hover:text-sky-300 transition-colors flex items-center gap-1"
              title="Menu Zoom e Dimensione Font"
            >
              <span>{Math.round((settings.fontSizeScale || 1.2) * 100)}%</span>
            </button>
            <button
              onClick={handleZoomIn}
              className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-200 transition-colors"
              title="Ingrandisci font (+)"
            >
              <ZoomIn size={16} />
            </button>

            {/* Dropdown Menu Zoom Presets */}
            {showZoomMenu && (
              <div className="absolute right-0 top-full mt-2 w-48 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-2 z-50 text-xs space-y-1">
                <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Dimensione Caratteri
                </div>
                <button
                  onClick={() => handleSetScale(1.0)}
                  className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between ${
                    settings.fontSizeScale <= 1.05 ? 'bg-sky-500/20 text-sky-300 font-bold' : 'text-slate-200 hover:bg-slate-800'
                  }`}
                >
                  <span>100% (Adatta Schermo)</span>
                </button>
                <button
                  onClick={() => handleSetScale(1.35)}
                  className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between ${
                    settings.fontSizeScale > 1.05 && settings.fontSizeScale <= 1.45 ? 'bg-sky-500/20 text-sky-300 font-bold' : 'text-slate-200 hover:bg-slate-800'
                  }`}
                >
                  <span>135% (Testo Confortevole)</span>
                  <span className="text-[10px] text-amber-300">★ Consigliato</span>
                </button>
                <button
                  onClick={() => handleSetScale(1.75)}
                  className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between ${
                    settings.fontSizeScale > 1.45 && settings.fontSizeScale <= 1.9 ? 'bg-sky-500/20 text-sky-300 font-bold' : 'text-slate-200 hover:bg-slate-800'
                  }`}
                >
                  <span>175% (Testo Molto Grande)</span>
                </button>
                <button
                  onClick={() => handleSetScale(2.2)}
                  className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between ${
                    settings.fontSizeScale > 1.9 ? 'bg-sky-500/20 text-sky-300 font-bold' : 'text-slate-200 hover:bg-slate-800'
                  }`}
                >
                  <span>220% (Zoom Massimo)</span>
                </button>
              </div>
            )}
          </div>

          {/* Reading Theme Switcher (Chiaro / Sepia / Notte) */}
          <button
            onClick={cycleReadingTheme}
            className={`p-2 rounded-xl transition-all border ${
              settings.theme === 'sepia'
                ? 'bg-amber-950/80 border-amber-700/60 text-amber-300'
                : settings.theme === 'dark' || settings.theme === 'night'
                ? 'bg-slate-950 border-slate-700 text-sky-300'
                : 'hover:bg-slate-800 border-transparent text-slate-200'
            }`}
            title={`Tema di lettura: ${settings.theme === 'sepia' ? 'Sepia (Riposante)' : settings.theme === 'dark' ? 'Notte (Scuro)' : 'Chiaro (Originale)'}. Clicca per cambiare`}
          >
            {settings.theme === 'sepia' ? (
              <Sparkles size={18} />
            ) : settings.theme === 'dark' || settings.theme === 'night' ? (
              <Moon size={18} />
            ) : (
              <Sun size={18} />
            )}
          </button>

          {/* Bookmark Button */}
          <button
            onClick={() => onToggleBookmark(currentPage)}
            className={`p-2 rounded-xl transition-all ${
              isCurrentBookmarked
                ? 'bg-amber-500 text-slate-950 shadow-sm'
                : 'hover:bg-slate-800 text-slate-200'
            }`}
            title={isCurrentBookmarked ? 'Rimuovi segnalibro' : 'Aggiungi segnalibro a questa pagina'}
          >
            <BookmarkIcon size={18} className={isCurrentBookmarked ? 'fill-slate-950' : ''} />
          </button>

          {/* Bookmarks List Modal Trigger */}
          <button
            onClick={onOpenBookmarksModal}
            className="p-2 rounded-xl hover:bg-slate-800 text-slate-200 transition-colors relative"
            title="Visualizza tutti i segnalibri"
          >
            <BookmarkIcon size={18} />
            {bookmarks.filter(b => b.pdfId === pdf.id).length > 0 && (
              <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-amber-400" />
            )}
          </button>

          {/* Search Trigger */}
          <button
            onClick={() => {
              setShowSearchPanel(!showSearchPanel);
              setShowOutlinePanel(false);
            }}
            className={`p-2 rounded-xl transition-colors ${
              showSearchPanel ? 'bg-sky-500 text-white' : 'hover:bg-slate-800 text-slate-200'
            }`}
            title="Cerca nel testo"
          >
            <SearchIcon size={18} />
          </button>

          {/* Indice / Outline */}
          {outline.length > 0 && (
            <button
              onClick={() => {
                setShowOutlinePanel(!showOutlinePanel);
                setShowSearchPanel(false);
              }}
              className={`p-2 rounded-xl transition-colors ${
                showOutlinePanel ? 'bg-sky-500 text-white' : 'hover:bg-slate-800 text-slate-200'
              }`}
              title="Indice dei contenuti"
            >
              <OutlineIcon size={18} />
            </button>
          )}

          {/* Fullscreen */}
          <button
            onClick={toggleFullscreen}
            className="p-2 rounded-xl hover:bg-slate-800 text-slate-200 transition-colors hidden sm:flex"
            title="Schermo Intero"
          >
            {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
          </button>
        </div>
      </header>

      {/* Floating Zoom Toast Notification */}
      {zoomToast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-1.5 bg-slate-900/95 text-sky-300 text-xs font-mono font-bold rounded-full shadow-2xl border border-sky-500/40 backdrop-blur-md transition-all pointer-events-none">
          {zoomToast}
        </div>
      )}

      {/* Main Reading Area */}
      <div
        ref={containerRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className="flex-1 relative overflow-auto p-1.5 sm:p-6 bg-slate-200/90"
      >
        {loading ? (
          <div className="min-h-full flex flex-col items-center justify-center p-12 space-y-3 text-center">
            <div className="w-10 h-10 border-3 border-sky-600 border-t-transparent rounded-full animate-spin" />
            <p className="text-xs font-medium text-slate-700">Caricamento documento in corso...</p>
          </div>
        ) : errorMsg ? (
          <div className="min-h-full flex flex-col items-center justify-center p-6">
            <div className="p-6 max-w-md rounded-2xl border text-center space-y-3 bg-red-50 border-red-200 text-red-800 shadow-md">
              <p className="font-semibold text-sm">{errorMsg}</p>
              <button
                onClick={onBackToLibrary}
                className="px-4 py-2 bg-red-700 text-white text-xs font-semibold rounded-xl"
              >
                Ritorna alla Libreria
              </button>
            </div>
          </div>
        ) : (
          <div className="min-w-fit min-h-full mx-auto flex flex-col items-center justify-start my-auto relative p-0.5 sm:p-2">
            {/* Direct Navigation Touch Overlay Buttons - Discreet & Semi-transparent */}
            <button
              onClick={prevPage}
              disabled={currentPage <= 1}
              className="fixed left-1.5 sm:left-4 top-1/2 -translate-y-1/2 z-20 w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-slate-900/30 hover:bg-slate-900/80 text-white/60 hover:text-white shadow-md disabled:opacity-0 transition-all cursor-pointer border border-slate-700/40 backdrop-blur-xs flex items-center justify-center opacity-40 hover:opacity-100"
              title="Pagina precedente"
            >
              <ChevronLeft size={16} />
            </button>

            <button
              onClick={nextPage}
              disabled={currentPage >= numPages}
              className="fixed right-1.5 sm:right-4 top-1/2 -translate-y-1/2 z-20 w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-slate-900/30 hover:bg-slate-900/80 text-white/60 hover:text-white shadow-md disabled:opacity-0 transition-all cursor-pointer border border-slate-700/40 backdrop-blur-xs flex items-center justify-center opacity-40 hover:opacity-100"
              title="Pagina successiva"
            >
              <ChevronRight size={16} />
            </button>

            {/* Canvas Page Render - Double Buffering Dual Canvas (Razor Sharp Vector Rendering) */}
            <div
              onClick={handleCanvasDoubleTap}
              className="rounded-lg overflow-hidden cursor-zoom-in border border-slate-300/80 shadow-2xl relative max-w-none transition-filter duration-300"
              title="Doppio tocco / clic per ingrandire o ridurre il testo"
              style={getThemeFilterStyle(settings.theme)}
            >
              {/* Canvas A */}
              <canvas
                ref={canvasRefA}
                className={`mx-auto max-w-none select-none pointer-events-none ${activeCanvasId === 'A' ? 'block' : 'hidden'}`}
              />

              {/* Canvas B */}
              <canvas
                ref={canvasRefB}
                className={`mx-auto max-w-none select-none pointer-events-none ${activeCanvasId === 'B' ? 'block' : 'hidden'}`}
              />

              {/* Bookmark Ribbon on Canvas Page */}
              {isCurrentBookmarked && (
                <div className="absolute top-0 right-4 w-7 h-10 bg-amber-500 text-slate-950 flex items-center justify-center shadow-md rounded-b-md z-10 pointer-events-none">
                  <BookmarkIcon size={16} className="fill-slate-950" />
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Search Panel */}
      {showSearchPanel && (
        <div className="fixed bottom-20 left-4 right-4 sm:left-auto sm:right-6 sm:w-96 z-40 p-4 rounded-2xl bg-slate-900 text-slate-100 border border-slate-800 shadow-2xl animate-slideUp max-h-[70vh] flex flex-col">
          <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-800">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <SearchIcon size={16} className="text-sky-400" /> Cerca nel Documento
            </h3>
            <button
              onClick={() => setShowSearchPanel(false)}
              className="p-1 rounded-md hover:bg-slate-800 text-slate-300"
            >
              <X size={16} />
            </button>
          </div>

          <form onSubmit={handleSearch} className="flex gap-2 mb-3">
            <input
              type="text"
              placeholder="Inserisci parola da cercare..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 px-3 py-1.5 rounded-xl text-xs bg-slate-800 border border-slate-700 text-white placeholder-slate-400 focus:outline-none focus:border-sky-400"
              autoFocus
            />
            <button
              type="submit"
              disabled={isSearching}
              className="px-3 py-1.5 bg-sky-500 hover:bg-sky-400 text-white rounded-xl text-xs uppercase tracking-wider font-bold"
            >
              {isSearching ? '...' : 'Cerca'}
            </button>
          </form>

          <div className="flex-1 overflow-y-auto space-y-2 pr-1 text-xs">
            {searchResults.length > 0 ? (
              searchResults.map((res, i) => (
                <button
                  key={i}
                  onClick={() => {
                    goToPage(res.pageNumber);
                    setShowSearchPanel(false);
                  }}
                  className="w-full text-left p-2.5 rounded-xl bg-slate-800 border border-slate-700 hover:border-sky-400 transition-colors"
                >
                  <div className="font-bold text-sky-400 mb-1">
                    Pagina {res.pageNumber}
                  </div>
                  <div className="text-slate-200 italic leading-tight">{res.textSnippet}</div>
                </button>
              ))
            ) : searchQuery && !isSearching ? (
              <p className="text-center text-slate-400 py-4">Nessun risultato trovato per "{searchQuery}".</p>
            ) : null}
          </div>
        </div>
      )}

      {/* 4. Bottom Navigation Toolbar */}
      <footer className="sticky bottom-0 z-30 px-3 sm:px-4 py-2 bg-slate-900 text-slate-100 border-t border-slate-800 flex items-center justify-between gap-2 sm:gap-3 shadow-lg">
        {/* Previous Page */}
        <button
          onClick={prevPage}
          disabled={currentPage <= 1}
          className="p-2 rounded-xl border border-slate-700 hover:bg-slate-800 disabled:opacity-30 transition-all text-slate-200"
          title="Pagina precedente"
        >
          <ChevronLeft size={20} />
        </button>

        {/* Page Slider / Jump */}
        <div className="flex items-center gap-2 flex-1 max-w-xs mx-auto">
          <input
            type="range"
            min="1"
            max={numPages}
            value={currentPage}
            onChange={(e) => goToPage(parseInt(e.target.value, 10))}
            className="w-full accent-sky-500 h-2 rounded-lg cursor-pointer bg-slate-800"
          />
          <span className="font-mono text-xs font-bold text-sky-400 whitespace-nowrap min-w-[48px] text-center">
            {currentPage} / {numPages}
          </span>
        </div>

        {/* Next Page */}
        <button
          onClick={nextPage}
          disabled={currentPage >= numPages}
          className="p-2 rounded-xl border border-slate-700 hover:bg-slate-800 disabled:opacity-30 transition-all text-slate-200"
          title="Pagina successiva"
        >
          <ChevronRight size={20} />
        </button>

        {/* Quick Zoom Buttons with Clear Text Size Control */}
        <div className="flex items-center gap-1 border-l border-slate-700 pl-2">
          <button
            onClick={handleZoomOut}
            className="p-1.5 sm:p-2 rounded-lg border border-slate-700 hover:bg-slate-800 text-slate-200"
            title="Riduci caratteri (-)"
          >
            <ZoomOut size={16} />
          </button>
          <button
            onClick={() => handleSetScale(settings.fontSizeScale >= 1.35 ? 1.0 : 1.45)}
            className="px-2 py-1 rounded-lg border border-slate-700 hover:bg-slate-800 text-sky-400 font-mono text-xs font-bold flex items-center gap-1"
            title="Tocca per alternare tra Adatta e Testo Grande"
          >
            <Type size={13} className="text-sky-400" />
            <span>{Math.round((settings.fontSizeScale || 1.2) * 100)}%</span>
          </button>
          <button
            onClick={handleZoomIn}
            className="p-1.5 sm:p-2 rounded-lg bg-sky-500 text-white font-bold hover:bg-sky-400 shadow-xs"
            title="Ingrandisci caratteri (+)"
          >
            <ZoomIn size={16} />
          </button>
        </div>
      </footer>
    </div>
  );
};


