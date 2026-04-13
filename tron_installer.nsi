; TRON QA Suite — NSIS installer (manual build path)
;
; Prerequisites (run from repo root G:\TronUI-RN):
;   1. npm run build
;   2. pyinstaller --noconfirm tron.spec   (dist\tron_engine — NSIS overlay bhi isi se)
;   3. npx electron-builder --win --dir
;      Agar release\win-unpacked lock ho (app.asar), alternate output:
;      npx electron-builder --win --dir --config.directories.output=release_eb
;      phir: makensis /DTRON_PACK_DIR=release_eb tron_installer.nsi
;   4. makensis tron_installer.nsi
;
; Output: TRONSetup-v3.exe (repo root)
; Requires: {TRON_PACK_DIR}\win-unpacked\ from electron-builder --dir

!include "MUI2.nsh"

!ifndef TRON_PACK_DIR
  !define TRON_PACK_DIR "release"
!endif

!define APP_NAME "TRONQA"
!define APP_DISPLAY_NAME "TRON QA Suite"
!define APP_VERSION "v3"
!define MAIN_EXE "TRON QA Suite.exe"

Name "${APP_DISPLAY_NAME}"
OutFile "TRONSetup-v3.exe"
Icon "branding\tron-app.ico"
UninstallIcon "branding\tron-app.ico"
InstallDir "$PROGRAMFILES64\TRON QA Suite"
InstallDirRegKey HKLM "Software\${APP_NAME}" "InstallDir"
BrandingText "${APP_DISPLAY_NAME} ${APP_VERSION}"

ShowInstDetails show
ShowUninstDetails show

!define MUI_ICON "branding\tron-app.ico"
!define MUI_UNICON "branding\tron-app.ico"
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_BITMAP "branding\tron-header.bmp"
!define MUI_WELCOMEFINISHPAGE_BITMAP "branding\tron-sidebar.bmp"
!define MUI_ABORTWARNING

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "LICENSE.txt"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\${MAIN_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Launch ${APP_DISPLAY_NAME}"
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_WELCOME
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH

!insertmacro MUI_LANGUAGE "English"

Section "Install"
  SetOutPath "$INSTDIR"
  File /r "${TRON_PACK_DIR}\win-unpacked\*.*"
  File "branding\tron-app.ico"

  ; App exe icon embedded at build time (scripts/afterPack.js + rcedit), not here

  ; Guarantee PyInstaller onedir under resources\pyengine (Program Files copy)
  SetOutPath "$INSTDIR\resources\pyengine"
  File /r "dist\tron_engine\*.*"

  SetOutPath "$INSTDIR"
  ; Unique id per install — app compares with %APPDATA% to drop old URLs/reports on fresh install.
  ExecWait `powershell -NoProfile -ExecutionPolicy Bypass -Command "[guid]::NewGuid().ToString() | Set-Content -LiteralPath '$INSTDIR\.tron_install_uid' -Encoding ascii -NoNewline"` $0

  WriteUninstaller "$INSTDIR\Uninstall.exe"

  WriteRegStr HKLM "Software\${APP_NAME}" "InstallDir" "$INSTDIR"

  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "DisplayName" "${APP_DISPLAY_NAME}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "DisplayIcon" "$INSTDIR\tron-app.ico"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "Publisher" "Systemset Co."
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "DisplayVersion" "${APP_VERSION}"
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "NoModify" 1
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "NoRepair" 1

  CreateDirectory "$SMPROGRAMS\${APP_DISPLAY_NAME}"
  CreateShortcut "$SMPROGRAMS\${APP_DISPLAY_NAME}\${APP_DISPLAY_NAME}.lnk" "$INSTDIR\${MAIN_EXE}" "" "$INSTDIR\tron-app.ico" 0
  CreateShortcut "$DESKTOP\${APP_DISPLAY_NAME}.lnk" "$INSTDIR\${MAIN_EXE}" "" "$INSTDIR\tron-app.ico" 0
SectionEnd

Section "Uninstall"
  RMDir /r "$INSTDIR"

  Delete "$SMPROGRAMS\${APP_DISPLAY_NAME}\${APP_DISPLAY_NAME}.lnk"
  RMDir "$SMPROGRAMS\${APP_DISPLAY_NAME}"
  Delete "$DESKTOP\${APP_DISPLAY_NAME}.lnk"

  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}"
  DeleteRegKey HKLM "Software\${APP_NAME}"
SectionEnd
