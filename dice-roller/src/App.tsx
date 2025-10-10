import DiceRoller from './components/DiceRoller'
import './App.css'

function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1>🎲 D&D Dice Roller</h1>
        <p>Интерактивные броски кубиков для D&D</p>
      </header>
      <main className="app-main">
        <DiceRoller />
      </main>
    </div>
  )
}

export default App
