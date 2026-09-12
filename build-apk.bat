@echo off
echo Building Android Release APK locally...
set "JAVA_HOME=C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot"
set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
cd /d "%~dp0frontend\android"
call gradlew.bat assembleRelease
if %ERRORLEVEL% equ 0 (
    copy /y "app\build\outputs\apk\release\app-release.apk" "%~dp0TDSC-Office-Manager.apk"
    echo.
    echo ========================================================
    echo SUCCESS: APK generated at %~dp0TDSC-Office-Manager.apk
    echo ========================================================
) else (
    echo.
    echo Build failed. Check errors above.
)
pause
