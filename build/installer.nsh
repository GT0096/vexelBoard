!include "LogicLib.nsh"
!include "WinMessages.nsh"

!ifndef BUILD_UNINSTALLER
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
