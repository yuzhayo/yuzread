@echo off
setlocal
pushd "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  call npm.cmd ci
  if errorlevel 1 goto failed
)
call npm.cmd run build
if errorlevel 1 goto failed
call npm.cmd run build:suite-runtime
if errorlevel 1 goto failed
set ELECTRON_RUN_AS_NODE=
start "" "%~dp0.runtime\suite-runtime\yuzread-downloader.exe" "%~dp0." %*
popd
exit /b 0
:failed
echo yuzread-downloader could not start. See the error above.
pause
popd
exit /b 1
