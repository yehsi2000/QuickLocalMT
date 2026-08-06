export function graphemes(text: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return Array.from(segmenter.segment(text), (segment) => segment.segment);
  }
  return Array.from(text);
}

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|(?<=[。！？…])(?=\S)|(?<=[.!?])(?=[\uac00-\ud7af\u3040-\u30ff\u4e00-\u9fff])/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function splitByGraphemes(text: string, maxChars: number): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const grapheme of graphemes(text)) {
    if (current.length > 0 && current.length + grapheme.length > maxChars) {
      chunks.push(current);
      current = grapheme;
    } else {
      current += grapheme;
    }
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}

export function chunkText(text: string, maxChars: number): string[] {
  if (maxChars <= 0) {
    return [text];
  }
  if (text.length <= maxChars) {
    return [text];
  }
  const sentences = splitSentences(text);
  if (sentences.length <= 1) {
    return splitByGraphemes(text, maxChars);
  }
  const chunks: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    const candidate = current.length === 0 ? sentence : `${current} ${sentence}`;
    if (candidate.length > maxChars && current.length > 0) {
      chunks.push(current);
      current = sentence;
    } else {
      current = candidate;
    }
    if (current.length > maxChars) {
      const overflow = splitByGraphemes(current, maxChars);
      const last = overflow[overflow.length - 1] ?? '';
      chunks.push(...overflow.slice(0, -1));
      current = last;
    }
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}

export function isWhitespaceOnly(value: string | null): boolean {
  return value === null || value.trim().length === 0;
}

export function truncateForPreview(text: string, maxChars: number): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  const head = graphemes(trimmed).slice(0, maxChars).join('');
  return `${head}\u2026`;
}

export function normalizeForComparison(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^[\s"'“”‘’「」『』【】()\[\]{}<>.,!?;:。！？；：、，.]+|[\s"'“”‘’「」『』【】()\[\]{}<>.,!?;:。！？；：、，.]+$/g, '')
    .trim();
}
