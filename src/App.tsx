import React, { useEffect, useState, useCallback } from 'react';
import { PdfItem, Bookmark, ReadingProgress, ReadingSettings } from './types';
import {
  getBookmarks,
  addBookmark,
  removeBookmark,
  removeBookmarksForPdf,
  getReadingProgressMap,
  saveReadingProgress,
  removeReadingProgress,
  getSettings,
  saveSettings,
  markPdfDeleted,
  isPdfDeleted,
  dismissSamplePdfs,
  areSamplesDismissed,
  DEFAULT_SETTINGS
} from './lib/storage';
import { generateSamplePdfsClient } from './lib/samplePdfs';
import { saveUploadedPdf, loadStoredPdfs, deleteStoredPdf } from './lib/pdfStore';
import { LibraryView } from './components/LibraryView';
import { PdfReader } from './components/PdfReader';
import { BookmarksModal } from './components/BookmarksModal';
import { BookOpen, Folder, Bookmark as BookmarkIcon, Settings, RefreshCw, Smartphone } from 'lucide-react';

export default function App() {
  const [pdfs, setPdfs] = useState<PdfItem[]>([]);
  const [pdfDir, setPdfDir] = useState<string>('/pdf');
  const [isLoadingPdfs, setIsLoadingPdfs] = useState<boolean>(true);
  const [activePdf, setActivePdf] = useState<PdfItem | null>(null);

  // Persistence State
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [progressMap, setProgressMap] = useState<Record<string, ReadingProgress>>({});
  const [settings, setSettings] = useState<ReadingSettings>(DEFAULT_SETTINGS);

  // Modals & Active Tab
  const [showBookmarksModal, setShowBookmarksModal] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'library' | 'bookmarks' | 'settings'>('library');
  const [targetReaderMode, setTargetReaderMode] = useState<'pdf' | 'text'>('pdf');

  // Load state from static /pdf folder + samples + IndexedDB user uploads
  const loadLibraryData = useCallback(async () => {
    setIsLoadingPdfs(true);
    let serverFolderPdfs: PdfItem[] = [];

    // 1. Fetch PDFs from server /pdf directory
    try {
      const res = await fetch(`/pdf/index.json?t=${Date.now()}`);
      if (res.ok) {
        const folderPdfs: PdfItem[] = await res.json();
        if (Array.isArray(folderPdfs) && folderPdfs.length > 0) {
          // Exclude any file that the user deleted
          serverFolderPdfs = folderPdfs.filter(p => !isPdfDeleted(p.id, p.filename));
        }
      }
    } catch (err) {
      console.log('Nessun file statico /pdf/index.json disponibile:', err);
    }

    // 2. Load Stored PDFs from IndexedDB (User Uploads)
    let storedPdfs: PdfItem[] = [];
    try {
      const allStored = await loadStoredPdfs();
      storedPdfs = allStored.filter(p => !isPdfDeleted(p.id, p.filename));
    } catch (err) {
      console.error('Errore durante il caricamento dei PDF memorizzati:', err);
    }

    // 3. Client Sample PDFs: ONLY load if the user has NO real books AND has not dismissed/deleted samples!
    let samplePdfs: PdfItem[] = [];
    const hasRealBooks = serverFolderPdfs.length > 0 || storedPdfs.length > 0;
    if (!hasRealBooks && !areSamplesDismissed()) {
      try {
        const generated = await generateSamplePdfsClient();
        samplePdfs = generated.filter(p => !isPdfDeleted(p.id, p.filename));
      } catch (err) {
        console.error('Errore durante il caricamento dei campioni:', err);
      }
    }

    // Combine all sources and deduplicate by filename / id
    const combined = [...storedPdfs, ...serverFolderPdfs, ...samplePdfs];
    const uniquePdfs: PdfItem[] = [];
    const seen = new Set<string>();

    for (const item of combined) {
      if (isPdfDeleted(item.id, item.filename)) continue;
      const key = (item.id || item.filename).toLowerCase().trim();
      if (!seen.has(key)) {
        seen.add(key);
        uniquePdfs.push(item);
      }
    }

    setPdfs(uniquePdfs);
    setPdfDir('/pdf');
    setIsLoadingPdfs(false);
  }, []);

  useEffect(() => {
    loadLibraryData();
    setBookmarks(getBookmarks());
    setProgressMap(getReadingProgressMap());
    setSettings(getSettings());
  }, [loadLibraryData]);

  // Settings update
  const handleUpdateSettings = useCallback((newSettings: ReadingSettings) => {
    setSettings(newSettings);
    saveSettings(newSettings);
  }, []);

  // Upload or select local PDF file handler with IndexedDB persistence
  const handleUploadPdf = async (file: File) => {
    try {
      const newPdfItem = await saveUploadedPdf(file);
      setPdfs(prev => [newPdfItem, ...prev]);
    } catch (err: any) {
      console.error('Errore salvataggio PDF in memoria:', err);
      // Fallback
      const objectUrl = URL.createObjectURL(file);
      const cleanTitle = file.name.replace(/\.pdf$/i, '').replace(/_/g, ' ');
      const fallbackItem: PdfItem = {
        id: 'file_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        filename: file.name,
        title: cleanTitle,
        size: file.size,
        addedAt: new Date().toISOString(),
        url: objectUrl,
        isSample: false,
      };
      setPdfs(prev => [fallbackItem, ...prev]);
    }
  };

  // Delete PDF handler with persistent storage & cache cleanup
  const handleDeletePdf = async (id: string, filename?: string) => {
    const target = pdfs.find(p => p.id === id || (filename && p.filename === filename));
    const targetId = target?.id || id;
    const targetFilename = target?.filename || filename || '';

    // 1. Mark in permanent blacklist so it NEVER reappears upon refresh or reload
    markPdfDeleted(targetId, targetFilename);

    // 2. If it is a sample book, dismiss all samples so generator never runs again
    if (target?.isSample) {
      dismissSamplePdfs();
    }

    // 3. Delete from IndexedDB storage
    await deleteStoredPdf(targetId);
    if (targetFilename) {
      await deleteStoredPdf(targetFilename);
    }

    // 4. Clean up reading progress & bookmarks
    removeReadingProgress(targetId);
    removeBookmarksForPdf(targetId);
    setProgressMap(getReadingProgressMap());
    setBookmarks(getBookmarks());

    // 5. Update React state immediately
    setPdfs(prev => prev.filter(p => p.id !== targetId && (!targetFilename || p.filename !== targetFilename)));

    if (activePdf?.id === targetId || (targetFilename && activePdf?.filename === targetFilename)) {
      setActivePdf(null);
    }
  };

  // Bookmark handlers
  const handleToggleBookmark = useCallback((pdfId: string, pageNumber: number, note?: string) => {
    setBookmarks(prevBookmarks => {
      const existing = prevBookmarks.find(b => b.pdfId === pdfId && b.pageNumber === pageNumber);
      if (existing) {
        removeBookmark(existing.id);
      } else {
        const targetPdf = pdfs.find(p => p.id === pdfId);
        addBookmark({
          pdfId,
          pageNumber,
          title: targetPdf ? `${targetPdf.title} - Pag. ${pageNumber}` : `Pagina ${pageNumber}`,
          note,
        });
      }
      return getBookmarks();
    });
  }, [pdfs]);

  const handleRemoveBookmark = useCallback((id: string) => {
    removeBookmark(id);
    setBookmarks(getBookmarks());
  }, []);

  // Progress handler with check to prevent infinite update depth loops
  const handleSaveProgress = useCallback((pdfId: string, currentPage: number, totalPages: number) => {
    setProgressMap(prevMap => {
      const currentProg = prevMap[pdfId];
      if (
        currentProg &&
        currentProg.currentPage === currentPage &&
        currentProg.totalPages === totalPages &&
        currentProg.zoom === settings.fontSizeScale &&
        currentProg.theme === settings.theme
      ) {
        return prevMap;
      }
      const newProg: ReadingProgress = {
        pdfId,
        currentPage,
        totalPages,
        zoom: currentProg?.zoom || settings.fontSizeScale,
        theme: settings.theme,
        lastReadAt: new Date().toISOString(),
      };
      saveReadingProgress(newProg);
      return {
        ...prevMap,
        [pdfId]: newProg,
      };
    });
  }, [settings.fontSizeScale, settings.theme]);

  // Jump to specific bookmarked PDF page
  const handleSelectBookmark = useCallback((pdfId: string, pageNumber: number) => {
    const targetPdf = pdfs.find(p => p.id === pdfId);
    if (targetPdf) {
      setActivePdf(targetPdf);
    }
  }, [pdfs]);

  const activePdfId = activePdf?.id;

  const handleToggleBookmarkForActive = useCallback((page: number, note?: string) => {
    if (activePdfId) {
      handleToggleBookmark(activePdfId, page, note);
    }
  }, [activePdfId, handleToggleBookmark]);

  const handleSaveProgressForActive = useCallback((currentPage: number, totalPages: number) => {
    if (activePdfId) {
      handleSaveProgress(activePdfId, currentPage, totalPages);
    }
  }, [activePdfId, handleSaveProgress]);

  const handleBackToLibrary = useCallback(() => {
    setActivePdf(null);
  }, []);

  const handleOpenBookmarksModal = useCallback(() => {
    setShowBookmarksModal(true);
  }, []);

  const handleCloseBookmarksModal = useCallback(() => {
    setShowBookmarksModal(false);
  }, []);

  const handleOpenPdf = useCallback((pdf: PdfItem, initialMode?: 'pdf' | 'text') => {
    setActivePdf(pdf);
    if (initialMode) {
      setTargetReaderMode(initialMode);
    }
  }, []);

  // If viewing a PDF reader
  if (activePdf) {
    const prog = progressMap[activePdf.id];
    const startPage = prog?.currentPage || 1;

    return (
      <>
        <PdfReader
          pdf={activePdf}
          settings={settings}
          bookmarks={bookmarks}
          initialPage={startPage}
          initialDisplayMode={targetReaderMode}
          onUpdateSettings={handleUpdateSettings}
          onToggleBookmark={handleToggleBookmarkForActive}
          onSaveProgress={handleSaveProgressForActive}
          onBackToLibrary={handleBackToLibrary}
          onOpenBookmarksModal={handleOpenBookmarksModal}
        />

        {showBookmarksModal && (
          <BookmarksModal
            bookmarks={bookmarks}
            currentPdf={activePdf}
            currentPageNumber={prog?.currentPage || 1}
            onSelectBookmark={handleSelectBookmark}
            onRemoveBookmark={handleRemoveBookmark}
            onAddCurrentBookmark={(note) =>
              handleToggleBookmark(activePdf.id, prog?.currentPage || 1, note)
            }
            onClose={handleCloseBookmarksModal}
          />
        )}
      </>
    );
  }

  return (
    <div className="min-h-screen bg-[#1a1412] text-[#FCE7D0] flex flex-col font-sans pb-20 sm:pb-8">
      {/* App Navigation Bar - Mahogany Library Header */}
      <header className="bg-[#241710]/90 backdrop-blur-md border-b border-[#5a4030]/60 sticky top-0 z-30 shadow-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#D4AF37] to-[#B8860B] text-stone-950 flex items-center justify-center font-bold shadow-md">
              <BookOpen size={20} />
            </div>
            <div>
              <div className="text-[10px] tracking-[0.25em] uppercase font-bold text-[#D4AF37] leading-none mb-1">
                Archivio Locale
              </div>
              <h1 className="font-serif text-xl sm:text-2xl leading-tight text-[#FCE7D0] font-normal">
                Libreria Classica
              </h1>
            </div>
          </div>

          <div className="hidden sm:flex items-center gap-3">
            <button
              onClick={() => setActiveTab('library')}
              className={`px-4 py-2 text-xs uppercase tracking-wider font-bold transition-all flex items-center gap-2 rounded-xl ${
                activeTab === 'library'
                  ? 'bg-[#D4AF37] text-stone-950 shadow-md'
                  : 'text-amber-200/70 hover:text-amber-100 hover:bg-[#332219]'
              }`}
            >
              <BookOpen size={15} /> Libreria
            </button>
            <button
              onClick={() => setShowBookmarksModal(true)}
              className="px-4 py-2 text-xs uppercase tracking-wider font-bold text-amber-200/70 hover:text-amber-100 hover:bg-[#332219] rounded-xl transition-all flex items-center gap-2 relative border border-[#5a4030]/40"
            >
              <BookmarkIcon size={15} className="text-[#D4AF37]" /> Segnalibri
              {bookmarks.length > 0 && (
                <span className="px-2 py-0.5 text-[10px] bg-[#D4AF37] text-stone-950 font-mono rounded-full font-extrabold">
                  {bookmarks.length}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1">
        <LibraryView
          pdfs={pdfs}
          bookmarks={bookmarks}
          progressMap={progressMap}
          pdfDirName={pdfDir}
          onOpenPdf={handleOpenPdf}
          onUploadPdf={handleUploadPdf}
          onDeletePdf={handleDeletePdf}
          onRefresh={loadLibraryData}
          isLoading={isLoadingPdfs}
        />
      </main>

      {/* Bookmarks Modal */}
      {showBookmarksModal && (
        <BookmarksModal
          bookmarks={bookmarks}
          onSelectBookmark={handleSelectBookmark}
          onRemoveBookmark={handleRemoveBookmark}
          onClose={() => setShowBookmarksModal(false)}
        />
      )}

      {/* Mobile Bottom Navigation Bar */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#241710]/95 backdrop-blur-md border-t border-[#5a4030]/80 py-2.5 px-6 flex justify-around items-center">
        <button
          onClick={() => setActiveTab('library')}
          className={`flex flex-col items-center gap-1 text-[10px] tracking-wider uppercase font-bold transition-colors ${
            activeTab === 'library' ? 'text-[#D4AF37]' : 'text-amber-200/50'
          }`}
        >
          <BookOpen size={18} />
          <span>Libreria</span>
        </button>

        <button
          onClick={() => setShowBookmarksModal(true)}
          className="flex flex-col items-center gap-1 text-[10px] tracking-wider uppercase font-bold text-amber-200/50 hover:text-[#D4AF37] transition-colors relative"
        >
          <BookmarkIcon size={18} />
          <span>Segnalibri</span>
          {bookmarks.length > 0 && (
            <span className="absolute top-0 right-2 w-2 h-2 rounded-full bg-[#D4AF37]" />
          )}
        </button>
      </nav>
    </div>
  );
}
