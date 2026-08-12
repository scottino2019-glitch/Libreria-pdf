import React, { useEffect, useRef, useState, useCallback } from 'react';
import { pdfjsLib } from '../lib/pdfWorker';
import { PdfItem, Bookmark, ReadingSettings, SearchResult } from '../types';
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
  ZoomOut
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
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [outline, setOutline] = useState<any[]>([]);

  // Canvas ref & Touch gestures
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const touchStartX = useRef<number | null>(null);
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

  // Render Page on Canvas with razor-sharp high-DPI vector resolution
  const renderPage = useCallback(
    async (pageNumber: number) => {
      if (!doc || !canvasRef.current) return;

      try {
        if (renderTaskRef.current) {
          renderTaskRef.current.cancel();
        }

        const page = await doc.getPage(pageNumber);
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) return;

        // Container measurements
        const isMobile = window.innerWidth < 640;
        const padding = isMobile ? 12 : 32;
        const containerWidth = containerRef.current && containerRef.current.clientWidth > 100
          ? Math.max(280, containerRef.current.clientWidth - padding)
          : (isMobile ? 320 : 700);

        const unscaledViewport = page.getViewport({ scale: 1.0 });

        // Calculate target scale: 1.0 scale fits the page perfectly to container width
        const baseWidthScale = containerWidth / unscaledViewport.width;
        const targetScale = baseWidthScale * settings.fontSizeScale;

        // Logical viewport
        const viewport = page.getViewport({ scale: targetScale });

        // High DPI pixel density multiplier (2.0x or 3.0x for Retina/Smartphones)
        const dpr = Math.max(window.devicePixelRatio || 1, 2.0);

        // Physical canvas buffer pixel dimensions
        const bufferWidth = Math.floor(viewport.width * dpr);
        const bufferHeight = Math.floor(viewport.height * dpr);

        // Exact CSS display size
        const cssWidth = Math.floor(viewport.width);
        const cssHeight = Math.floor(viewport.height);

        // Double Buffering: render on an offscreen canvas first to prevent white canvas flicker
        const offscreen = document.createElement('canvas');
        offscreen.width = bufferWidth;
        offscreen.height = bufferHeight;
        const offCtx = offscreen.getContext('2d', { alpha: false });
        if (!offCtx) return;

        offCtx.imageSmoothingEnabled = true;
        offCtx.imageSmoothingQuality = 'high';

        // High DPI PDF.js render context using dpr transform matrix
        const renderContext = {
          canvasContext: offCtx,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
          viewport: viewport,
        };

        const task = page.render(renderContext);
        renderTaskRef.current = task;
        await task.promise;

        // Atomic swap to visible canvas once rendering finishes
        canvas.width = bufferWidth;
        canvas.height = bufferHeight;
        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssHeight}px`;

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(offscreen, 0, 0);
      } catch (err: any) {
        if (err.name !== 'RenderingCancelledException') {
          console.error('Error rendering page:', err);
        }
      }
    },
    [doc, settings.fontSizeScale]
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
      if (Math.abs(currentWidth - lastViewportWidthRef.current) > 10) {
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
  const touchStartDistRef = useRef<number | null>(null);

  const showZoomFeedback = (scale: number) => {
    setZoomToast(`${Math.round(scale * 100)}%`);
    setTimeout(() => setZoomToast(null), 1500);
  };

  const handleZoomIn = () => {
    const newScale = Math.min(3.5, Number((settings.fontSizeScale + 0.25).toFixed(2)));
    onUpdateSettings({ ...settings, fontSizeScale: newScale });
    showZoomFeedback(newScale);
  };

  const handleZoomOut = () => {
    const newScale = Math.max(0.75, Number((settings.fontSizeScale - 0.25).toFixed(2)));
    onUpdateSettings({ ...settings, fontSizeScale: newScale });
    showZoomFeedback(newScale);
  };

  const handleResetZoom = () => {
    onUpdateSettings({ ...settings, fontSizeScale: 1.0 });
    showZoomFeedback(1.0);
  };

  // Double Tap on Canvas to toggle zoom
  const handleCanvasDoubleTap = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      const newScale = settings.fontSizeScale >= 1.5 ? 1.0 : 1.75;
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
      touchStartX.current = null;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && touchStartDistRef.current !== null) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const diff = dist - touchStartDistRef.current;

      if (Math.abs(diff) > 40) {
        if (diff > 0) {
          handleZoomIn();
        } else {
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
      const isZoomed = container && (container.scrollWidth - container.clientWidth > 30);

      // Avoid accidental page swipe if user is horizontally scrolling a zoomed page
      if (!isZoomed && Math.abs(diffX) > 60) {
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

        {/* Right: Actions (Zoom Bar, Bookmarks, Search, Fullscreen) */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Quick Zoom Bar */}
          <div className="flex items-center bg-slate-800 rounded-xl p-0.5 border border-slate-700/80">
            <button
              onClick={handleZoomOut}
              className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-200 transition-colors"
              title="Riduci ingrandimento (-)"
            >
              <ZoomOut size={16} />
            </button>
            <button
              onClick={handleResetZoom}
              className="px-2 py-0.5 text-xs font-mono font-bold text-sky-400 hover:text-sky-300 transition-colors"
              title="Ripristina zoom 100%"
            >
              {Math.round(settings.fontSizeScale * 100)}%
            </button>
            <button
              onClick={handleZoomIn}
              className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-200 transition-colors"
              title="Aumenta ingrandimento (+)"
            >
              <ZoomIn size={16} />
            </button>
          </div>

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
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-1.5 bg-slate-900 text-sky-400 text-xs font-mono font-bold rounded-full shadow-2xl border border-slate-700 transition-all pointer-events-none">
          Zoom: {zoomToast}
        </div>
      )}

      {/* Main Reading Area - Comfortable Natural Paper Canvas Background */}
      <div
        ref={containerRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className="flex-1 relative overflow-auto p-2 sm:p-6 bg-slate-200/90"
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
          <div className="min-w-fit min-h-full mx-auto flex flex-col items-center justify-start my-auto relative p-1 sm:p-2">
            {/* Direct Navigation Touch Overlay Buttons - Small, Semi-transparent & Discreet */}
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

            {/* Canvas Page Render - Pure, High Contrast Vector Page */}
            <div
              onClick={handleCanvasDoubleTap}
              className="rounded-lg overflow-hidden transition-all duration-200 cursor-zoom-in bg-white border border-slate-300/80 shadow-2xl relative max-w-none"
              title="Doppio tocco / clic per ingrandire o ridurre"
              style={{ filter: 'none' }}
            >
              <canvas ref={canvasRef} className="block mx-auto max-w-none select-none pointer-events-none" />

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
      <footer className="sticky bottom-0 z-30 px-3 sm:px-4 py-2.5 bg-slate-900 text-slate-100 border-t border-slate-800 flex items-center justify-between gap-2 sm:gap-3 shadow-lg">
        {/* Previous Page */}
        <button
          onClick={prevPage}
          disabled={currentPage <= 1}
          className="p-2 sm:p-2.5 rounded-xl border border-slate-700 hover:bg-slate-800 disabled:opacity-30 transition-all text-slate-200"
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
          className="p-2 sm:p-2.5 rounded-xl border border-slate-700 hover:bg-slate-800 disabled:opacity-30 transition-all text-slate-200"
          title="Pagina successiva"
        >
          <ChevronRight size={20} />
        </button>

        {/* Quick Zoom Buttons */}
        <div className="flex items-center gap-1 border-l border-slate-700 pl-2">
          <button
            onClick={handleZoomOut}
            className="p-2 rounded-lg border border-slate-700 hover:bg-slate-800 text-slate-200"
            title="Riduci zoom (-)"
          >
            <ZoomOut size={16} />
          </button>
          <button
            onClick={handleResetZoom}
            className="p-2 rounded-lg border border-slate-700 hover:bg-slate-800 text-sky-400 font-mono text-xs font-bold"
            title="Ripristina zoom 100%"
          >
            100%
          </button>
          <button
            onClick={handleZoomIn}
            className="p-2 rounded-lg bg-sky-500 text-white font-bold hover:bg-sky-400 shadow-xs"
            title="Ingrandisci zoom (+)"
          >
            <ZoomIn size={16} />
          </button>
        </div>
      </footer>
    </div>
  );
};

