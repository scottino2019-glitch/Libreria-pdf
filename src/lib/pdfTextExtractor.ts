import { pdfjsLib } from './pdfWorker';
import { ExtractedPageText } from '../types';

interface TextItemPosition {
  str: string;
  tx: number;
  ty: number;
  width: number;
  height: number;
  hasEOL?: boolean;
}

/**
 * Extracts and intelligently formats text from a single PDF page
 */
export async function extractTextFromPage(
  doc: pdfjsLib.PDFDocumentProxy,
  pageNumber: number,
  smartFormatting: boolean = true
): Promise<ExtractedPageText> {
  try {
    const page = await doc.getPage(pageNumber);
    const textContent = await page.getTextContent();

    if (!textContent || !textContent.items || textContent.items.length === 0) {
      return {
        pageNumber,
        text: '',
        paragraphs: [],
        wordCount: 0,
        characterCount: 0,
        hasText: false,
      };
    }

    const items: TextItemPosition[] = [];

    for (const rawItem of textContent.items as any[]) {
      if (!rawItem.str || rawItem.str.trim() === '' && !rawItem.hasEOL) {
        continue;
      }
      const transform = rawItem.transform || [1, 0, 0, 1, 0, 0];
      const tx = transform[4] ?? 0;
      const ty = transform[5] ?? 0;
      const width = rawItem.width ?? 0;
      const height = rawItem.height ?? Math.abs(transform[3] ?? 12);

      items.push({
        str: rawItem.str,
        tx,
        ty,
        width,
        height,
        hasEOL: rawItem.hasEOL,
      });
    }

    if (items.length === 0) {
      return {
        pageNumber,
        text: '',
        paragraphs: [],
        wordCount: 0,
        characterCount: 0,
        hasText: false,
      };
    }

    // Sort items vertically (top to bottom: in PDF coords, higher ty is higher on the page)
    // Then horizontally (left to right: lower tx to higher tx)
    items.sort((a, b) => {
      const yDiff = b.ty - a.ty;
      // If items are on approximately the same line (within 4 points)
      if (Math.abs(yDiff) <= 4) {
        return a.tx - b.tx;
      }
      return yDiff;
    });

    // Group into visual lines
    interface LineGroup {
      y: number;
      items: TextItemPosition[];
      text: string;
      isHeaderOrBullet?: boolean;
      estimatedHeight: number;
    }

    const lines: LineGroup[] = [];
    let currentLine: LineGroup | null = null;

    for (const item of items) {
      if (!currentLine || Math.abs(currentLine.y - item.ty) > 4) {
        if (currentLine) {
          lines.push(currentLine);
        }
        currentLine = {
          y: item.ty,
          items: [item],
          text: item.str,
          estimatedHeight: item.height || 12,
        };
      } else {
        const lastItem = currentLine.items[currentLine.items.length - 1];
        // Calculate gap between previous and current token
        const gap = item.tx - (lastItem.tx + lastItem.width);
        const needsSpace =
          gap > 2 &&
          !lastItem.str.endsWith(' ') &&
          !item.str.startsWith(' ') &&
          !['.', ',', ';', ':', '!', '?', ')', ']', '}', '\'', '"'].includes(item.str);

        if (needsSpace) {
          currentLine.text += ' ';
        }
        currentLine.text += item.str;
        currentLine.items.push(item);
        if (item.height > currentLine.estimatedHeight) {
          currentLine.estimatedHeight = item.height;
        }
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    // If smartFormatting is false, simply join lines with newlines
    if (!smartFormatting) {
      const rawText = lines.map(l => l.text.trim()).filter(Boolean).join('\n');
      const paragraphs = lines.map(l => l.text.trim()).filter(Boolean);
      const wordCount = rawText.split(/\s+/).filter(Boolean).length;
      return {
        pageNumber,
        text: rawText,
        paragraphs,
        wordCount,
        characterCount: rawText.length,
        hasText: rawText.trim().length > 0,
      };
    }

    // Reconstruct intelligent paragraphs
    const paragraphs: string[] = [];
    let activePara = '';
    let lastLine: LineGroup | null = null;

    // Calculate median line gap to detect paragraph breaks
    const gaps: number[] = [];
    for (let i = 0; i < lines.length - 1; i++) {
      const diffY = lines[i].y - lines[i + 1].y;
      if (diffY > 0) gaps.push(diffY);
    }
    const avgGap = gaps.length > 0 ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 14;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.text.trim();
      if (!trimmedLine) continue;

      const isBullet = /^[•\-\*–—\d+\.\)]\s+/.test(trimmedLine);
      const looksLikeHeader =
        (trimmedLine.length < 60 && !/[.?!]$/.test(trimmedLine) && line.estimatedHeight > 15) ||
        trimmedLine.endsWith(':');

      let isNewParagraph = false;

      if (!activePara) {
        isNewParagraph = true;
      } else if (isBullet || looksLikeHeader) {
        isNewParagraph = true;
      } else if (lastLine) {
        const lineSpacing = lastLine.y - line.y;
        // Noticeable vertical gap between lines
        if (lineSpacing > avgGap * 1.45) {
          isNewParagraph = true;
        } else {
          // If previous line ended with a sentence terminator and is relatively short
          const prevTrimmed = lastLine.text.trim();
          if (/[.?!]$/.test(prevTrimmed) && prevTrimmed.length < 55) {
            isNewParagraph = true;
          }
        }
      }

      if (isNewParagraph && activePara) {
        paragraphs.push(activePara.trim());
        activePara = '';
      }

      if (!activePara) {
        activePara = trimmedLine;
      } else {
        // Hyphenation handling: e.g. "comunica-" + "zione"
        if (activePara.endsWith('-') && /^[a-zàèéìòù]/i.test(trimmedLine)) {
          activePara = activePara.slice(0, -1) + trimmedLine;
        } else {
          activePara += ' ' + trimmedLine;
        }
      }

      lastLine = line;
    }

    if (activePara.trim()) {
      paragraphs.push(activePara.trim());
    }

    const fullText = paragraphs.join('\n\n');
    const wordCount = fullText.split(/\s+/).filter(Boolean).length;

    return {
      pageNumber,
      text: fullText,
      paragraphs,
      wordCount,
      characterCount: fullText.length,
      hasText: fullText.trim().length > 3,
    };
  } catch (err) {
    console.error(`Error extracting text from page ${pageNumber}:`, err);
    return {
      pageNumber,
      text: '',
      paragraphs: [],
      wordCount: 0,
      characterCount: 0,
      hasText: false,
    };
  }
}

/**
 * Extracts all pages of a PDF document with progress reporting
 */
export async function extractAllPages(
  doc: pdfjsLib.PDFDocumentProxy,
  smartFormatting: boolean = true,
  onProgress?: (current: number, total: number) => void
): Promise<ExtractedPageText[]> {
  const total = doc.numPages;
  const results: ExtractedPageText[] = [];

  for (let pageNum = 1; pageNum <= total; pageNum++) {
    const pageText = await extractTextFromPage(doc, pageNum, smartFormatting);
    results.push(pageText);
    if (onProgress) {
      onProgress(pageNum, total);
    }
  }

  return results;
}

/**
 * Copies string text to clipboard safely across modern browsers
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.left = '-999999px';
      textarea.style.top = '-999999px';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const success = document.execCommand('copy');
      document.body.removeChild(textarea);
      return success;
    }
  } catch (err) {
    console.error('Failed to copy text:', err);
    return false;
  }
}

/**
 * Triggers a download of plain text as a .txt file
 */
export function downloadTextAsFile(filename: string, content: string): void {
  const cleanName = filename.replace(/\.pdf$/i, '') + '_testo_estratto.txt';
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = cleanName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
