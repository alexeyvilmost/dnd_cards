import {Ruler, Swords, Shield, ShieldCheck, Crosshair, FlaskConical, Leaf, Gem, Wrench, Zap, Sparkles, ScrollText, User, GraduationCap, Shirt, Footprints, Feather, Waves, Mountain, Shovel, Pin, Lightbulb, Heart, Crown, BookOpen, Hourglass, Focus, Circle, CircleDot, RefreshCw, PawPrint, Package, type LucideIcon} from 'lucide-react';

// Site controls and metadata share monochrome engraving-style strokes.
const ICONS: Record<string, LucideIcon> = {
  uses:CircleDot,
  attack:Crosshair, save:ShieldCheck,
  range:Ruler, '🎯':Ruler, '🎽':Shirt, '📖':BookOpen, '⏱':Hourglass, '◈':Focus, '⊙':Circle, '⟳':RefreshCw, '✦':Sparkles,
  '⚔️':Swords, '⚔':Swords, '🏹':Ruler, '🛡️':Shield, '🧪':FlaskConical, '🌿':Leaf, '💎':Gem, '🔧':Wrench,
  '⚡':Zap, '✨':Sparkles, '🔮':Sparkles, '🏅':Shield, '📜':ScrollText, '🧬':User, '🎓':GraduationCap,
  '👕':Shirt, '👢':Footprints, '👑':Crown, '🧥':Shirt, '💍':Gem, '🐾':PawPrint, '⛰️':Mountain, '🧸':Package, '❤️':Heart,
  '🚶':Footprints, '🕊️':Feather, '🏊':Waves, '🧗':Mountain, '⛏️':Shovel, '📌':Pin, '💡':Lightbulb,
};
export default function UiIcon({symbol, size=15}: {symbol:string;size?:number}) {
  const Icon = ICONS[symbol] ?? Sparkles;
  return <Icon aria-hidden="true" size={size} strokeWidth={1.6} style={{display:'inline-block',verticalAlign:'-.18em',flexShrink:0}} />;
}
/** Legacy selector copy keeps its labels; emoji prefixes are rendered as SVG. */
export function IconLabel({text}: {text?:string}) {
  if (!text) return null;
  const symbol = Object.keys(ICONS).find(key=>text.startsWith(key+' '));
  return symbol ? <><UiIcon symbol={symbol} size={20} />{' '}{text.slice(symbol.length).trimStart()}</> : <>{text}</>;
}
