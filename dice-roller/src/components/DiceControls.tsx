import React, { useState } from 'react'
import { DiceType, DICE_CONFIGS, DICE_TYPES } from '../types/dice'
import './DiceControls.css'

interface DiceControlsProps {
  onRoll: (diceType: DiceType, quantity: number, modifier: number) => void
  isRolling: boolean
  onClearHistory: () => void
  hasHistory: boolean
}

const DiceControls: React.FC<DiceControlsProps> = ({ 
  onRoll, 
  isRolling, 
  onClearHistory, 
  hasHistory 
}) => {
  const [selectedDice, setSelectedDice] = useState<DiceType>(20)
  const [quantity, setQuantity] = useState(1)
  const [modifier, setModifier] = useState(0)
  const [advantage, setAdvantage] = useState(false)
  const [disadvantage, setDisadvantage] = useState(false)

  const handleRoll = () => {
    if (advantage || disadvantage) {
      // Бросок с преимуществом/недостатком (2d20, берем лучший/худший)
      onRoll(20, 2, modifier)
    } else {
      onRoll(selectedDice, quantity, modifier)
    }
  }

  const handleQuickRoll = (diceType: DiceType) => {
    if (isRolling) return
    onRoll(diceType, 1, 0)
  }

  const resetControls = () => {
    setModifier(0)
    setAdvantage(false)
    setDisadvantage(false)
    setQuantity(1)
  }

  return (
    <div className="dice-controls">
      <div className="controls-header">
        <h3>Настройки броска</h3>
      </div>

      {/* Быстрые броски */}
      <div className="quick-rolls">
        <h4>Быстрые броски</h4>
        <div className="quick-roll-buttons">
          {DICE_TYPES.map(diceType => (
            <button
              key={diceType}
              className="quick-roll-btn"
              style={{ backgroundColor: DICE_CONFIGS[diceType].color }}
              onClick={() => handleQuickRoll(diceType)}
              disabled={isRolling}
            >
              d{diceType}
            </button>
          ))}
        </div>
      </div>

      {/* Выбор кубика */}
      <div className="dice-selection">
        <h4>Тип кубика</h4>
        <div className="dice-type-buttons">
          {DICE_TYPES.map(diceType => (
            <button
              key={diceType}
              className={`dice-type-btn ${selectedDice === diceType ? 'active' : ''}`}
              style={{ 
                backgroundColor: selectedDice === diceType ? DICE_CONFIGS[diceType].color : 'transparent',
                borderColor: DICE_CONFIGS[diceType].color
              }}
              onClick={() => setSelectedDice(diceType)}
              disabled={isRolling}
            >
              d{diceType}
            </button>
          ))}
        </div>
      </div>

      {/* Количество кубиков */}
      <div className="quantity-control">
        <h4>Количество</h4>
        <div className="quantity-input">
          <button 
            onClick={() => setQuantity(Math.max(1, quantity - 1))}
            disabled={isRolling || quantity <= 1}
          >
            -
          </button>
          <span className="quantity-display">{quantity}</span>
          <button 
            onClick={() => setQuantity(quantity + 1)}
            disabled={isRolling}
          >
            +
          </button>
        </div>
      </div>

      {/* Модификатор */}
      <div className="modifier-control">
        <h4>Модификатор</h4>
        <div className="modifier-input">
          <button 
            onClick={() => setModifier(modifier - 1)}
            disabled={isRolling}
          >
            -
          </button>
          <input
            type="number"
            value={modifier}
            onChange={(e) => setModifier(parseInt(e.target.value) || 0)}
            disabled={isRolling}
          />
          <button 
            onClick={() => setModifier(modifier + 1)}
            disabled={isRolling}
          >
            +
          </button>
        </div>
      </div>

      {/* Преимущество/Недостаток */}
      <div className="advantage-controls">
        <h4>Особые броски</h4>
        <div className="advantage-buttons">
          <button
            className={`advantage-btn ${advantage ? 'active' : ''}`}
            onClick={() => {
              setAdvantage(!advantage)
              setDisadvantage(false)
            }}
            disabled={isRolling}
          >
            Преимущество
          </button>
          <button
            className={`advantage-btn ${disadvantage ? 'active' : ''}`}
            onClick={() => {
              setDisadvantage(!disadvantage)
              setAdvantage(false)
            }}
            disabled={isRolling}
          >
            Недостаток
          </button>
        </div>
      </div>

      {/* Кнопки управления */}
      <div className="control-buttons">
        <button
          className="roll-btn"
          onClick={handleRoll}
          disabled={isRolling}
        >
          {isRolling ? 'Бросаем...' : '🎲 Бросить кубики'}
        </button>
        
        <button
          className="reset-btn"
          onClick={resetControls}
          disabled={isRolling}
        >
          Сброс
        </button>
        
        {hasHistory && (
          <button
            className="clear-btn"
            onClick={onClearHistory}
            disabled={isRolling}
          >
            Очистить историю
          </button>
        )}
      </div>

      {/* Информация о броске */}
      <div className="roll-info">
        <h4>Информация о броске</h4>
        <div className="roll-formula">
          {advantage ? (
            <span>2d20 (преимущество) + {modifier}</span>
          ) : disadvantage ? (
            <span>2d20 (недостаток) + {modifier}</span>
          ) : (
            <span>{quantity}d{selectedDice}{modifier !== 0 ? ` + ${modifier}` : ''}</span>
          )}
        </div>
      </div>
    </div>
  )
}

export default DiceControls

