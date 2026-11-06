@echo off
rem Compile audiotap.exe (le son dune seule application pour la WATCHPARTY) avec Visual Studio Build Tools.
rem Le .exe est garde dans le depot (bin\audiotap.exe) : la publication de lapplication lembarque sans compiler.
setlocal
rem Le chemin de vswhere dans une variable : les parentheses de (x86) couperaient le bloc du for.
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
for /f "usebackq tokens=*" %%i in (`"%VSWHERE%" -latest -products * -property installationPath`) do set "VS=%%i"
if not defined VS (echo Visual Studio Build Tools introuvable & exit /b 1)
call "%VS%\VC\Auxiliary\Build\vcvars64.bat" >nul || exit /b 1
cd /d "%~dp0"
if not exist bin mkdir bin
cl /nologo /EHsc /O2 /std:c++17 /W4 /DUNICODE /D_UNICODE audiotap.cpp /Fobin\ /Febin\audiotap.exe /link /SUBSYSTEM:CONSOLE || exit /b 1
del bin\audiotap.obj 2>nul
echo bin\audiotap.exe
