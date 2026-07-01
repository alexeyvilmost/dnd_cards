import type { Action } from '../../types';
import { ACTION_TYPE_OPTIONS } from '../../types';

type ActionHoverCardProps = {
  action: Action;
};

const actionTypeLabel = (t: string) =>
  ACTION_TYPE_OPTIONS.find((o) => o.value === t)?.label || t;

const ActionHoverCard = ({ action }: ActionHoverCardProps) => (
  <div className="forge-effect-card">
    {action.image_url?.trim() && (
      <div className="forge-effect-card-art">
        <img src={action.image_url} alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
      </div>
    )}
    <div className="forge-effect-card-body">
      <div className="forge-effect-card-title">{action.name}</div>
      <div className="forge-effect-card-type">{actionTypeLabel(action.action_type)}</div>
      <p className="forge-effect-card-desc">{action.description}</p>
    </div>
  </div>
);

export default ActionHoverCard;
