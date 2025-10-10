import React, { useState, useCallback } from 'react'
import DiceCanvas from './DiceCanvas'
import DiceControls from './DiceControls'
import DiceResult from './DiceResult'
import { DiceRoll, DiceType } from '../types/dice'
import './DiceRoller.css'

const DiceRoller: React.FC = () => {
  const [diceRolls, setDiceRolls] = useState<DiceRoll[]>([])
  const [isRolling, setIsRolling] = useState(false)
  const [currentRoll, setCurrentRoll] = useState<DiceRoll | null>(null)

  const handleRoll = useCallback((diceType: DiceType, quantity: number, modifier: number = 0) => {
    setIsRolling(true)
    setCurrentRoll(null)

    // Создаем массив результатов бросков
    const results: number[] = []
    for (let i = 0; i < quantity; i++) {
      results.push(Math.floor(Math.random() * diceType) + 1)
    }

    const total = results.reduce((sum, result) => sum + result, 0) + modifier
    const roll: DiceRoll = {
      id: Date.now(),
      diceType,
      quantity,
      results,
      modifier,
      total,
      timestamp: new Date()
    }

    // Задержка для анимации
    setTimeout(() => {
      setCurrentRoll(roll)
      setDiceRolls(prev => [roll, ...prev.slice(0, 9)]) // Храним последние 10 бросков
      setIsRolling(false)
    }, 2000)
  }, [])

  const clearHistory = useCallback(() => {
    setDiceRolls([])
  }, [])

  return (
    <div className="dice-roller">
      <div className="dice-roller-content">
        <div className="dice-canvas-container">
          <DiceCanvas 
            isRolling={isRolling}
            currentRoll={currentRoll}
          />
          {currentRoll && (
            <DiceResult roll={currentRoll} />
          )}
        </div>
        
        <div className="dice-controls-container">
          <DiceControls 
            onRoll={handleRoll}
            isRolling={isRolling}
            onClearHistory={clearHistory}
            hasHistory={diceRolls.length > 0}
          />
          
          {diceRolls.length > 0 && (
            <div className="dice-history">
              <h3>История бросков</h3>
              <div className="history-list">
                {diceRolls.map(roll => (
                  <div key={roll.id} className="history-item">
                    <span className="dice-info">
                      {roll.quantity}d{roll.diceType}
                      {roll.modifier !== 0 && (
                        <span className="modifier">
                          {roll.modifier > 0 ? '+' : ''}{roll.modifier}
                        </span>
                      )}
                    </span>
                    <span className="dice-results">
                      [{roll.results.join(', ')}]
                      {roll.modifier !== 0 && (
                        <span className="modifier">
                          {roll.modifier > 0 ? '+' : ''}{roll.modifier}
                        </span>
                      )}
                    </span>
                    <span className="dice-total">{roll.total}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default DiceRoller

