import type { Action } from '../../types';

type ActionHoverCardProps = {
  action: Action;
  sourceLabel?: string;
};

const ActionHoverCard = ({ action, sourceLabel }: ActionHoverCardProps) => (
  <div className="forge-effect-card">
    {action.image_url?.trim() && (
      <div className="forge-effect-card-art">
        <img src={action.image_url} alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
      </div>
    )}
    <div className="forge-effect-card-body">
      <div className="forge-effect-card-title">{action.name}</div>
      <div className="forge-effect-card-type">{sourceLabel || 'Действие персонажа'}</div>
      <p className="forge-effect-card-desc">{action.description}</p>
    </div>
  </div>
);

export default ActionHoverCard;
