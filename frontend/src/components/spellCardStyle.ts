// Общие стили BG3-тултипа для карточек заклинаний и действий (см. design_preview).
// Используется и SpellPreview, и ActionPreview, чтобы карточки выглядели одинаково.
export const SPELL_CARD_CSS = `
  .sp-tip{
    position:relative; width:340px; max-width:100%; border-radius:12px; color:#ece3d4;
    background:linear-gradient(160deg,#2b2520,#191410);
    border:1px solid #8a7320;
    box-shadow:0 12px 40px rgba(0,0,0,.6), inset 0 0 0 1px rgba(201,162,39,.08);
    padding:18px 18px 0; overflow:visible;
    font-family:"Segoe UI",system-ui,-apple-system,sans-serif;
  }
  .sp-tip.sp-hoverable{transition:transform .15s ease, box-shadow .15s ease;}
  .sp-tip.sp-hoverable:hover{transform:translateY(-3px);
    box-shadow:0 16px 48px rgba(0,0,0,.7), 0 0 18px rgba(201,162,39,.25), inset 0 0 0 1px rgba(201,162,39,.12);}
  .sp-tip .sp-bigicon{
    position:absolute; top:-26px; right:-18px; width:104px; height:104px;
    filter:drop-shadow(0 0 18px rgba(201,162,39,.55)); pointer-events:none; object-fit:contain;
  }
  .sp-tip h3{margin:0; font-family:"Georgia",serif; font-size:1.35rem; color:#f3ead4;
    padding-right:80px; line-height:1.15;}
  .sp-tip .sp-subtype{color:#a59886; font-size:.9rem; margin:.15rem 0 .8rem; font-style:italic; padding-right:60px;}
  .sp-tip .sp-stats{display:flex; flex-direction:column; gap:.42rem; margin:.5rem 0 .9rem;}
  .sp-srow{display:flex; align-items:center; gap:.55rem;}
  .sp-srow .sp-lbl{color:#a59886; font-size:.82rem; min-width:96px; flex:0 0 auto;}
  .sp-die{width:30px; height:30px; flex:0 0 auto; border-radius:6px;
    background:radial-gradient(circle at 50% 40%,#3a5f3a,#1d331d); border:1px solid #4f7d3a;
    display:flex; align-items:center; justify-content:center; font-weight:700; color:#cfeac0; font-size:.72rem;}
  .sp-die.sp-save{background:radial-gradient(circle at 50% 40%,#5a4a7a,#2a2140); border-color:#6a5a9a; color:#d8c8f0;}
  .sp-srow .sp-bonus{font-weight:700; font-size:1.02rem; color:#f3ead4;}
  .sp-dmgval{display:inline-flex; align-items:center; gap:.32rem; font-weight:700; font-size:1.02rem; flex-wrap:wrap;}
  .sp-dmgitem{display:inline-flex; align-items:center; gap:.28em; white-space:nowrap;}
  .sp-dmgval .sp-dmgicon{height:1.15em; width:1.15em; object-fit:contain; flex:0 0 auto;}
  .sp-dmgsep{color:#a59886; font-weight:400; margin:0 .15rem;}
  .sp-tip .sp-desc{font-size:.92rem; line-height:1.5; color:#d8cdb9; margin:.2rem 0 .9rem; white-space:pre-wrap;}
  .sp-tip .sp-desc b, .sp-tip .sp-desc .font-bold{color:#f0d98a; font-weight:600;}
  .sp-tip .sp-upcast{font-size:.88rem; line-height:1.45; color:#cdbf9a; margin:0 0 .9rem;}
  .sp-tip .sp-upcast .font-bold{color:#e7cf9a; font-weight:600;}
  .sp-tip .sp-upcast .sp-uplbl{color:#e7cf9a; font-weight:600;}
  .sp-tip .sp-saveline{font-size:.88rem; color:#e7cf9a; margin:0 0 .9rem; font-weight:600;}
  .sp-tip .sp-classes{font-size:.82rem; color:#a59886; margin:0 0 .7rem;}
  .sp-tip .sp-classes b{color:#cdbf9a; font-weight:600;}
  .sp-tip .sp-meta{display:flex; gap:1.1rem; flex-wrap:wrap; padding:.7rem 0;
    border-top:1px solid rgba(58,49,39,.5); color:#a59886; font-size:.84rem;}
  .sp-tip .sp-meta span{display:inline-flex; align-items:center; gap:.35rem;}
  .sp-tip .sp-meta i{opacity:.85; font-style:normal;}
  .sp-tip .sp-meta img.sp-metaicon{height:15px; width:15px; object-fit:contain; flex:0 0 auto;}
  .sp-tip .sp-costbar{display:flex; gap:.6rem; flex-wrap:wrap; margin:0 -18px; padding:.6rem 18px;
    background:linear-gradient(#221b15,#1a140f); border-top:1px solid #4a3f35; border-radius:0 0 12px 12px;}
  .sp-cost{display:inline-flex; align-items:center; gap:.35rem; font-size:.84rem; color:#ece3d4;}
  .sp-cost .sp-costicon{width:16px; height:16px; object-fit:contain; flex:0 0 auto;}
  .sp-spacer{height:14px;}
  .sp-tip .sp-pagelink{display:inline-block; margin:0 0 .7rem; font-size:.82rem; color:#d8b978;
    text-decoration:none; border:1px solid #6b5836; border-radius:6px; padding:3px 10px; transition:.12s;}
  .sp-tip .sp-pagelink:hover{background:rgba(216,185,120,.12); border-color:#d8b978;}
`;
