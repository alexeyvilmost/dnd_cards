import React from 'react'
import { DiceRoll, DICE_CONFIGS } from '../types/dice'
import './DiceResult.css'

interface DiceResultProps {
  roll: DiceRoll
}

const DiceResult: React.FC<DiceResultProps> = ({ roll }) => {
  const config = DICE_CONFIGS[roll.diceType]
  
  return (
    <div className="dice-result">
      <div className="result-header">
        <h2>Результат броска</h2>
        <div className="dice-info">
          {roll.quantity}d{roll.diceType}
          {roll.modifier !== 0 && (
            <span className="modifier">
              {roll.modifier > 0 ? '+' : ''}{roll.modifier}
            </span>
          )}
        </div>
      </div>
      
      <div className="result-breakdown">
        <div className="dice-values">
          {roll.results.map((value, index) => (
            <div 
              key={index} 
              className="dice-value"
              style={{ backgroundColor: config.color }}
            >
              {value}
            </div>
          ))}
        </div>
        
        {roll.modifier !== 0 && (
          <div className="modifier-part">
            <span>+</span>
            <div className="modifier-value">{roll.modifier}</div>
          </div>
        )}
        
        <div className="total-part">
          <span>=</span>
          <div className="total-value">{roll.total}</div>
        </div>
      </div>
      
      <div className="result-formula">
        [{roll.results.join(' + ')}]
        {roll.modifier !== 0 && ` + ${roll.modifier}`}
        {' = '}
        <strong>{roll.total}</strong>
      </div>
    </div>
  )
}

export default DiceResult

