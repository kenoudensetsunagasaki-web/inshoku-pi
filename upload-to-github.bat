@echo off
cd /d "%~dp0"

echo ================================
echo  Uploading inshoku-pi to GitHub
echo ================================
echo.

git --version >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Git is not installed on this PC.
  echo Please install it from https://git-scm.com/ then run this file again.
  pause
  exit /b 1
)

git config --get user.email >nul 2>&1
if errorlevel 1 (
  echo Setting up Git for the first time...
  git config --global user.name "Akinori"
  git config --global user.email "akinori@example.com"
)

echo [1/6] git init
git init

echo [2/6] git add .
git add .

echo [3/6] git commit
git commit -m "first commit"

echo [4/6] git branch -M main
git branch -M main

echo [5/6] set remote repository
git remote remove origin >nul 2>&1
git remote add origin https://github.com/kenoudensetsunagasaki-web/inshoku-pi.git

echo [6/6] git push
git push -u origin main

echo.
echo ================================
echo  Done. Check the messages above for errors.
echo ================================
pause
