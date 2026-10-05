@echo off
setlocal
pushd "%~dp0.." || exit /b 1
node scripts\testing\run.mjs %*
set "suite_exit_code=%ERRORLEVEL%"
popd
exit /b %suite_exit_code%
