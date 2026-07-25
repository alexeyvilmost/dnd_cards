import { Children, isValidElement, useEffect, useId, useState, type ReactElement, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSlug from 'rehype-slug';
import guideMd from '../../../docs/engine/README.md?raw';

function MermaidDiagram({ source }: { source: string }) {
  const reactId = useId();
  const diagramId = `engine-diagram-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setSvg('');
    setError('');

    import('mermaid')
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'base',
          themeVariables: {
            primaryColor: '#f2ead5',
            primaryTextColor: '#2a241c',
            primaryBorderColor: '#9b7f3d',
            lineColor: '#76674d',
            secondaryColor: '#ebe1c8',
            tertiaryColor: '#f7f3e8',
            background: '#fffdf7',
            mainBkg: '#f2ead5',
            clusterBkg: '#fffaf0',
            clusterBorder: '#cbb98c',
            edgeLabelBackground: '#fffdf7',
            fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
          },
        });
        const rendered = await mermaid.render(diagramId, source);
        if (active) setSvg(rendered.svg);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Не удалось отрисовать диаграмму');
      });

    return () => { active = false; };
  }, [diagramId, source]);

  if (error) {
    return (
      <div className="engine-diagram engine-diagram--error">
        <strong>Ошибка диаграммы:</strong> {error}
        <pre><code>{source}</code></pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="engine-diagram" role="img" aria-label="Архитектурная схема">
        <span className="engine-diagram-loading">Построение схемы…</span>
      </div>
    );
  }

  return (
    <div
      className="engine-diagram"
      role="img"
      aria-label="Архитектурная схема"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

function MarkdownPre({ children }: { children?: ReactNode }) {
  const child = Children.count(children) === 1 ? Children.only(children) : null;
  if (isValidElement(child)) {
    const code = child as ReactElement<{ className?: string; children?: ReactNode }>;
    if (code.props.className === 'language-mermaid') {
      return <MermaidDiagram source={String(code.props.children ?? '').replace(/\n$/, '')} />;
    }
  }
  return <pre>{children}</pre>;
}

export default function EngineGuide() {
  return (
    <article className="engine-guide">
      <style>{ENGINE_GUIDE_STYLES}</style>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSlug]}
        components={{ pre: MarkdownPre }}
      >
        {guideMd}
      </ReactMarkdown>
    </article>
  );
}

const ENGINE_GUIDE_STYLES = `
.engine-guide {
  max-width: 1080px;
  margin: 0 auto;
  padding: 12px 24px 80px;
  color: #2a241c;
  font-size: 15px;
  line-height: 1.68;
}
.engine-guide h1 {
  margin: 8px 0 18px;
  padding-bottom: 12px;
  border-bottom: 2px solid #b99a55;
  color: #1c1813;
  font-size: clamp(28px, 4vw, 40px);
  line-height: 1.15;
}
.engine-guide h2 {
  margin: 44px 0 14px;
  padding-bottom: 7px;
  border-bottom: 1px solid #d8c9a0;
  color: #4a3d1f;
  font-size: 24px;
  line-height: 1.25;
  scroll-margin-top: 64px;
}
.engine-guide h3 {
  margin: 28px 0 10px;
  color: #5a4a24;
  font-size: 19px;
  line-height: 1.3;
  scroll-margin-top: 64px;
}
.engine-guide h4 { margin: 20px 0 8px; color: #5a4a24; font-size: 16px; }
.engine-guide p { margin: 10px 0; }
.engine-guide ul, .engine-guide ol { margin: 10px 0; padding-left: 28px; }
.engine-guide li { margin: 5px 0; }
.engine-guide a { color: #795c12; text-decoration: underline; text-underline-offset: 2px; }
.engine-guide strong { color: #1c1813; }
.engine-guide blockquote {
  margin: 16px 0;
  padding: 10px 16px;
  border-left: 4px solid #b99a55;
  border-radius: 0 8px 8px 0;
  background: rgba(201, 176, 114, 0.14);
  color: #4a3d1f;
}
.engine-guide blockquote p { margin: 4px 0; }
.engine-guide code {
  padding: 1px 5px;
  border-radius: 4px;
  background: #efe8d6;
  color: #6b3a1f;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 13px;
}
.engine-guide pre {
  margin: 14px 0;
  padding: 14px 16px;
  overflow-x: auto;
  border: 1px solid #4a3d1f;
  border-radius: 9px;
  background: #1c1813;
  color: #e8e0d0;
}
.engine-guide pre code {
  padding: 0;
  background: none;
  color: inherit;
  font-size: 12.5px;
  line-height: 1.55;
}
.engine-guide table {
  display: block;
  width: 100%;
  margin: 14px 0 20px;
  overflow-x: auto;
  border-collapse: collapse;
  font-size: 13.5px;
}
.engine-guide th, .engine-guide td {
  min-width: 120px;
  padding: 7px 10px;
  border: 1px solid #d0c199;
  text-align: left;
  vertical-align: top;
}
.engine-guide th {
  background: #e6dcc0;
  color: #4a3d1f;
  font-weight: 700;
  white-space: nowrap;
}
.engine-guide tr:nth-child(even) td { background: rgba(230, 220, 192, 0.28); }
.engine-guide hr { margin: 34px 0; border: 0; border-top: 1px solid #d8c9a0; }
.engine-diagram {
  min-height: 180px;
  margin: 18px 0 24px;
  padding: 18px;
  overflow-x: auto;
  border: 1px solid #d0c199;
  border-radius: 10px;
  background: #fffdf7;
  text-align: center;
}
.engine-diagram svg { display: block; width: 100%; min-width: 620px; height: auto; margin: 0 auto; }
.engine-diagram-loading { color: #7b6d57; }
.engine-diagram--error { color: #8a2f25; text-align: left; }

@media (max-width: 640px) {
  .engine-guide { padding: 8px 12px 64px; font-size: 14.5px; }
  .engine-guide h2 { margin-top: 36px; font-size: 21px; }
  .engine-guide h3 { font-size: 17px; }
  .engine-diagram { padding: 10px; }
  .engine-diagram svg { min-width: 560px; }
}

@media print {
  @page { size: A4 landscape; margin: 12mm 14mm; }
  header { display: none !important; }
  .m-suggestion { display: none !important; }
  main { max-width: none !important; padding: 0 !important; }
  .engine-guide { max-width: none; padding: 0; color: #1c1813; font-size: 10pt; line-height: 1.45; }
  .engine-guide h1 { font-size: 24pt; }
  .engine-guide h2 { break-before: page; margin-top: 0; font-size: 17pt; }
  .engine-guide h3 { break-after: avoid; font-size: 13pt; }
  .engine-guide pre, .engine-guide table, .engine-diagram { break-inside: avoid; }
  .engine-guide table { display: table; font-size: 8.5pt; }
  .engine-guide a { color: inherit; text-decoration: none; }
  .engine-diagram { overflow: visible; background: #fff; }
  .engine-diagram svg { min-width: 0; max-height: 680px; }
}
`;
