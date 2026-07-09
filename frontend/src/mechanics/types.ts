export type Mechanics = {
  meta?: { id?: string; name?: string };
  activation: Activation;
  uses?: { count?: number | string; per?: string };
  targeting?: Record<string, unknown>;
  effects: Interaction[];
};

export type Activation = {
  mode: 'passive' | 'active' | 'reaction' | 'triggered';
  cost?: Array<{ resource?: string }>;
  trigger?: Trigger;
  requirements?: Requirement[];
  /** Гейт применимости предмета (S2 «предмет=эффект»): equipped(по умолч.) | carried | attuned. */
  while?: 'equipped' | 'carried' | 'attuned';
};

export type Trigger = {
  timing?: 'before' | 'during' | 'after' | 'replaces';
  event: string;
  subject?: string;
  circumstances?: Record<string, unknown>[];
};

export type Requirement = {
  type: string;
  min_level?: number;
  [key: string]: unknown;
};

export type Interaction =
  | { resolution: 'auto'; result: Payload[] }
  | {
      resolution: 'save' | 'attack_roll';
      who?: string;
      ability?: string;
      dc?: string;
      on_fail?: Payload[];
      on_success?: Payload[];
      [key: string]: unknown;
    };

export type Payload = { kind: string } & Record<string, unknown>;

export type ChoiceOptions = {
  source: string;
  filter?: string | string[];
  items?: SubfeatureItem[];
};

export type SubfeatureItem = {
  id: string;
  name: string;
  grants: Payload[];
};

export type ChoicePayload = Payload & {
  kind: 'choice';
  id: string;
  prompt?: string;
  count?: number;
  options: ChoiceOptions;
  recommended?: string[];
  grant?: Payload;
  resolution?: 'on_acquire' | 'immediate';
};
