import type { Action } from '../../types';

type ActionHoverCardProps = {
  action: Action;
  sourceLabel?: string;
};

/** Описание, если оно информативно (не пустое и не повторяет имя). */
function usefulText(action: Action): string | null {
  for (const t of [action.description, action.detailed_description]) {
    const s = (t || '').trim();
    if (s && s !== action.name.trim()) return s;
  }
  return null;
}

const ActionHoverCard = ({ action, sourceLabel }: ActionHoverCardProps) => {
  const desc = usefulText(action);
  return (
    <div className="forge-effect-card">
      {action.image_url?.trim() && (
        <div className="forge-effect-card-art">
          <img src={action.image_url} alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        </div>
      )}
      <div className="forge-effect-card-body">
        <div className="forge-effect-card-title">{action.name}</div>
        <div className="forge-effect-card-type">{sourceLabel || 'Действие персонажа'}</div>
        {desc && <p className="forge-effect-card-desc">{desc}</p>}
      </div>
    </div>
  );
};

export default ActionHoverCard;
