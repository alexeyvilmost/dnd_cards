#!/bin/bash

# Создаем изображения для всех типов оружия

# Длинный лук
cat > longbow.svg << 'EOF'
<svg width="100" height="100" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bowGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#8B4513;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#654321;stop-opacity:1" />
    </linearGradient>
  </defs>
  
  <!-- Лук (больше) -->
  <path d="M15 50 Q50 15 85 50 Q50 85 15 50" 
        fill="none" 
        stroke="url(#bowGradient)" 
        stroke-width="4"/>
  
  <!-- Тетива -->
  <line x1="15" y1="50" x2="85" y2="50" 
        stroke="#F5F5DC" 
        stroke-width="1"/>
  
  <!-- Стрела -->
  <line x1="20" y1="50" x2="80" y2="50" 
        stroke="#8B4513" 
        stroke-width="2"/>
  
  <!-- Наконечник стрелы -->
  <polygon points="80,50 85,48 85,52" 
           fill="#C0C0C0"/>
  
  <!-- Оперение стрелы -->
  <polygon points="20,50 25,48 25,52" 
           fill="#8B0000"/>
</svg>
EOF

# Кинжал
cat > dagger.svg << 'EOF'
<svg width="100" height="100" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="daggerGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#C0C0C0;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#808080;stop-opacity:1" />
    </linearGradient>
  </defs>
  
  <!-- Клинок -->
  <polygon points="48,20 52,20 50,60" 
           fill="url(#daggerGradient)" 
           stroke="#696969" 
           stroke-width="1"/>
  
  <!-- Острие -->
  <polygon points="50,20 48,15 52,15" 
           fill="url(#daggerGradient)" 
           stroke="#696969" 
           stroke-width="1"/>
  
  <!-- Рукоять -->
  <rect x="45" y="60" width="10" height="15" 
        fill="#8B4513" 
        stroke="#654321" 
        stroke-width="1"/>
  
  <!-- Гарда -->
  <rect x="40" y="58" width="20" height="4" 
        fill="#FFD700" 
        stroke="#DAA520" 
        stroke-width="1"/>
</svg>
EOF

# Булава
cat > mace.svg << 'EOF'
<svg width="100" height="100" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="maceGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#C0C0C0;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#808080;stop-opacity:1" />
    </linearGradient>
  </defs>
  
  <!-- Головка булавы -->
  <circle cx="50" cy="30" r="15" 
          fill="url(#maceGradient)" 
          stroke="#696969" 
          stroke-width="2"/>
  
  <!-- Шипы -->
  <circle cx="35" cy="30" r="3" fill="#696969"/>
  <circle cx="65" cy="30" r="3" fill="#696969"/>
  <circle cx="50" cy="15" r="3" fill="#696969"/>
  <circle cx="50" cy="45" r="3" fill="#696969"/>
  
  <!-- Рукоять -->
  <rect x="47" y="45" width="6" height="35" 
        fill="#8B4513" 
        stroke="#654321" 
        stroke-width="1"/>
</svg>
EOF

# Копье
cat > spear.svg << 'EOF'
<svg width="100" height="100" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="spearGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#C0C0C0;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#808080;stop-opacity:1" />
    </linearGradient>
  </defs>
  
  <!-- Наконечник -->
  <polygon points="50,20 45,30 55,30" 
           fill="url(#spearGradient)" 
           stroke="#696969" 
           stroke-width="1"/>
  
  <!-- Древко -->
  <rect x="48" y="30" width="4" height="50" 
        fill="#8B4513" 
        stroke="#654321" 
        stroke-width="1"/>
  
  <!-- Острие -->
  <polygon points="50,20 48,15 52,15" 
           fill="url(#spearGradient)" 
           stroke="#696969" 
           stroke-width="1"/>
</svg>
EOF

# Молот
cat > warhammer.svg << 'EOF'
<svg width="100" height="100" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="hammerGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#C0C0C0;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#808080;stop-opacity:1" />
    </linearGradient>
  </defs>
  
  <!-- Головка молота -->
  <rect x="35" y="25" width="30" height="20" 
        fill="url(#hammerGradient)" 
        stroke="#696969" 
        stroke-width="2"/>
  
  <!-- Рукоять -->
  <rect x="47" y="45" width="6" height="35" 
        fill="#8B4513" 
        stroke="#654321" 
        stroke-width="1"/>
  
  <!-- Острие -->
  <polygon points="35,25 30,20 40,20" 
           fill="url(#hammerGradient)" 
           stroke="#696969" 
           stroke-width="1"/>
</svg>
EOF

# Арбалет
cat > crossbow.svg << 'EOF'
<svg width="100" height="100" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="crossbowGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#8B4513;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#654321;stop-opacity:1" />
    </linearGradient>
  </defs>
  
  <!-- Лук арбалета -->
  <path d="M20 50 Q50 20 80 50 Q50 80 20 50" 
        fill="none" 
        stroke="url(#crossbowGradient)" 
        stroke-width="3"/>
  
  <!-- Основание -->
  <rect x="40" y="45" width="20" height="10" 
        fill="#8B4513" 
        stroke="#654321" 
        stroke-width="1"/>
  
  <!-- Рукоять -->
  <rect x="45" y="55" width="10" height="15" 
        fill="#8B4513" 
        stroke="#654321" 
        stroke-width="1"/>
  
  <!-- Тетива -->
  <line x1="20" y1="50" x2="80" y2="50" 
        stroke="#F5F5DC" 
        stroke-width="1"/>
  
  <!-- Болт -->
  <line x1="25" y1="50" x2="75" y2="50" 
        stroke="#8B4513" 
        stroke-width="2"/>
</svg>
EOF

# Праща
cat > sling.svg << 'EOF'
<svg width="100" height="100" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="slingGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#8B4513;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#654321;stop-opacity:1" />
    </linearGradient>
  </defs>
  
  <!-- Ремни пращи -->
  <path d="M30 40 Q50 60 70 40" 
        fill="none" 
        stroke="url(#slingGradient)" 
        stroke-width="2"/>
  
  <!-- Петля для руки -->
  <ellipse cx="50" cy="70" rx="8" ry="3" 
           fill="url(#slingGradient)" 
           stroke="#654321" 
           stroke-width="1"/>
  
  <!-- Камень -->
  <circle cx="50" cy="45" r="5" 
          fill="#696969" 
          stroke="#2F4F4F" 
          stroke-width="1"/>
</svg>
EOF

echo "Изображения оружия созданы!"
