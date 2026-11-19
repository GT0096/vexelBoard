!include "LogicLib.nsh"
!include "WinMessages.nsh"
!include "nsDialogs.nsh"

!ifndef BUILD_UNINSTALLER
  Var vbMaintDialog
  Var vbMaintLabel
  Var vbMaintRadioUpdate
  Var vbMaintRadioUninstall
  Var vbMaintUpdateDesc
  Var vbMaintUninstallDesc
  Var vbExistingVersion
  Var vbExistingInstallDir
  Var vbExistingUninstallExe
  Var vbExistingIsAllUsers
  Var vbChoseUpdate

  !macro customInstallMode
    ; When updating an existing installation, preserve its original per-user / all-users scope automatically
    ${If} $vbChoseUpdate == "1"
      ${If} $vbExistingIsAllUsers == "1"
        StrCpy $isForceMachineInstall "1"
      ${Else}
        StrCpy $isForceCurrentInstall "1"
      ${EndIf}
    ${EndIf}
  !macroend

  !macro customWelcomePage
    PageEx custom
      PageCallbacks vbMaintenancePageCreate vbMaintenancePageLeave
      Caption " "
    PageExEnd

    Function vbMaintenancePageCreate
      ; Skip maintenance prompt during elevated UAC child run or silent updates
      ${If} ${UAC_IsInnerInstance}
      ${OrIf} ${Silent}
        Abort
      ${EndIf}

      StrCpy $vbExistingInstallDir ""
      StrCpy $vbExistingVersion ""
      StrCpy $vbExistingUninstallExe ""
      StrCpy $vbExistingIsAllUsers "0"
      StrCpy $vbChoseUpdate "0"

      ${If} $hasPerUserInstallation == "1"
      ${AndIf} $perUserInstallationFolder != ""
        StrCpy $vbExistingInstallDir "$perUserInstallationFolder"
        StrCpy $vbExistingIsAllUsers "0"
        ReadRegStr $vbExistingVersion HKCU "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
      ${ElseIf} $hasPerMachineInstallation == "1"
      ${AndIf} $perMachineInstallationFolder != ""
        StrCpy $vbExistingInstallDir "$perMachineInstallationFolder"
        StrCpy $vbExistingIsAllUsers "1"
        ReadRegStr $vbExistingVersion HKLM "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
      ${EndIf}

      ; Fresh installation — skip maintenance page and go straight to install flow
      ${If} $vbExistingInstallDir == ""
        Abort
      ${EndIf}

      StrCpy $vbExistingUninstallExe "$vbExistingInstallDir\${UNINSTALL_FILENAME}"

      !insertmacro MUI_HEADER_TEXT "Vexelboard is Already Installed" "Choose whether to update to v${VERSION} or uninstall Vexelboard."

      nsDialogs::Create 1018
      Pop $vbMaintDialog
      ${If} $vbMaintDialog == error
        Abort
      ${EndIf}

      ${If} $vbExistingVersion != ""
        ${NSD_CreateLabel} 0 4u 100% 38u "Vexelboard v$vbExistingVersion is already installed on this computer.$\r$\nLocation: $vbExistingInstallDir$\r$\n$\r$\nSelect an action below and click Next:"
      ${Else}
        ${NSD_CreateLabel} 0 4u 100% 38u "An existing Vexelboard installation was found at:$\r$\n$vbExistingInstallDir$\r$\n$\r$\nSelect an action below and click Next:"
      ${EndIf}
      Pop $vbMaintLabel

      ${NSD_CreateRadioButton} 8u 50u 95% 14u "Update / Reinstall Vexelboard to v${VERSION} (Recommended)"
      Pop $vbMaintRadioUpdate
      ${NSD_Check} $vbMaintRadioUpdate

      ${NSD_CreateLabel} 20u 65u 90% 22u "Updates the application to v${VERSION} in place while keeping your projects, boards, chat history, and local Knowledge Studio data."
      Pop $vbMaintUpdateDesc

      ${NSD_CreateRadioButton} 8u 94u 95% 14u "Uninstall Vexelboard from this computer"
      Pop $vbMaintRadioUninstall

      ${NSD_CreateLabel} 20u 109u 90% 22u "Removes Vexelboard and its desktop/Start Menu shortcuts using the installed uninstaller."
      Pop $vbMaintUninstallDesc

      ${IfNot} ${FileExists} "$vbExistingUninstallExe"
        EnableWindow $vbMaintRadioUninstall 0
      ${EndIf}

      nsDialogs::Show
    FunctionEnd

    Function vbMaintenancePageLeave
      ${NSD_GetState} $vbMaintRadioUninstall $0
      ${If} $0 == ${BST_CHECKED}
        ${If} ${FileExists} "$vbExistingUninstallExe"
          ${If} $vbExistingIsAllUsers == "1"
            ExecShell "runas" "$vbExistingUninstallExe"
          ${Else}
            Exec '"$vbExistingUninstallExe"'
          ${EndIf}
          Quit
        ${Else}
          MessageBox MB_OK|MB_ICONEXCLAMATION "Could not find the uninstaller at $vbExistingUninstallExe. Please uninstall Vexelboard via Windows Settings -> Apps."
          Abort
        ${EndIf}
      ${Else}
        ; Preserve existing scope & install directory so the upgrade updates cleanly in place
        StrCpy $vbChoseUpdate "1"
        ${If} $vbExistingInstallDir != ""
          StrCpy $INSTDIR "$vbExistingInstallDir"
        ${EndIf}
      ${EndIf}
    FunctionEnd
  !macroend

  ; Case-insensitive substring check:
  ; Push <haystack> ; Push <needle> ; Call vbStrContains ; Pop <out: "1" or "">
  Function vbStrContains
    Exch $R1 ; needle
    Exch 1
    Exch $R0 ; haystack
    Push $R2
    Push $R3
    Push $R4
    Push $R5
    Push $R6

    StrCpy $R6 ""
    StrLen $R2 $R1
    StrLen $R3 $R0
    StrCpy $R4 0

    ${If} $R2 > 0
    ${AndIf} $R3 >= $R2
      loop_contains:
        StrCpy $R5 $R0 $R2 $R4
        StrCmp $R5 $R1 found_contains
        IntOp $R4 $R4 + 1
        IntOp $R5 $R4 + $R2
        ${If} $R5 <= $R3
          Goto loop_contains
        ${EndIf}
    ${EndIf}
    Goto done_contains

    found_contains:
      StrCpy $R6 "1"

    done_contains:
    StrCpy $R1 $R6
    Pop $R6
    Pop $R5
    Pop $R4
    Pop $R3
    Pop $R2
    Pop $R0
    Exch $R1
  FunctionEnd

  !macro customInstall
    ; Register Vexelboard in Windows App Paths so Start/Search and Win+R resolve it immediately
    WriteRegStr SHELL_CONTEXT "Software\Microsoft\Windows\CurrentVersion\App Paths\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    WriteRegStr SHELL_CONTEXT "Software\Microsoft\Windows\CurrentVersion\App Paths\${APP_EXECUTABLE_FILENAME}" "Path" "$INSTDIR"

    ; Add $INSTDIR to Windows PATH (HKLM for all-users install, HKCU for per-user install)
    ${If} $installMode == "all"
      ReadRegStr $0 HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path"
    ${Else}
      ReadRegStr $0 HKCU "Environment" "Path"
    ${EndIf}

    Push ";$0;"
    Push ";$INSTDIR;"
    Call vbStrContains
    Pop $1

    ${If} $1 == ""
      ${If} $0 == ""
        StrCpy $0 "$INSTDIR"
      ${Else}
        StrCpy $0 "$0;$INSTDIR"
      ${EndIf}

      ${If} $installMode == "all"
        WriteRegExpandStr HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path" "$0"
      ${Else}
        WriteRegExpandStr HKCU "Environment" "Path" "$0"
      ${EndIf}
      SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=3000
    ${EndIf}

    ; Notify Windows Shell / Start Menu index immediately
    System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
  !macroend
