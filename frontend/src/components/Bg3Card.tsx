import React from 'react';
import OriginalName from './OriginalName';

interface Bg3CardProps {
  title: string;
  /** Оригинальное (английское) название — показывается под заголовком, если включена настройка. */
  titleEn?: string | null;
  subtype?: string;
  imageUrl?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  disableHover?: boolean;
  onClick?: () => void;
  className?: string;
}

// Общий тёмно-золотой «инспектор» в стиле BG3 (как у заклинаний).
// Заголовок + подтип + произвольное тело + опциональная нижняя плашка.
const Bg3Card: React.FC<Bg3CardProps> = ({
  title,
  titleEn,
  subtype,
  imageUrl,
  children,
  footer,
  disableHover = false,
  onClick,
  className = '',
}) => {
  return (
    <div
      className={`bg3-tip ${disableHover ? '' : 'bg3-hoverable'} ${className}`}
      onClick={onClick}
      style={onClick ? { cursor: 'pointer' } : undefined}
    >
      <style>{`
        .bg3-tip{
          position:relative; width:340px; max-width:100%; border-radius:12px; color:#ece3d4;
          background:linear-gradient(160deg,#2b2520,#191410);
          border:1px solid #8a7320;
          box-shadow:0 12px 40px rgba(0,0,0,.6), inset 0 0 0 1px rgba(201,162,39,.08);
          padding:18px 18px 0; overflow:visible;
          font-family:"Segoe UI",system-ui,-apple-system,sans-serif;
        }
        .bg3-tip.bg3-hoverable{transition:transform .15s ease, box-shadow .15s ease;}
        .bg3-tip.bg3-hoverable:hover{transform:translateY(-3px);
          box-shadow:0 16px 48px rgba(0,0,0,.7), 0 0 18px rgba(201,162,39,.25), inset 0 0 0 1px rgba(201,162,39,.12);}
        .bg3-tip .bg3-bigicon{
          position:absolute; top:-26px; right:-18px; width:104px; height:104px;
          filter:drop-shadow(0 0 18px rgba(201,162,39,.55)); pointer-events:none; object-fit:contain;
        }
        .bg3-tip h3{margin:0; font-family:"Georgia",serif; font-size:1.35rem; color:#f3ead4;
          padding-right:80px; line-height:1.15;}
        .bg3-tip .bg3-subtype{color:#a59886; font-size:.9rem; margin:.15rem 0 .8rem; font-style:italic; padding-right:60px;}
        .bg3-tip .bg3-stats{display:flex; flex-direction:column; gap:.42rem; margin:.5rem 0 .8rem;}
        .bg3-srow{display:flex; align-items:baseline; gap:.5rem;}
        .bg3-srow .bg3-lbl{color:#a59886; font-size:.82rem; min-width:120px; flex:0 0 auto;}
        .bg3-srow .bg3-val{color:#f3ead4; font-size:.9rem; font-weight:600;}
        .bg3-tip .bg3-desc{font-size:.92rem; line-height:1.5; color:#d8cdb9; margin:.2rem 0 .9rem; white-space:pre-wrap;}
        .bg3-tip .bg3-desc b, .bg3-tip .bg3-desc .font-bold{color:#f0d98a; font-weight:600;}
        .bg3-tip .bg3-extra{font-size:.88rem; line-height:1.45; color:#cdbf9a; margin:0 0 .9rem;}
        .bg3-tip .bg3-costbar{display:flex; gap:.6rem; flex-wrap:wrap; align-items:center; margin:0 -18px; padding:.6rem 18px;
          background:linear-gradient(#221b15,#1a140f); border-top:1px solid #4a3f35; border-radius:0 0 12px 12px;
          color:#ece3d4; font-size:.84rem;}
        .bg3-tip .bg3-spacer{height:14px;}
        .bg3-chip{display:inline-flex; align-items:center; gap:.3rem; padding:.12rem .5rem; border-radius:999px;
          background:rgba(201,162,39,.14); border:1px solid #8a7320; color:#f0d98a; font-size:.78rem; font-weight:600;}
      `}</style>

      {imageUrl && imageUrl.trim() !== '' && (
        <img
          className="bg3-bigicon"
          src={imageUrl}
          alt={title}
          onError={(e) => { (e.target as HTMLImageElement).src = '/default_image.png'; }}
        />
      )}

      <h3>{title}</h3>
      {(titleEn || subtype) && (
        <div className="bg3-subtype"><OriginalName nameEn={titleEn} suffix={subtype} /></div>
      )}
      {children}
      {footer ? <div className="bg3-costbar">{footer}</div> : <div className="bg3-spacer" />}
    </div>
  );
};

export default Bg3Card;
