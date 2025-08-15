@echo off
echo Stopping containers...
docker compose down

echo Removing old images...
docker compose down --rmi all

echo Building and starting containers...
docker compose up --build -d

echo Waiting for services to start...
timeout /t 15 /nobreak > nul

echo Checking container status...
docker compose ps

echo Opening browser...
start http://localhost:3000

echo Done!
pause
