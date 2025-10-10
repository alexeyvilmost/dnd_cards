export type DiceType = 4 | 6 | 8 | 10 | 12 | 20 | 100

export interface DiceRoll {
  id: number
  diceType: DiceType
  quantity: number
  results: number[]
  modifier: number
  total: number
  timestamp: Date
}

export interface DiceConfig {
  type: DiceType
  name: string
  sides: number
  color: string
}

export const DICE_CONFIGS: Record<DiceType, DiceConfig> = {
  4: { type: 4, name: 'd4', sides: 4, color: '#ff6b6b' },
  6: { type: 6, name: 'd6', sides: 6, color: '#4ecdc4' },
  8: { type: 8, name: 'd8', sides: 8, color: '#45b7d1' },
  10: { type: 10, name: 'd10', sides: 10, color: '#96ceb4' },
  12: { type: 12, name: 'd12', sides: 12, color: '#feca57' },
  20: { type: 20, name: 'd20', sides: 20, color: '#ff9ff3' },
  100: { type: 100, name: 'd100', sides: 100, color: '#54a0ff' }
}

export const DICE_TYPES: DiceType[] = [4, 6, 8, 10, 12, 20, 100]

