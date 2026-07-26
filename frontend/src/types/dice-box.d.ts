declare module '@3d-dice/dice-box' {
  export interface DiceNotation {
    qty?: number;
    sides: number | string;
    theme?: string;
    themeColor?: string;
  }

  export interface DiceResult {
    groupId: number;
    rollId: number;
    sides: number;
    value?: number;
    result?: number;
    theme?: string;
    themeColor?: string;
  }

  export interface DiceResultGroup {
    id: number;
    qty: number;
    sides: number;
    value: number;
    rolls: DiceResult[];
  }

  export interface DiceBoxConfig {
    assetPath: string;
    container?: string | HTMLElement;
    id?: string;
    gravity?: number;
    mass?: number;
    friction?: number;
    restitution?: number;
    angularDamping?: number;
    linearDamping?: number;
    spinForce?: number;
    throwForce?: number;
    startingHeight?: number;
    settleTimeout?: number;
    delay?: number;
    lightIntensity?: number;
    enableShadows?: boolean;
    shadowTransparency?: number;
    theme?: string;
    themeColor?: string;
    scale?: number;
    offscreen?: boolean;
  }

  export default class DiceBox {
    constructor(config: DiceBoxConfig);
    init(): Promise<void>;
    roll(
      notation: string | DiceNotation | Array<string | DiceNotation>,
      options?: { theme?: string; newStartPoint?: boolean },
    ): Promise<Array<DiceResultGroup | DiceResult>>;
    clear(): this;
    updateConfig(config: Partial<DiceBoxConfig>): void;
  }
}
