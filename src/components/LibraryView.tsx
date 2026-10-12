import React, { useState, useRef, useEffect } from 'react';
import { PdfItem, Bookmark, ReadingProgress } from '../types';
import { BookCover } from './BookCover';
import {
  BookOpen,
  Folder,
  Upload,
  Search,
  Trash2,
  Bookmark as BookmarkIcon,
  Clock,
  Sparkles,
  FileText,
  AlertCircle,
  RefreshCw,
  PlusCircle,
  LayoutGrid,
  List,
  Library as LibraryIcon,
  BookMarked,
  Layers,
  ArrowRight,
  Smartphone,
  CheckCircle2,
  X,
  Download
} from 'lucide-react';

interface Props {
  pdfs: PdfItem[];
  bookmarks: Bookmark[];
  progressMap: Record<string, ReadingProgress>;
  pdfDirName: string;
  onOpenPdf: (pdf: PdfItem, initialMode?: 'pdf' | 'text') => void;
  onUploadPdf: (file: File) => Promise<void>;
  onDeletePdf: (id: string, filename?: string) => Promise<void>;
  onRefresh: () => void;
  isLoading: boolean;
}

export const LibraryView: React.FC<Props> = ({
  pdfs,
  bookmarks,
  progressMap,
  pdfDirName,
  onOpenPdf,
  onUploadPdf,
  onDeletePdf,
  onRefresh,
  isLoading,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'reading' | 'bookmarked'>('all');
  const [viewMode, setViewMode] = useState<'shelves' | 'grid' | 'list'>('shelves');
  const [isUploading, setIsUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [pdfToDelete, setPdfToDelete] = useState<PdfItem | null>(null);
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [isAppInstalled, setIsAppInstalled] = useState<boolean>(false);
  const [showPwaGuide, setShowPwaGuide] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // Listen for PWA installation events
  useEffect(() => {
    if (window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone) {
      setIsAppInstalled(true);
    }

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', () => {
      setIsAppInstalled(true);
      setInstallPrompt(null);
    });

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
    };
  }, []);

  const handleInstallClick = async () => {
    if (installPrompt) {
      installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice && choice.outcome === 'accepted') {
        setIsAppInstalled(true);
      }
      setInstallPrompt(null);
    } else {
      setShowPwaGuide(true);
    }
  };

  // Helper to check if file is PDF (handles mobile browser pickers, content URIs, generic octet-streams & magic bytes)
  const isPdfFileAsync = async (file: File): Promise<boolean> => {
    if (!file) return false;
    const name = (file.name || '').toLowerCase();
    const type = (file.type || '').toLowerCase();

    // 1. Direct extension or explicit MIME match
    if (name.endsWith('.pdf') || type.includes('pdf')) {
      return true;
    }

    // 2. Ignore obvious system / non-PDF files
    if (name.startsWith('.') || name.endsWith('.txt') || name.endsWith('.jpg') || name.endsWith('.png') || name.endsWith('.zip')) {
      return false;
    }

    // 3. For ambiguous files (empty type or octet-stream), inspect magic bytes (%PDF = 0x25, 0x50, 0x44, 0x46)
    try {
      const slice = file.slice(0, 4);
      const buffer = await slice.arrayBuffer();
      const arr = new Uint8Array(buffer);
      if (arr.length >= 4 && arr[0] === 0x25 && arr[1] === 0x50 && arr[2] === 0x44 && arr[3] === 0x46) {
        return true;
      }
    } catch (e) {
      // Fallback if slice fails
    }

    // 4. Default fallback for empty type or application/octet-stream if not explicitly non-pdf
    if (type === '' || type === 'application/octet-stream' || type === 'binary/octet-stream') {
      return true;
    }

    return false;
  };

  const normalizePdfFile = (file: File): File => {
    const origName = file.name || `documento_${Date.now()}.pdf`;
    if (!origName.toLowerCase().endsWith('.pdf')) {
      return new File([file], `${origName}.pdf`, {
        type: 'application/pdf',
        lastModified: file.lastModified || Date.now(),
      });
    }
    return file;
  };

  // Upload handler for single / multiple files
  const handleFileSelect = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    setIsUploading(true);
    let uploadedCount = 0;
    let failedNames: string[] = [];

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const isPdf = await isPdfFileAsync(file);
        if (isPdf) {
          const normalizedFile = normalizePdfFile(file);
          await onUploadPdf(normalizedFile);
          uploadedCount++;
        } else {
          if (!file.name.startsWith('.')) {
            failedNames.push(file.name || 'File sconosciuto');
          }
        }
      }

      if (uploadedCount === 0 && failedNames.length > 0) {
        alert('I file selezionati non sembrano essere documenti PDF validi.');
      }
    } catch (err: any) {
      alert('Errore durante il caricamento del PDF: ' + (err.message || 'Errore sconosciuto'));
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (folderInputRef.current) folderInputRef.current.value = '';
    }
  };

  // Upload handler for entire folder selection
  const handleFolderSelect = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setIsUploading(true);
    let uploadedCount = 0;

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const isPdf = await isPdfFileAsync(file);
        if (isPdf) {
          const normalizedFile = normalizePdfFile(file);
          await onUploadPdf(normalizedFile);
          uploadedCount++;
        }
      }

      if (uploadedCount > 0) {
        alert(`Riconosciuti e caricati con successo ${uploadedCount} documenti PDF dalla cartella!`);
      } else {
        alert('Nessun documento PDF valido trovato nella cartella selezionata.');
      }
    } catch (err: any) {
      alert('Errore durante la lettura della cartella: ' + (err.message || 'Errore sconosciuto'));
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (folderInputRef.current) folderInputRef.current.value = '';
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await handleFileSelect(e.dataTransfer.files);
    }
  };

  // Filtered PDFs
  const filteredPdfs = pdfs.filter(pdf => {
    const matchesSearch = pdf.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          pdf.filename.toLowerCase().includes(searchTerm.toLowerCase());
    
    if (!matchesSearch) return false;

    if (activeTab === 'reading') {
      const prog = progressMap[pdf.id];
      return prog && prog.currentPage > 1;
    }

    if (activeTab === 'bookmarked') {
      return bookmarks.some(b => b.pdfId === pdf.id);
    }

    return true;
  });

  // Find currently reading book (most recently read)
  const currentlyReadingPdf = pdfs.slice().sort((a, b) => {
    const progA = progressMap[a.id]?.lastReadAt || '';
    const progB = progressMap[b.id]?.lastReadAt || '';
    return progB.localeCompare(progA);
  }).find(pdf => {
    const prog = progressMap[pdf.id];
    return prog && prog.currentPage > 1 && prog.currentPage < prog.totalPages;
  }) || (pdfs.length > 0 ? pdfs[0] : null);

  const currentlyReadingProg = currentlyReadingPdf ? progressMap[currentlyReadingPdf.id] : null;

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  // Chunk array into rows of N items for wood shelf rows
  const shelfRows: PdfItem[][] = [];
  const itemsPerShelf = 4; // 4 books per shelf row on desktop
  for (let i = 0; i < filteredPdfs.length; i += itemsPerShelf) {
    shelfRows.push(filteredPdfs.slice(i, i + itemsPerShelf));
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-8 py-6 space-y-8">
      {/* Library Top Header Banner - Warm Mahogany Style */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#2c1d16] via-[#21150e] to-[#1a110a] border border-[#5a4030]/60 p-6 sm:p-8 shadow-2xl">
        {/* Subtle background glow */}
        <div className="absolute top-0 right-0 -mr-16 -mt-16 w-64 h-64 rounded-full bg-amber-600/10 blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-3 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-950/80 border border-amber-700/50 text-amber-300 text-xs font-mono">
              <Folder size={14} className="text-amber-400" />
              <span>Cartella Locale: <strong className="text-amber-200">{pdfDirName || '/pdf'}</strong></span>
            </div>

            <h1 className="text-3xl sm:text-4xl font-serif font-normal text-[#FCE7D0] tracking-tight flex items-center gap-3">
              <LibraryIcon className="text-[#D4AF37] shrink-0" size={32} />
              Libreria Personale
            </h1>

            <p className="text-amber-200/70 text-xs sm:text-sm leading-relaxed">
              Archivio completo dei tuoi documenti: combina automaticamente i file della cartella del server <code className="text-amber-300 font-mono">/pdf</code> e i PDF caricati dal tuo cellulare/dispositivo, salvati in modo permanente nella memoria del browser.
            </p>

            {/* Quick Stats Pills */}
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <div className="px-3 py-1.5 rounded-lg bg-black/40 border border-amber-900/40 text-xs font-mono text-amber-200 flex items-center gap-2">
                <Layers size={13} className="text-amber-400" />
                <span>{pdfs.length} Volumi</span>
              </div>
              <div className="px-3 py-1.5 rounded-lg bg-black/40 border border-amber-900/40 text-xs font-mono text-amber-200 flex items-center gap-2">
                <BookMarked size={13} className="text-amber-400" />
                <span>{bookmarks.length} Segnalibri</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0">
            <input
              type="file"
              ref={fileInputRef}
              accept=".pdf,application/pdf,application/x-pdf,application/acrobat,applications/vnd.pdf,text/pdf,application/octet-stream"
              multiple
              onChange={e => handleFileSelect(e.target.files)}
              className="hidden"
            />
            <input
              type="file"
              ref={folderInputRef}
              // @ts-ignore
              webkitdirectory=""
              directory=""
              multiple
              onChange={e => handleFolderSelect(e.target.files)}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="px-5 py-3 rounded-xl bg-gradient-to-r from-[#D4AF37] to-[#B8860B] hover:from-[#e5bd3d] hover:to-[#c99513] text-stone-950 font-semibold text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg shadow-amber-900/30 transition-all disabled:opacity-50"
            >
              {isUploading ? (
                <>
                  <RefreshCw size={16} className="animate-spin" />
                  <span>Caricamento...</span>
                </>
              ) : (
                <>
                  <PlusCircle size={18} />
                  <span>Aggiungi PDF</span>
                </>
              )}
            </button>

            <button
              onClick={() => folderInputRef.current?.click()}
              disabled={isUploading}
              className="px-4 py-3 rounded-xl border border-amber-700/60 bg-amber-950/60 hover:bg-amber-900/80 text-amber-200 font-semibold text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-md transition-all disabled:opacity-50"
              title="Apri un'intera cartella dal tuo dispositivo"
            >
              <Folder size={18} className="text-amber-400" />
              <span>Sfoglia Cartella</span>
            </button>

            {/* PWA Install Button */}
            <button
              onClick={handleInstallClick}
              className={`px-4 py-3 rounded-xl border transition-all text-xs uppercase tracking-wider font-semibold flex items-center justify-center gap-2 shadow-md ${
                isAppInstalled
                  ? 'bg-emerald-950/60 border-emerald-700/60 text-emerald-300'
                  : 'bg-sky-950/60 hover:bg-sky-900/80 border-sky-700/60 text-sky-200'
              }`}
              title="Installa l'app sul cellulare o desktop per l'uso offline"
            >
              {isAppInstalled ? (
                <>
                  <CheckCircle2 size={18} className="text-emerald-400" />
                  <span>App Installata</span>
                </>
              ) : (
                <>
                  <Smartphone size={18} className="text-sky-400" />
                  <span>Installa App</span>
                </>
              )}
            </button>

            <button
              onClick={onRefresh}
              className="p-3 rounded-xl border border-amber-900/60 bg-black/40 hover:bg-black/60 text-amber-200 transition-colors flex items-center justify-center"
              title="Ricarica file dalla cartella /pdf"
            >
              <RefreshCw size={18} className={isLoading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
      </div>

      {/* Featured "IN LETTURA SULLO SCRITTOIO" Desk Showcase */}
      {currentlyReadingPdf && (
        <div className="rounded-2xl bg-gradient-to-br from-[#271a13] to-[#1c120c] border border-[#5a4030]/70 p-6 shadow-2xl relative overflow-hidden">
          <div className="flex items-center justify-between mb-4 border-b border-[#5a4030]/40 pb-3">
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-[#D4AF37]" />
              <h2 className="text-xs font-mono uppercase tracking-widest text-[#D4AF37] font-semibold">
                Sullo Scrittoio • Continua la Lettura
              </h2>
            </div>
            {currentlyReadingProg && (
              <span className="text-xs font-mono text-amber-300/80">
                Ultima lettura: {new Date(currentlyReadingProg.lastReadAt).toLocaleDateString('it-IT')}
              </span>
            )}
          </div>

          <div className="flex flex-col md:flex-row items-center gap-6">
            {/* Book Cover */}
            <div className="shrink-0 w-36 sm:w-44">
              <BookCover
                title={currentlyReadingPdf.title}
                progress={currentlyReadingProg ? { currentPage: currentlyReadingProg.currentPage, totalPages: currentlyReadingProg.totalPages } : undefined}
                bookmarksCount={bookmarks.filter(b => b.pdfId === currentlyReadingPdf.id).length}
                isSample={currentlyReadingPdf.isSample}
                size="shelf"
                onClick={() => onOpenPdf(currentlyReadingPdf)}
              />
            </div>

            {/* Info & Quick Jump */}
            <div className="flex-1 space-y-4 text-center md:text-left">
              <div>
                <span className="text-[11px] font-mono uppercase tracking-wider text-amber-400/80 bg-amber-950/60 px-2.5 py-1 rounded border border-amber-800/40">
                  {currentlyReadingPdf.isSample ? 'Cartella Server /pdf' : 'Caricato da Cellulare/PC'}
                </span>
                <h3 className="text-2xl sm:text-3xl font-serif text-[#FCE7D0] mt-2 leading-snug">
                  {currentlyReadingPdf.title}
                </h3>
                <p className="text-xs text-amber-200/60 font-mono mt-1">
                  Dimensione: {formatSize(currentlyReadingPdf.size)}
                </p>
              </div>

              {currentlyReadingProg && currentlyReadingProg.currentPage > 1 ? (
                <div className="max-w-md space-y-2">
                  <div className="flex justify-between text-xs font-mono text-amber-200">
                    <span>Avanzamento nel testo</span>
                    <span className="text-[#D4AF37] font-bold">
                      Pag. {currentlyReadingProg.currentPage} / {currentlyReadingProg.totalPages} ({Math.round((currentlyReadingProg.currentPage / currentlyReadingProg.totalPages) * 100)}%)
                    </span>
                  </div>
                  <div className="w-full bg-black/60 h-2.5 rounded-full overflow-hidden p-0.5 border border-amber-900/40">
                    <div
                      className="bg-gradient-to-r from-amber-600 to-[#D4AF37] h-full rounded-full transition-all duration-500"
                      style={{ width: `${Math.min(100, Math.round((currentlyReadingProg.currentPage / currentlyReadingProg.totalPages) * 100))}%` }}
                    />
                  </div>
                </div>
              ) : (
                <p className="text-xs text-amber-200/70 italic">
                  Non hai ancora iniziato la lettura di questo volume.
                </p>
              )}

              <div className="pt-2 flex flex-wrap items-center justify-center md:justify-start gap-3">
                <button
                  onClick={() => onOpenPdf(currentlyReadingPdf, 'pdf')}
                  className="px-6 py-3 rounded-xl bg-[#D4AF37] hover:bg-[#e2bd44] text-stone-950 font-bold text-xs uppercase tracking-wider flex items-center gap-2 shadow-lg transition-all"
                >
                  <BookOpen size={16} />
                  <span>
                    {currentlyReadingProg && currentlyReadingProg.currentPage > 1
                      ? `Continua da Pagina ${currentlyReadingProg.currentPage}`
                      : 'Apri Volume e Leggi'}
                  </span>
                  <ArrowRight size={16} />
                </button>

                <button
                  onClick={() => onOpenPdf(currentlyReadingPdf, 'text')}
                  className="px-4 py-3 rounded-xl bg-amber-950/80 hover:bg-amber-900 border border-amber-700/60 text-[#D4AF37] font-semibold text-xs uppercase tracking-wider flex items-center gap-1.5 transition-all"
                  title="Estrai e leggi il testo con caratteri grandi e riposanti"
                >
                  <FileText size={15} />
                  <span>Leggi Testo Estratto</span>
                </button>

                <button
                  onClick={() => setPdfToDelete(currentlyReadingPdf)}
                  className="p-3 rounded-xl bg-red-950/40 hover:bg-red-900/60 border border-red-800/50 text-red-300 hover:text-red-100 transition-all cursor-pointer"
                  title="Elimina questo volume dalla libreria"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Drag & Drop Quick Dropzone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-2xl p-5 text-center cursor-pointer transition-all ${
          dragOver
            ? 'border-[#D4AF37] bg-amber-950/40 scale-[0.99]'
            : 'border-[#5a4030]/60 hover:border-amber-600/60 bg-[#1f150e]/60 hover:bg-[#251a12]'
        }`}
      >
        <div className="w-10 h-10 rounded-full bg-amber-950/80 text-[#D4AF37] flex items-center justify-center mx-auto mb-2 border border-amber-800/40">
          <Upload size={18} />
        </div>
        <p className="text-xs sm:text-sm font-semibold text-amber-100">
          Trascina un file PDF per aggiungerlo subito allo scaffale
        </p>
        <p className="text-[11px] text-amber-200/50 mt-1 font-mono">
          Verrà salvato direttamente nella memoria sicura del tuo browser (nessun server necessario)
        </p>
      </div>

      {/* Controls: Filter Pills & View Mode Switcher */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 pt-2 border-t border-[#5a4030]/40">
        {/* Category Tabs */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setActiveTab('all')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold uppercase tracking-wider transition-all flex items-center gap-2 ${
              activeTab === 'all'
                ? 'bg-[#D4AF37] text-stone-950 shadow-md font-bold'
                : 'bg-[#271a13] text-amber-200/80 hover:bg-[#332219] border border-[#5a4030]/50'
            }`}
          >
            <span>Tutti i Volumi</span>
            <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-black/20">{pdfs.length}</span>
          </button>

          <button
            onClick={() => setActiveTab('reading')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold uppercase tracking-wider transition-all flex items-center gap-2 ${
              activeTab === 'reading'
                ? 'bg-[#D4AF37] text-stone-950 shadow-md font-bold'
                : 'bg-[#271a13] text-amber-200/80 hover:bg-[#332219] border border-[#5a4030]/50'
            }`}
          >
            <span>In Lettura</span>
          </button>

          <button
            onClick={() => setActiveTab('bookmarked')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold uppercase tracking-wider transition-all flex items-center gap-2 ${
              activeTab === 'bookmarked'
                ? 'bg-[#D4AF37] text-stone-950 shadow-md font-bold'
                : 'bg-[#271a13] text-amber-200/80 hover:bg-[#332219] border border-[#5a4030]/50'
            }`}
          >
            <span>Con Segnalibri</span>
            <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-black/20">{bookmarks.length}</span>
          </button>
        </div>

        {/* Search Bar & View Mode Toggle */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 sm:w-64">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-amber-400/60" />
            <input
              type="text"
              placeholder="Cerca un volume..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-xl text-xs bg-[#22160f] border border-[#5a4030] text-amber-100 placeholder-amber-200/40 focus:outline-none focus:border-[#D4AF37]"
            />
          </div>

          <div className="flex bg-[#22160f] p-1 rounded-xl border border-[#5a4030] text-amber-200/70">
            <button
              onClick={() => setViewMode('shelves')}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono flex items-center gap-1.5 transition-all ${
                viewMode === 'shelves' ? 'bg-[#D4AF37] text-stone-950 font-bold' : 'hover:text-amber-100'
              }`}
              title="Scaffali in Legno"
            >
              <LibraryIcon size={14} />
              <span className="hidden sm:inline">Scaffali</span>
            </button>

            <button
              onClick={() => setViewMode('grid')}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono flex items-center gap-1.5 transition-all ${
                viewMode === 'grid' ? 'bg-[#D4AF37] text-stone-950 font-bold' : 'hover:text-amber-100'
              }`}
              title="Mosaico Copertine"
            >
              <LayoutGrid size={14} />
              <span className="hidden sm:inline">Griglia</span>
            </button>

            <button
              onClick={() => setViewMode('list')}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono flex items-center gap-1.5 transition-all ${
                viewMode === 'list' ? 'bg-[#D4AF37] text-stone-950 font-bold' : 'hover:text-amber-100'
              }`}
              title="Lista Catalogo"
            >
              <List size={14} />
              <span className="hidden sm:inline">Lista</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Display Area */}
      {filteredPdfs.length === 0 ? (
        <div className="bg-[#241710] border border-[#5a4030] rounded-2xl p-12 text-center max-w-md mx-auto shadow-2xl">
          <div className="w-16 h-16 bg-amber-950/60 text-[#D4AF37] rounded-full flex items-center justify-center mx-auto mb-4 border border-amber-800/40">
            <FileText size={32} />
          </div>
          <h3 className="font-serif text-xl text-[#FCE7D0]">
            Nessun Volume Trovato
          </h3>
          <p className="text-xs text-amber-200/60 mt-1 mb-6">
            {searchTerm
              ? 'Nessun file corrisponde al criterio di ricerca inserito.'
              : 'Non ci sono ancora file nella tua cartella locale /pdf.'}
          </p>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-5 py-2.5 bg-[#D4AF37] text-stone-950 rounded-xl text-xs uppercase tracking-wider font-bold shadow-lg"
          >
            Aggiungi il Primo PDF
          </button>
        </div>
      ) : viewMode === 'shelves' ? (
        /* 3D WOOD BOOKSHELF VIEW */
        <div className="space-y-12 py-4">
          {shelfRows.map((row, rowIdx) => (
            <div key={rowIdx} className="relative">
              {/* Books sitting on the wooden shelf plank */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 px-4 sm:px-8 items-end min-h-[220px]">
                {row.map(pdf => {
                  const prog = progressMap[pdf.id];
                  const pdfBookmarks = bookmarks.filter(b => b.pdfId === pdf.id);

                  return (
                    <div key={pdf.id} className="flex flex-col items-center group relative">
                      <BookCover
                        title={pdf.title}
                        progress={prog ? { currentPage: prog.currentPage, totalPages: prog.totalPages } : undefined}
                        bookmarksCount={pdfBookmarks.length}
                        isSample={pdf.isSample}
                        size="shelf"
                        onClick={() => onOpenPdf(pdf)}
                      />

                      {/* Quick Delete Overlay */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setPdfToDelete(pdf);
                        }}
                        className="opacity-90 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity absolute -top-2 -right-2 p-1.5 rounded-full bg-red-950/90 border border-red-700 text-red-200 hover:bg-red-800 z-30 shadow-lg cursor-pointer"
                        title={`Elimina ${pdf.title}`}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Physical Wooden Shelf Structure */}
              <div className="shelf-wood h-7 w-full rounded-md mt-1 relative z-20 flex items-center justify-between px-4">
                <div className="h-1 w-full shelf-plank rounded-sm" />
              </div>
              <div className="shelf-shadow h-4 w-full" />
            </div>
          ))}
        </div>
      ) : viewMode === 'grid' ? (
        /* HARDCOVER GRID VIEW */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredPdfs.map(pdf => {
            const prog = progressMap[pdf.id];
            const pdfBookmarks = bookmarks.filter(b => b.pdfId === pdf.id);

            return (
              <div
                key={pdf.id}
                className="bg-[#241710] border border-[#5a4030] hover:border-[#D4AF37]/80 rounded-2xl p-5 shadow-xl transition-all duration-300 flex flex-col justify-between"
              >
                <div>
                  <BookCover
                    title={pdf.title}
                    progress={prog ? { currentPage: prog.currentPage, totalPages: prog.totalPages } : undefined}
                    bookmarksCount={pdfBookmarks.length}
                    isSample={pdf.isSample}
                    size="md"
                    onClick={() => onOpenPdf(pdf)}
                  />

                  <div className="mt-4 flex items-center justify-between text-xs font-mono text-amber-200/60">
                    <span>{formatSize(pdf.size)}</span>
                    <span>Aggiunto: {new Date(pdf.addedAt).toLocaleDateString('it-IT')}</span>
                  </div>
                </div>

                <div className="mt-5 pt-3 border-t border-[#5a4030]/40 flex items-center gap-2">
                  <button
                    onClick={() => onOpenPdf(pdf, 'pdf')}
                    className="flex-1 py-2.5 px-3 rounded-xl bg-[#D4AF37] hover:bg-[#e2bd44] text-stone-950 font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all shadow-md cursor-pointer"
                  >
                    <BookOpen size={15} />
                    <span>{prog && prog.currentPage > 1 ? `Pag. ${prog.currentPage}` : 'Leggi'}</span>
                  </button>

                  <button
                    onClick={() => onOpenPdf(pdf, 'text')}
                    className="py-2.5 px-3 rounded-xl bg-amber-950/70 hover:bg-amber-900 border border-amber-700/60 text-[#D4AF37] font-bold text-xs flex items-center gap-1 transition-all cursor-pointer"
                    title="Estrai e leggi il testo"
                  >
                    <FileText size={14} />
                    <span className="hidden xs:inline">Testo</span>
                  </button>

                  <button
                    onClick={() => setPdfToDelete(pdf)}
                    className="p-2.5 rounded-xl border border-[#5a4030] text-amber-200/60 hover:text-red-400 hover:border-red-900 transition-colors cursor-pointer"
                    title="Elimina volume"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* CATALOG LIST VIEW */
        <div className="bg-[#241710] border border-[#5a4030] rounded-2xl overflow-hidden divide-y divide-[#5a4030]/40 shadow-2xl">
          {filteredPdfs.map(pdf => {
            const prog = progressMap[pdf.id];
            const pdfBookmarks = bookmarks.filter(b => b.pdfId === pdf.id);

            return (
              <div
                key={pdf.id}
                className="p-4 hover:bg-[#2c1d15] transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-12 rounded bg-amber-950 border border-amber-800/60 flex items-center justify-center text-[#D4AF37] shrink-0 font-serif font-bold text-xs">
                    PDF
                  </div>
                  <div>
                    <h3 className="font-serif text-lg text-[#FCE7D0]">
                      {pdf.title}
                    </h3>
                    <div className="flex items-center gap-3 text-xs text-amber-200/60 font-mono mt-0.5">
                      <span>{formatSize(pdf.size)}</span>
                      {prog && prog.currentPage > 1 && (
                        <span className="text-[#D4AF37] font-semibold">
                          Avanzamento: Pagina {prog.currentPage}/{prog.totalPages}
                        </span>
                      )}
                      {pdfBookmarks.length > 0 && (
                        <span className="text-amber-400 font-medium flex items-center gap-1">
                          <BookmarkIcon size={12} className="fill-amber-400" />
                          {pdfBookmarks.length}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-center">
                  <button
                    onClick={() => onOpenPdf(pdf, 'pdf')}
                    className="px-3.5 py-2 rounded-xl bg-[#D4AF37] hover:bg-[#e2bd44] text-stone-950 font-bold text-xs uppercase tracking-wider flex items-center gap-1.5 shadow-md cursor-pointer"
                  >
                    <BookOpen size={15} /> Leggi
                  </button>
                  <button
                    onClick={() => onOpenPdf(pdf, 'text')}
                    className="px-3 py-2 rounded-xl bg-amber-950/70 hover:bg-amber-900 border border-amber-700/60 text-[#D4AF37] font-semibold text-xs flex items-center gap-1 cursor-pointer"
                    title="Estrai e leggi il testo"
                  >
                    <FileText size={14} /> Testo
                  </button>
                  <button
                    onClick={() => setPdfToDelete(pdf)}
                    className="p-2 rounded-xl border border-[#5a4030] text-amber-200/50 hover:text-red-400 cursor-pointer"
                    title="Elimina volume"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {pdfToDelete && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#241710] border border-[#5a4030] rounded-2xl p-6 max-w-sm w-full space-y-4 shadow-2xl animate-fadeIn text-[#FCE7D0]">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-red-950/80 text-red-400 border border-red-800/40">
                <AlertCircle size={22} />
              </div>
              <h3 className="font-serif text-lg font-normal">
                Conferma eliminazione
              </h3>
            </div>
            <p className="text-xs text-amber-200/80 leading-relaxed">
              Vuoi davvero eliminare <strong className="text-amber-100 font-bold">«{pdfToDelete.title}»</strong> ({pdfToDelete.filename}) dalla tua libreria? L'operazione è definitiva.
            </p>
            <div className="flex gap-2 justify-end pt-2">
              <button
                onClick={() => setPdfToDelete(null)}
                className="px-4 py-2 text-xs uppercase tracking-wider font-semibold text-amber-200/70 hover:bg-black/30 rounded-xl cursor-pointer"
              >
                Annulla
              </button>
              <button
                onClick={async () => {
                  const target = pdfToDelete;
                  setPdfToDelete(null);
                  await onDeletePdf(target.id, target.filename);
                }}
                className="px-4 py-2 text-xs uppercase tracking-wider font-bold bg-red-800 text-stone-100 hover:bg-red-700 rounded-xl shadow-md cursor-pointer"
              >
                Elimina Definitivamente
              </button>
            </div>
          </div>
        </div>
      )}
      {/* PWA Installation Guide Modal */}
      {showPwaGuide && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#1e140d] border border-amber-800/60 rounded-2xl p-6 max-w-md w-full space-y-5 shadow-2xl animate-fadeIn text-[#FCE7D0]">
            <div className="flex items-center justify-between border-b border-amber-900/40 pb-3">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-sky-950 text-sky-400 border border-sky-800/50">
                  <Smartphone size={22} />
                </div>
                <div>
                  <h3 className="font-serif text-lg font-normal text-white">
                    Installa Archivio PDF
                  </h3>
                  <p className="text-xs text-amber-200/60 font-mono">
                    Progressive Web App (PWA)
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowPwaGuide(false)}
                className="p-1.5 rounded-lg text-amber-200/60 hover:text-white hover:bg-white/10"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4 text-xs text-amber-100/90">
              <div className="p-3 rounded-xl bg-black/40 border border-amber-900/30 space-y-2">
                <p className="font-bold text-sky-300 flex items-center gap-2">
                  <Smartphone size={16} /> Su iPhone / iPad (Safari):
                </p>
                <ol className="list-decimal list-inside space-y-1 text-amber-200/80 pl-1">
                  <li>Tocca il pulsante <strong>Condividi</strong> (l'icona con il quadrato e la freccia in alto).</li>
                  <li>Scorri le opzioni e seleziona <strong>Aggiungi alla schermata Home</strong>.</li>
                  <li>Conferma toccando <strong>Aggiungi</strong> in alto a destra.</li>
                </ol>
              </div>

              <div className="p-3 rounded-xl bg-black/40 border border-amber-900/30 space-y-2">
                <p className="font-bold text-amber-400 flex items-center gap-2">
                  <Download size={16} /> Su Android (Chrome / Firefox / Edge):
                </p>
                <ol className="list-decimal list-inside space-y-1 text-amber-200/80 pl-1">
                  <li>Tocca i <strong>tre puntini</strong> del menu in alto a destra del browser.</li>
                  <li>Seleziona <strong>Installa app</strong> o <strong>Aggiungi a schermata Home</strong>.</li>
                </ol>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setShowPwaGuide(false)}
                className="px-5 py-2.5 bg-[#D4AF37] hover:bg-amber-400 text-stone-950 text-xs font-bold uppercase tracking-wider rounded-xl shadow-md"
              >
                Ho Capito
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
