const OVERLAY_ATTR = 'data-lst-overlay';

function composedTarget(event: MouseEvent): Element | null {
  const path = event.composedPath();
  if (path.length > 0) {
    const first = path[0];
    if (first instanceof Element) {
      return first;
    }
  }
  return event.target instanceof Element ? event.target : null;
}

export function isOverlayNode(node: Node): boolean {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.parentElement?.closest(`[${OVERLAY_ATTR}], [data-lst-ui]`) !== null;
  }
  if (node.nodeType === Node.ELEMENT_NODE) {
    return (node as Element).closest(`[${OVERLAY_ATTR}], [data-lst-ui]`) !== null;
  }
  return false;
}

export function startPicker(): Promise<Element | null> {
  return new Promise((resolve) => {
    let currentTarget: Element | null = null;
    let finished = false;

    const host = document.createElement('div');
    host.setAttribute(OVERLAY_ATTR, '');
    const shadow = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; }
      .outline {
        position: fixed;
        border: 2px solid #3b82f6;
        border-radius: 4px;
        background: rgba(59, 130, 246, 0.08);
        pointer-events: none;
        display: none;
      }
      .label {
        position: fixed;
        transform: translateY(-100%);
        background: #1e293b;
        color: #e2e8f0;
        font: 12px/1.4 system-ui, sans-serif;
        padding: 3px 8px;
        border-radius: 4px 4px 0 0;
        max-width: 60vw;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        pointer-events: none;
        display: none;
      }
      .hint {
        position: fixed;
        top: 16px;
        left: 50%;
        transform: translateX(-50%);
        background: #1e293b;
        color: #e2e8f0;
        font: 13px/1.5 system-ui, sans-serif;
        padding: 6px 14px;
        border-radius: 6px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.35);
        pointer-events: none;
      }
    `;
    shadow.appendChild(style);

    const outline = document.createElement('div');
    outline.className = 'outline';
    const label = document.createElement('div');
    label.className = 'label';
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = 'Click to select the highlighted area  ·  Esc to cancel';
    shadow.append(outline, label, hint);
    document.documentElement.appendChild(host);

    function positionOutline(target: Element): void {
      const rect = target.getBoundingClientRect();
      outline.style.display = 'block';
      outline.style.left = `${rect.left - 2}px`;
      outline.style.top = `${rect.top - 2}px`;
      outline.style.width = `${Math.max(0, rect.width + 4)}px`;
      outline.style.height = `${Math.max(0, rect.height + 4)}px`;
      label.style.display = 'block';
      label.style.left = `${rect.left - 2}px`;
      label.style.top = `${rect.top - 2}px`;
      const id = target.id ? `#${target.id}` : '';
      const classes = Array.from(target.classList).slice(0, 3).map((c) => `.${c}`).join('');
      label.textContent = `${target.tagName.toLowerCase()}${id}${classes}`;
    }

    function hideOutline(): void {
      outline.style.display = 'none';
      label.style.display = 'none';
    }

    function cleanup(): void {
      if (finished) {
        return;
      }
      finished = true;
      document.removeEventListener('mouseover', onMouseOver, true);
      document.removeEventListener('mouseout', onMouseOut, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKeyDown, true);
      host.remove();
    }

    function onMouseOver(event: MouseEvent): void {
      const target = composedTarget(event);
      if (!target || isOverlayNode(target)) {
        return;
      }
      currentTarget = target;
      positionOutline(target);
    }

    function onMouseOut(event: MouseEvent): void {
      if (currentTarget && event.target === currentTarget) {
        currentTarget = null;
        hideOutline();
      }
    }

    function onClick(event: MouseEvent): void {
      if (!currentTarget) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const selected = currentTarget;
      cleanup();
      resolve(selected);
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        cleanup();
        resolve(null);
      }
    }

    document.addEventListener('mouseover', onMouseOver, true);
    document.addEventListener('mouseout', onMouseOut, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);
  });
}
