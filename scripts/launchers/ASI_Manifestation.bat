@echo off
setlocal
title ASI Manifestation
set "PROJECTDIR=%~dp0..\.."
cd /d "%PROJECTDIR%"
powershell.exe -ExecutionPolicy Bypass -File "scripts\launchers\launch-desktop-stack.ps1"
