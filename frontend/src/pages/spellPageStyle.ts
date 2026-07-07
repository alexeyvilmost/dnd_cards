// Вики-страница заклинания — тёмно-золотая палитра листа персонажа (--forge-*).
export const SPELLPAGE_CSS = `
.spellpage {
  --sp-bg:#141210; --sp-panel:#1c1813; --sp-panel2:#241f18; --sp-line:#6b5836;
  --sp-gold:#d8b978; --sp-gold-dim:#c9a45f; --sp-text:#e8e0d0; --sp-dim:#a99f8b;
  position:fixed; inset:0; overflow:auto; background:
    radial-gradient(1200px 500px at 50% -10%, rgba(201,162,39,.06), transparent 60%),
    var(--sp-bg);
  color:var(--sp-text);
  font-family:"Segoe UI",system-ui,-apple-system,sans-serif;
}
.spellpage .spw-center { display:flex; align-items:center; justify-content:center; min-height:60vh; gap:8px; color:var(--sp-dim); }
.spw-inner { max-width:1120px; margin:0 auto; padding:22px 20px 60px; }

.spw-head { border-bottom:1px solid var(--sp-line); padding-bottom:14px; margin-bottom:18px; }
.spw-back { display:inline-block; color:var(--sp-dim); font-size:13px; text-decoration:none; margin-bottom:10px; }
.spw-back:hover { color:var(--sp-gold); }
.spw-title { margin:0; font-family:Georgia,serif; font-size:2.1rem; color:var(--sp-gold); line-height:1.1; }
.spw-subtype { color:var(--sp-dim); font-size:1rem; font-style:italic; margin-top:4px; }

.spw-cols { display:grid; grid-template-columns:minmax(0,1fr) 330px; gap:22px; align-items:start; }
@media (max-width:820px){ .spw-cols { grid-template-columns:1fr; } .spw-side{ order:-1; } }

.spw-main { display:flex; flex-direction:column; gap:16px; min-width:0; }
.spw-panel {
  background:var(--sp-panel); border:1px solid var(--sp-line); border-radius:12px;
  padding:16px 18px; box-shadow:0 8px 28px rgba(0,0,0,.35);
}
.spw-panel-h {
  font-family:Georgia,serif; font-size:.82rem; letter-spacing:.12em; text-transform:uppercase;
  color:var(--sp-gold-dim); margin-bottom:10px; border-bottom:1px solid rgba(107,88,54,.5); padding-bottom:6px;
}
.spw-desc { font-size:1rem; line-height:1.62; color:#ddd2bb; white-space:pre-wrap; }
.spw-desc-full { font-size:.98rem; color:#cfc3ab; }
.spw-desc b, .spw-desc .font-bold { color:#f0d98a; font-weight:600; }
.spw-upcast { margin-top:12px; font-size:.92rem; line-height:1.5; color:#cdbf9a; }
.spw-upcast-l { color:#e7cf9a; font-weight:600; }
.spw-saveline { margin-top:12px; font-size:.9rem; color:#e7cf9a; font-weight:600; }

.spw-side { display:flex; flex-direction:column; gap:14px; }
.spw-art {
  width:100%; aspect-ratio:1/1; border-radius:14px; overflow:hidden;
  border:1px solid var(--sp-line); background:radial-gradient(circle at 50% 35%, #2a2318, #17130e);
  display:flex; align-items:center; justify-content:center;
}
.spw-art img { width:100%; height:100%; object-fit:contain; filter:drop-shadow(0 0 18px rgba(201,162,39,.35)); }

.spw-statblock {
  background:var(--sp-panel); border:1px solid var(--sp-line); border-radius:12px;
  padding:6px 16px; box-shadow:0 8px 28px rgba(0,0,0,.35);
}
.spw-row { display:flex; gap:10px; padding:9px 0; border-bottom:1px solid rgba(107,88,54,.28); font-size:.92rem; }
.spw-row:last-child { border-bottom:none; }
.spw-row-l { flex:0 0 108px; color:var(--sp-dim); }
.spw-row-v { flex:1 1 auto; color:var(--sp-text); font-weight:600; }
.spw-divider { height:1px; background:linear-gradient(90deg, transparent, rgba(201,162,39,.35), transparent); margin:6px 0; }

.spw-dmg { display:inline-flex; flex-wrap:wrap; gap:6px; align-items:center; }
.spw-dmgitem { display:inline-flex; align-items:center; gap:3px; font-weight:700; }
.spw-dmgsep { color:var(--sp-dim); font-weight:400; margin-right:4px; }
.spw-dmgicon { width:1.05em; height:1.05em; object-fit:contain; }
`;
