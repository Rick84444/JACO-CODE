Unicode true
ManifestDPIAware true
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetDatablockOptimize on

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "Sections.nsh"
!include "WinVer.nsh"
!include "${OPTIONS}"

Name "JACO"
OutFile "${OUTPUT_FILE}"
InstallDir "$LOCALAPPDATA\Programs\JACO"
BrandingText "JACO"
VIProductVersion "${FILE_VERSION}"
VIAddVersionKey /LANG=1033 "ProductName" "JACO"
VIAddVersionKey /LANG=1033 "FileDescription" "JACO Setup"
VIAddVersionKey /LANG=1033 "ProductVersion" "${PRODUCT_VERSION}"
VIAddVersionKey /LANG=1033 "FileVersion" "${PRODUCT_VERSION}"
VIAddVersionKey /LANG=1033 "LegalCopyright" "JACO contributors"

!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Install JACO"
!define MUI_WELCOMEPAGE_TEXT "Install JACO ${PRODUCT_VERSION} for your Windows account.$\r$\n$\r$\nYour workspace and credentials stay separate from the application. You choose model providers and tool permissions in the setup guide after installation.$\r$\n$\r$\nAdministrator access is not required."
!define MUI_LICENSEPAGE_CHECKBOX
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_FUNCTION "LaunchJaco"
!define MUI_FINISHPAGE_RUN_TEXT "Open JACO and review connection settings"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${LICENSE_FILE}"
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "Swedish"

Var PayloadPath
Var NativeMachine

Function .onInit
  SetShellVarContext current
  StrCpy $LANGUAGE ${LANG_ENGLISH}
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_OK|MB_ICONSTOP "JACO requires 64-bit Windows 10 or newer."
    Abort
  ${EndIf}
  ; IsWow64Process2 returns the native architecture, independent of this 32-bit setup process.
  System::Call 'kernel32::GetCurrentProcess() p .r0'
  System::Call 'kernel32::IsWow64Process2(p r0, *i .r1, *i .r2) i .r3'
  ; The API writes a USHORT; ignore the unused upper half of the System plug-in's integer buffer.
  IntOp $NativeMachine $2 & 0xffff
  !if "${TARGET_ARCH}" == "x64"
    StrCmp $NativeMachine 34404 architectureOK
  !else
    StrCmp $NativeMachine 43620 architectureOK
  !endif
  MessageBox MB_OK|MB_ICONSTOP "This JACO installer is for Windows ${TARGET_ARCH}. Download the installer for your computer's architecture."
  Abort
  architectureOK:
  IfSilent silentConsent interactive
  silentConsent:
    ${GetParameters} $0
    ${GetOptions} $0 "/ACCEPT=" $1
    StrCmp $1 "1" interactive
    SetErrorLevel 2
    Abort
  interactive:
  Call PreserveOptions
FunctionEnd

Section "JACO application (required)" MainSection
  SectionIn RO
  SetShellVarContext current
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  ; The activation helper runs outside the pending payload so Windows can rename that directory.
  File /oname=node.exe "${NODE_EXECUTABLE}"
  File /oname=install-state.mjs "${INSTALL_STATE_FILE}"
  SetOutPath "$INSTDIR"
  IfFileExists "$INSTDIR\versions\${BUILD_ID}\installer-manifest.json" reusePayload
    StrCpy $PayloadPath "$INSTDIR\versions\.pending-${BUILD_ID}"
    RMDir /r "$PayloadPath"
    SetOutPath "$PayloadPath"
    File /r "${PAYLOAD_DIR}/*"
    Goto activatePayload
  reusePayload:
    StrCpy $PayloadPath "$INSTDIR\versions\${BUILD_ID}"
  activatePayload:
    SetOutPath "$INSTDIR"
    ClearErrors
    ExecWait '"$PLUGINSDIR\node.exe" "$PLUGINSDIR\install-state.mjs" activate "$INSTDIR" "$PayloadPath"' $0
    IfErrors failedActivation
    StrCmp $0 0 payloadActivated
    StrCmp $0 10 runtimeRunning failedActivation
  runtimeRunning:
    IfSilent failedActivation
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "JACO is running or still starting. Use Stop JACO in the Start menu, then choose Retry. Your current installation has been kept." IDRETRY activatePayload
    Abort
  failedActivation:
    MessageBox MB_OK|MB_ICONSTOP "Setup could not verify or activate this build. Your previous installation and data have been kept. Details: $INSTDIR\setup-error.txt"
    SetErrorLevel 1
    Abort
  payloadActivated:
    SetOutPath "$INSTDIR"
    File /oname=launch.vbs "${LAUNCHER_FILE}"
    WriteUninstaller "$INSTDIR\Uninstall JACO.exe"
    CreateDirectory "$SMPROGRAMS\JACO"
    CreateShortCut "$SMPROGRAMS\JACO\JACO.lnk" "$SYSDIR\wscript.exe" '"$INSTDIR\launch.vbs"'
    CreateShortCut "$SMPROGRAMS\JACO\Stop JACO.lnk" "$SYSDIR\wscript.exe" '"$INSTDIR\launch.vbs" --stop'
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\JACO" "DisplayName" "JACO"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\JACO" "DisplayVersion" "${PRODUCT_VERSION}"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\JACO" "Publisher" "JACO contributors"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\JACO" "InstallLocation" "$INSTDIR"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\JACO" "UninstallString" '$\"$INSTDIR\Uninstall JACO.exe$\"'
    WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\JACO" "NoModify" 1
    WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\JACO" "NoRepair" 1
