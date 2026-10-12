import { Bookmark, ReadingProgress, ReadingSettings } from '../types';

const BOOKMARKS_KEY = 'pdf_library_bookmarks_v1';
const PROGRESS_KEY = 'pdf_library_progress_v1';
const SETTINGS_KEY = 'pdf_library_settings_v1';

export const DEFAULT_SETTINGS: ReadingSettings = {
  theme: 'light',
  fontSizeScale: 1.2, // Confortevole per smartphone e desktop
  viewMode: 'single',
  autoSavePosition: true,
  brightness: 100,
  readerMode: 'pdf',
  textFontSize: 22, // Carattere più grande e confortevole per lettura riposante
  textFontFamily: 'serif',
  textLineHeight: 'relaxed',
  textAlign: 'left',
  smartParagraphs: true,
};

// Deleted PDFs blacklist & Samples state keys
const DELETED_PDFS_KEY = 'pdf_library_deleted_v2';
const SAMPLES_DISMISSED_KEY = 'pdf_library_samples_dismissed_v2';

export function getDeletedPdfIds(): string[] {
  try {
    const raw = localStorage.getItem(DELETED_PDFS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    return [];
  }
}

export function markPdfDeleted(id: string, filename?: string): void {
  try {
    const list = getDeletedPdfIds();
    const set = new Set(list.map(s => s.toLowerCase().trim()));
    if (id) set.add(id.toLowerCase().trim());
    if (filename) set.add(filename.toLowerCase().trim());
    localStorage.setItem(DELETED_PDFS_KEY, JSON.stringify(Array.from(set)));
  } catch (err) {
    console.error('Errore nel salvataggio del PDF cancellato:', err);
  }
}

export function isPdfDeleted(id: string, filename?: string): boolean {
  try {
    const list = getDeletedPdfIds().map(s => s.toLowerCase().trim());
    const idLower = (id || '').toLowerCase().trim();
    const fnLower = (filename || '').toLowerCase().trim();
    return list.includes(idLower) || (Boolean(fnLower) && list.includes(fnLower));
  } catch (err) {
    return false;
  }
}

export function dismissSamplePdfs(): void {
  try {
    localStorage.setItem(SAMPLES_DISMISSED_KEY, 'true');
  } catch (err) {}
}

export function areSamplesDismissed(): boolean {
  try {
    return localStorage.getItem(SAMPLES_DISMISSED_KEY) === 'true';
  } catch (err) {
    return false;
  }
}

// Bookmarks management
export function getBookmarks(pdfId?: string): Bookmark[] {
  try {
    const raw = localStorage.getItem(BOOKMARKS_KEY);
    const list: Bookmark[] = raw ? JSON.parse(raw) : [];
    if (pdfId) {
      return list.filter(b => b.pdfId === pdfId);
    }
    return list;
  } catch (err) {
    console.error('Error reading bookmarks', err);
    return [];
  }
}

export function addBookmark(item: Omit<Bookmark, 'id' | 'createdAt'>): Bookmark {
  const list = getBookmarks();
  const newBookmark: Bookmark = {
    ...item,
    id: 'bm_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
    createdAt: new Date().toISOString(),
  };

  // Avoid duplicate bookmark on same page for same PDF
  const filtered = list.filter(b => !(b.pdfId === item.pdfId && b.pageNumber === item.pageNumber));
  filtered.push(newBookmark);
  localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(filtered));
  return newBookmark;
}

export function removeBookmark(id: string): void {
  const list = getBookmarks();
  const updated = list.filter(b => b.id !== id);
  localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(updated));
}

export function removeBookmarksForPdf(pdfId: string): void {
  const list = getBookmarks();
  const updated = list.filter(b => b.pdfId !== pdfId);
  localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(updated));
}

export function isPageBookmarked(pdfId: string, pageNumber: number): boolean {
  const list = getBookmarks(pdfId);
  return list.some(b => b.pageNumber === pageNumber);
}

// Reading progress per PDF
export function getReadingProgressMap(): Record<string, ReadingProgress> {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    return {};
  }
}

export function getReadingProgress(pdfId: string): ReadingProgress | null {
  const map = getReadingProgressMap();
  return map[pdfId] || null;
}

export function saveReadingProgress(progress: ReadingProgress): void {
  const map = getReadingProgressMap();
  map[progress.pdfId] = {
    ...progress,
    lastReadAt: new Date().toISOString(),
  };
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(map));
}

export function removeReadingProgress(pdfId: string): void {
  const map = getReadingProgressMap();
  if (map[pdfId]) {
    delete map[pdfId];
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(map));
  }
}

// Global user settings
export function getSettings(): ReadingSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    const parsedScale = Number(parsed.fontSizeScale);
    // Sanitize: ensure scale is at least 1.0 (never allow shrunk microtext from old sessions)
    const sanitizedScale = !isNaN(parsedScale) && parsedScale >= 1.0 ? Math.min(3.5, parsedScale) : DEFAULT_SETTINGS.fontSizeScale;
    const textFontSize = parsed.textFontSize && Number(parsed.textFontSize) >= 18 ? Number(parsed.textFontSize) : 22;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      fontSizeScale: sanitizedScale,
      textFontSize,
    };
  } catch (err) {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: ReadingSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
