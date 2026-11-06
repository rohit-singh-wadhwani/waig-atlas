import React, { useEffect, useMemo, useRef } from 'react';

declare global {
  interface Window {
    marked?: any;
    mermaid?: any;
  }
}

let mermaidReady = false;
function initMermaid() {
  if (mermaidReady || !window.mermaid) return;
  window.mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
    themeVariables: {
      primaryColor: '#eff7f7', primaryBorderColor: '#3e8a8b', primaryTextColor: '#111827', lineColor: '#6b7280',
      secondaryColor: '#fef7ee', tertiaryColor: '#f3f4f6', fontSize: '14px',
    },
    gantt: { barHeight: 22, fontSize: 12, sectionFontSize: 12 },
  });
  mermaidReady = true;
}

function sanitize(html: string): string {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  doc.querySelectorAll('script,style,iframe,object,embed,form,link,meta').forEach((n) => n.remove());
  doc.querySelectorAll('*').forEach((el) => {
    for (const a of Array.from(el.attributes)) {
      const n = a.name.toLowerCase();
      if (n.startsWith('on')) el.removeAttribute(a.name);
      if ((n === 'href' || n === 'src') && /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
    }
    if (el.tagName === 'A') {
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noreferrer');
    }
  });
  return doc.body.firstElementChild?.innerHTML || '';
}

export function renderMarkdown(md: string): string {
  if (!window.marked) return `<pre>${md.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!))}</pre>`;
  return sanitize(window.marked.parse(md || '', { gfm: true, breaks: false }));
}

let seq = 0;
export default function Markdown({ md, className = '' }: { md: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const html = useMemo(() => renderMarkdown(md), [md]);
  useEffect(() => {
    const root = ref.current;
    if (!root || !window.mermaid) return;
    initMermaid();
    const blocks = Array.from(root.querySelectorAll('code.language-mermaid')) as HTMLElement[];
    blocks.forEach(async (code) => {
      const src = code.textContent || '';
      const pre = code.parentElement!;
      const holder = document.createElement('div');
      holder.className = 'mermaid-holder';
      pre.replaceWith(holder);
      try {
        const { svg } = await window.mermaid.render(`mmd-${++seq}`, src);
        holder.innerHTML = svg;
      } catch (e: any) {
        holder.innerHTML = `<div class="text-sm text-red-600">Diagram error: ${String(e?.message || e).slice(0, 200)}</div><pre>${src.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!))}</pre>`;
        document.getElementById(`dmmd-${seq}`)?.remove();
      }
    });
  }, [html]);
  return <div ref={ref} className={`prose-atlas ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}