!endif

!ifdef BUILD_UNINSTALLER
  ; Remove an exact ;-delimited path entry from PATH:
  ; Push <path> ; Push <entry> ; Call un.vbRemoveFromPath ; Pop <newPath>
  Function un.vbRemoveFromPath
    Exch $R1 ; entry to remove
    Exch 1
    Exch $R0 ; existing PATH
    Push $R2
    Push $R3
    Push $R4
    Push $R5
    Push $R6

    StrCpy $R2 "" ; result
    StrCpy $R3 "" ; current token
    StrLen $R4 $R0
    StrCpy $R5 0

    loop_split:
      ${If} $R5 >= $R4
        Goto flush_last
      ${EndIf}
      StrCpy $R6 $R0 1 $R5
      IntOp $R5 $R5 + 1
      StrCmp $R6 ";" 0 append_char
        ${If} $R3 != ""
          StrCmp $R3 $R1 skip_token
            ${If} $R2 == ""
              StrCpy $R2 $R3
            ${Else}
              StrCpy $R2 "$R2;$R3"
            ${EndIf}
          skip_token:
          StrCpy $R3 ""
        ${EndIf}
        Goto loop_split
      append_char:
        StrCpy $R3 "$R3$R6"
        Goto loop_split

    flush_last:
      ${If} $R3 != ""
        StrCmp $R3 $R1 done_split
          ${If} $R2 == ""
            StrCpy $R2 $R3
          ${Else}
            StrCpy $R2 "$R2;$R3"
          ${EndIf}
      ${EndIf}

    done_split:
    StrCpy $R1 $R2
    Pop $R6
    Pop $R5
    Pop $R4
    Pop $R3
    Pop $R2
    Pop $R0
    Exch $R1
  FunctionEnd

  !macro customUnInstall
    DeleteRegKey SHELL_CONTEXT "Software\Microsoft\Windows\CurrentVersion\App Paths\${APP_EXECUTABLE_FILENAME}"

    ${If} $installMode == "all"
      ReadRegStr $0 HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path"
    ${Else}
      ReadRegStr $0 HKCU "Environment" "Path"
    ${EndIf}

    ${If} $0 != ""
      Push "$0"
      Push "$INSTDIR"
      Call un.vbRemoveFromPath
      Pop $1

      ${If} $1 != $0
        ${If} $installMode == "all"
          WriteRegExpandStr HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path" "$1"
        ${Else}
          WriteRegExpandStr HKCU "Environment" "Path" "$1"
        ${EndIf}
        SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=3000
      ${EndIf}
    ${EndIf}
  !macroend
!endif
