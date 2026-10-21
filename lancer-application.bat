@echo off
title Livre de recettes d'Anne
echo ========================================================
echo   Lancement du Livre de recettes d'Anne...
echo ========================================================
echo.
start /b powershell -ExecutionPolicy Bypass -File "%~dp0server.ps1"
timeout /t 1 >nul
start http://localhost:8080
echo Application ouverte sur http://localhost:8080 !
echo (Laissez cette fenetre ouverte pendant l'utilisation)
echo.
