# Настройка Git репозитория

## 1. Инициализация Git

```bash
git init
git add .
git commit -m "Initial commit: DnD Cards Generator MVP"
```

## 2. Создание репозитория на GitHub

1. Перейдите на https://github.com
2. Нажмите "New repository"
3. Название: `dnd-cards-generator`
4. Описание: `DnD Cards Generator - сервис для создания карточек предметов`
5. Выберите "Public" или "Private"
6. НЕ ставьте галочки (README, .gitignore, license)
7. Нажмите "Create repository"

## 3. Подключение к удаленному репозиторию

```bash
git remote add origin https://github.com/YOUR_USERNAME/dnd-cards-generator.git
git branch -M main
git push -u origin main
```

## 4. Проверка загрузки

Перейдите на страницу репозитория и убедитесь, что все файлы загружены.

## 5. Клонирование на MacOS

```bash
git clone https://github.com/YOUR_USERNAME/dnd-cards-generator.git
cd dnd-cards-generator
```

## Структура файлов для загрузки

```
dnd_cards/
├── backend/
│   ├── main.go
│   ├── models.go
│   ├── controller.go
│   ├── go.mod
│   ├── go.sum
│   ├── Dockerfile
│   ├── .dockerignore
│   ├── .env
│   └── README.md
├── frontend/
│   ├── src/
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   ├── Dockerfile
│   ├── .dockerignore
│   └── README.md
├── database/
│   └── schema.sql
├── docker-compose.yml
├── start.sh
├── stop.sh
├── start.ps1
├── start.bat
├── rebuild.bat
├── run.bat
├── .gitignore
├── README.md
└── GIT_SETUP.md
```
