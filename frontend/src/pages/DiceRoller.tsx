import React from 'react'
import './DiceRoller.css'

const DiceRoller: React.FC = () => {
  return (
    <div className="dice-roller-page">
      <div className="page-header">
        <h1>🎲 Броски кубиков</h1>
        <p>Интерактивные броски кубиков для D&D</p>
      </div>
      
      <div className="dice-container">
        <iframe
          src="http://localhost:3001"
          title="D&D Dice Roller"
          className="dice-iframe"
          allowFullScreen
        />
      </div>
      
      <div className="dice-info">
        <h3>Возможности</h3>
        <div className="features-grid">
          <div className="feature-card">
            <div className="feature-icon">🎯</div>
            <h4>Все типы кубиков</h4>
            <p>d4, d6, d8, d10, d12, d20, d100</p>
          </div>
          
          <div className="feature-card">
            <div className="feature-icon">⚡</div>
            <h4>Быстрые броски</h4>
            <p>Один клик для мгновенного броска</p>
          </div>
          
          <div className="feature-card">
            <div className="feature-icon">🎲</div>
            <h4>Модификаторы</h4>
            <p>Добавление бонусов к броскам</p>
          </div>
          
          <div className="feature-card">
            <div className="feature-icon">🎪</div>
            <h4>Преимущество/Недостаток</h4>
            <p>Специальные броски для d20</p>
          </div>
          
          <div className="feature-card">
            <div className="feature-icon">📊</div>
            <h4>История бросков</h4>
            <p>Отслеживание последних результатов</p>
          </div>
          
          <div className="feature-card">
            <div className="feature-icon">✨</div>
            <h4>Красивая анимация</h4>
            <p>Реалистичные броски кубиков</p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default DiceRoller






















