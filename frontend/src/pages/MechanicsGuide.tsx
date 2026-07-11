/**
 * Страница документации «Унифицированная механика». Рендерит markdown-руководство
 * (frontend/src/docs/mechanics-guide.md) через react-markdown + remark-gfm (таблицы).
 * Открывается из верхней панели (ссылка «Документация»).
 */
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import guideMd from '../docs/mechanics-guide.md?raw';

export default function MechanicsGuide() {
  return (
    <div className="mechanics-guide">
      <style>{MG_STYLES}</style>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{guideMd}</ReactMarkdown>
    </div>
  );
}

const MG_STYLES = `
.mechanics-guide {
  max-width: 900px;
  margin: 0 auto;
  padding: 8px 20px 64px;
  color: #2a241c;
  line-height: 1.6;
  font-size: 15px;
}
.mechanics-guide h1 {
  font-size: 30px; font-weight: 700; margin: 8px 0 16px; color: #1c1813;
  border-bottom: 2px solid #c9b072; padding-bottom: 10px;
}
.mechanics-guide h2 {
  font-size: 22px; font-weight: 700; margin: 32px 0 12px; color: #4a3d1f;
  border-bottom: 1px solid #d8c9a0; padding-bottom: 6px;
}
.mechanics-guide h3 { font-size: 18px; font-weight: 700; margin: 22px 0 8px; color: #5a4a24; }
.mechanics-guide h4 { font-size: 16px; font-weight: 700; margin: 16px 0 6px; color: #5a4a24; }
.mechanics-guide p { margin: 10px 0; }
.mechanics-guide ul, .mechanics-guide ol { margin: 10px 0; padding-left: 26px; }
.mechanics-guide li { margin: 4px 0; }
.mechanics-guide a { color: #8a6d1f; text-decoration: underline; }
.mechanics-guide strong { color: #1c1813; }
.mechanics-guide blockquote {
  margin: 14px 0; padding: 8px 14px; border-left: 4px solid #c9b072;
  background: rgba(201,176,114,0.12); border-radius: 0 6px 6px 0; color: #4a3d1f;
}
.mechanics-guide blockquote p { margin: 4px 0; }
.mechanics-guide code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 13px; background: #efe8d6; color: #6b3a1f; padding: 1px 5px; border-radius: 4px;
}
.mechanics-guide pre {
  background: #1c1813; color: #e8e0d0; padding: 12px 14px; border-radius: 8px;
  overflow-x: auto; margin: 12px 0; border: 1px solid #4a3d1f;
}
.mechanics-guide pre code { background: none; color: inherit; padding: 0; font-size: 12.5px; line-height: 1.5; }
.mechanics-guide table {
  border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 13.5px;
  display: block; overflow-x: auto;
}
.mechanics-guide th, .mechanics-guide td {
  border: 1px solid #d0c199; padding: 6px 10px; text-align: left; vertical-align: top;
}
.mechanics-guide th { background: #e6dcc0; font-weight: 700; color: #4a3d1f; white-space: nowrap; }
.mechanics-guide tr:nth-child(even) td { background: rgba(230,220,192,0.35); }
.mechanics-guide hr { border: none; border-top: 1px solid #d8c9a0; margin: 28px 0; }

@media (prefers-color-scheme: dark) {
  .mechanics-guide { color: #e8e0d0; }
  .mechanics-guide h1 { color: #f0e8d6; }
  .mechanics-guide h2, .mechanics-guide h3, .mechanics-guide h4 { color: #d8b978; }
  .mechanics-guide strong { color: #f0e8d6; }
  .mechanics-guide code { background: #2b2520; color: #e0a878; }
  .mechanics-guide th { background: #2b2520; color: #d8b978; }
  .mechanics-guide td { border-color: #4a3d2f; }
  .mechanics-guide tr:nth-child(even) td { background: rgba(43,37,32,0.5); }
  .mechanics-guide blockquote { background: rgba(216,185,120,0.1); color: #d8cbb0; }
}
`;
