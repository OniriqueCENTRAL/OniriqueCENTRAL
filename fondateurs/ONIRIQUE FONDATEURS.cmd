@echo off
rem Ouvre ONIRIQUE FONDATEURS avec l'Electron déjà installé pour l'application (cd app ^&^& npm install, une fois).
start "" "%~dp0..\app\node_modules\electron\dist\electron.exe" "%~dp0."