SectionEnd

Section "Desktop shortcut" DesktopShortcut
  CreateShortCut "$DESKTOP\JACO.lnk" "$SYSDIR\wscript.exe" '"$INSTDIR\launch.vbs"'
SectionEnd

Section /o "Launch at Windows sign-in" LoginStartup
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "JACO" '$\"$SYSDIR\wscript.exe$\" $\"$INSTDIR\launch.vbs$\"'
SectionEnd

Section -RemoveUnselectedOptions
  ${IfNot} ${SectionIsSelected} ${DesktopShortcut}
    Delete "$DESKTOP\JACO.lnk"
  ${EndIf}
  ${IfNot} ${SectionIsSelected} ${LoginStartup}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "JACO"
  ${EndIf}
SectionEnd

Function LaunchJaco
  Exec '"$SYSDIR\wscript.exe" "$INSTDIR\launch.vbs"'
FunctionEnd

Function PreserveOptions
  ; Retain the operator's shortcut/startup choices when updating an existing installation.
  IfFileExists "$INSTDIR\current.json" existingOptions newInstallation
  existingOptions:
    IfFileExists "$DESKTOP\JACO.lnk" desktopDone
      SectionGetFlags ${DesktopShortcut} $0
      IntOp $0 $0 & ~${SF_SELECTED}
      SectionSetFlags ${DesktopShortcut} $0
    desktopDone:
    ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "JACO"
    StrCmp $0 '$\"$SYSDIR\wscript.exe$\" $\"$INSTDIR\launch.vbs$\"' 0 newInstallation
      SectionGetFlags ${LoginStartup} $0
      IntOp $0 $0 | ${SF_SELECTED}
      SectionSetFlags ${LoginStartup} $0
  newInstallation:
FunctionEnd

Function un.onInit
  SetShellVarContext current
  StrCmp $INSTDIR "$LOCALAPPDATA\Programs\JACO" validLocation
  MessageBox MB_OK|MB_ICONSTOP "The uninstall location is invalid. Run JACO Setup again to repair the installation."
  Abort
  validLocation:
FunctionEnd

Section "Uninstall"
  SetShellVarContext current
  IfFileExists "$INSTDIR\versions\${BUILD_ID}\install-state.mjs" prepareUninstall
    MessageBox MB_OK|MB_ICONSTOP "JACO's installation files are missing. Run Setup again before uninstalling. Your data has been kept."
    SetErrorLevel 1
    Abort
  prepareUninstall:
    ExecWait '"$INSTDIR\versions\${BUILD_ID}\node\node.exe" "$INSTDIR\versions\${BUILD_ID}\install-state.mjs" prepare-uninstall "$INSTDIR"' $0
    StrCmp $0 0 removeApplication
    IfSilent uninstallFailed
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "JACO has not stopped yet. Wait for startup or stop it from the Start menu, then choose Retry." IDRETRY prepareUninstall
  uninstallFailed:
    SetErrorLevel 1
    Abort
  removeApplication:
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\JACO"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "JACO"
    Delete "$DESKTOP\JACO.lnk"
    Delete "$SMPROGRAMS\JACO\JACO.lnk"
    Delete "$SMPROGRAMS\JACO\Stop JACO.lnk"
    RMDir "$SMPROGRAMS\JACO"
    RMDir /r "$INSTDIR\versions"
    Delete "$INSTDIR\current.json"
    Delete "$INSTDIR\setup-error.txt"
    Delete "$INSTDIR\launch.vbs"
    Delete "$INSTDIR\Uninstall JACO.exe"
    RMDir "$INSTDIR"
    ; Deliberately retain $LOCALAPPDATA\JACO (workspace, provider credentials and activity).
SectionEnd
