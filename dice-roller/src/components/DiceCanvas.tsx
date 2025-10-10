import React from 'react'
import { DiceRoll } from '../types/dice'
import './DiceCanvas.css'

interface DiceCanvasProps {
  isRolling: boolean
  currentRoll: DiceRoll | null
}

const DiceCanvas: React.FC<DiceCanvasProps> = ({ isRolling, currentRoll }) => {
  return (
    <div className="dice-canvas">
      <div className="canvas-background">
        {/* Декоративные элементы фона */}
        <div className="grid-pattern"></div>
        <div className="compass-rose"></div>
      </div>
      
      {isRolling && (
        <div className="rolling-animation">
          <div className="rolling-dice">
            {Array.from({ length: 6 }, (_, i) => (
              <div 
                key={i} 
                className={`rolling-cube cube-${i + 1}`}
                style={{
                  animationDelay: `${i * 0.1}s`,
                  animationDuration: `${1.5 + Math.random() * 0.5}s`
                }}
              >
                <div className="cube-face">🎲</div>
              </div>
            ))}
          </div>
          <div className="rolling-text">
            <h2>Бросаем кубики...</h2>
            <div className="loading-dots">
              <span></span>
              <span></span>
              <span></span>
            </div>
          </div>
        </div>
      )}
      
      {currentRoll && !isRolling && (
        <div className="result-display">
          <div className="result-dice">
            {currentRoll.results.map((value, index) => (
              <div 
                key={index}
                className="result-cube"
                style={{
                  animationDelay: `${index * 0.1}s`
                }}
              >
                <div className="cube-value">{value}</div>
                <div className="cube-label">d{currentRoll.diceType}</div>
              </div>
            ))}
          </div>
          
          <div className="result-total">
            <div className="total-label">Итого:</div>
            <div className="total-number">{currentRoll.total}</div>
          </div>
        </div>
      )}
      
      {!isRolling && !currentRoll && (
        <div className="welcome-message">
          <h2>🎲 Добро пожаловать!</h2>
          <p>Выберите кубики и нажмите "Бросить"</p>
          <div className="welcome-dice">
            <div className="welcome-cube">🎲</div>
            <div className="welcome-cube">🎲</div>
            <div className="welcome-cube">🎲</div>
          </div>
        </div>
      )}
    </div>
  )
}

export default DiceCanvas

