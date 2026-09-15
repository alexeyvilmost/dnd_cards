import {decisionPolicyEnabled, type DecisionPolicyToggle} from '../solo-combat/decisionPolicies';
import SheetPassiveToggle from './SheetPassiveToggle';

export default function DecisionPolicyToggles({toggles, preferences, onChange, parent}: {
  toggles: DecisionPolicyToggle[];
  preferences: Readonly<Record<string, boolean>>;
  onChange: (id: string, enabled: boolean) => void;
  parent?: {name?: string; imageUrl?: string | null};
}) {
  return <div className="combat-decision-policies">{toggles.map(toggle => <SheetPassiveToggle key={toggle.id}
    toggle={{...toggle, sourceName: parent?.name, imageUrl: parent?.imageUrl || toggle.imageUrl}}
    enabled={decisionPolicyEnabled(toggle, preferences)} onChange={onChange}/>)}</div>;
}
