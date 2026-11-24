@echo off
setlocal
pushd "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  call npm.cmd ci
  if errorlevel 1 goto failed
)
call npm.cmd run runtime
if errorlevel 1 goto failed
call npm.cmd run build
if errorlevel 1 goto failed
call npm.cmd run build:suite-runtime
if errorlevel 1 goto failed
set ELECTRON_RUN_AS_NODE=
node "%~dp0electron-built\SuiteLauncher.cjs" %*
if errorlevel 1 goto failed
popd
exit /b 0
:failed
echo Yuzread could not build. See the error above.
pause
popd
exit /b 1
