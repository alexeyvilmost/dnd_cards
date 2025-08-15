@echo off
echo Starting DnD Cards Generator...

echo Building and starting containers...
docker compose up --build -d

echo Waiting for services to start...
timeout /t 10 /nobreak > nul

echo Project started!
echo.
echo Available services:
echo    Frontend: http://localhost:3000
echo    Backend API: http://localhost:8080
echo    PostgreSQL: localhost:5432
echo.
echo Useful commands:
echo    View logs: docker compose logs -f
echo    Stop: docker compose down
echo    Restart: docker compose restart
echo.
echo Open http://localhost:3000 in your browser
pause
