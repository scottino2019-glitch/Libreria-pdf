export interface PdfItem {
  id: string;
  filename: string;
  title: string;
  author?: string;
  size: number;
  addedAt: string;
  url: string;
  pageCount?: number;
  isSample?: boolean;
}

export interface Bookmark {
  id: string;
  pdfId: string;
  pageNumber: number;
  title: string;
  note?: string;
  createdAt: string;
}

export type ReadingTheme = 'light' | 'sepia' | 'dark' | 'night' | 'emerald';

export type ReaderDisplayMode = 'pdf' | 'text';
export type TextFontFamily = 'serif' | 'sans' | 'mono';
export type TextLineHeight = 'compact' | 'normal' | 'relaxed';
export type TextAlign = 'left' | 'justify';

export interface ReadingProgress {
  pdfId: string;
  currentPage: number;
  totalPages: number;
  zoom: number;
  theme: ReadingTheme;
  lastReadAt: string;
  readerMode?: ReaderDisplayMode;
}

export interface ReadingSettings {
  theme: ReadingTheme;
  fontSizeScale: number; // 0.8 to 3.5 for PDF canvas
  viewMode: 'single' | 'scroll';
  autoSavePosition: boolean;
  brightness: number; // 50 to 100
  // Extracted text reading configuration
  readerMode?: ReaderDisplayMode;
  textFontSize?: number; // In px: 14 to 32 (default 18)
  textFontFamily?: TextFontFamily; // 'serif' | 'sans' | 'mono'
  textLineHeight?: TextLineHeight; // 'compact' | 'normal' | 'relaxed'
  textAlign?: TextAlign; // 'left' | 'justify'
  smartParagraphs?: boolean;
}

export interface ExtractedPageText {
  pageNumber: number;
  text: string;
  paragraphs: string[];
  wordCount: number;
  characterCount: number;
  hasText: boolean;
}

export interface PdfOutlineItem {
  title: string;
  pageNumber: number;
  children?: PdfOutlineItem[];
}

export interface SearchResult {
  pageNumber: number;
  textSnippet: string;
  matchIndex: number;
}
