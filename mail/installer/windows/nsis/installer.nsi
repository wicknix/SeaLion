# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

# Required Plugins:
# AppAssocReg    http://nsis.sourceforge.net/Application_Association_Registration_plug-in
# ApplicationID  http://nsis.sourceforge.net/ApplicationID_plug-in
# CityHash       http://mxr.mozilla.org/mozilla-central/source/other-licenses/nsis/Contrib/CityHash
# ShellLink      http://nsis.sourceforge.net/ShellLink_plug-in
# UAC            http://nsis.sourceforge.net/UAC_plug-in
# ServicesHelper Binary Outcast specific plugin that is located in /other-licenses/nsis

; Set verbosity to 3 (e.g. no script) to lessen the noise in the build logs
!verbose 3

; 7-Zip provides better compression than the lzma from NSIS so we add the files
; uncompressed and use 7-Zip to create a SFX archive of it
SetDatablockOptimize on
SetCompress off
CRCCheck on

RequestExecutionLevel user

; The commands inside this ifdef require NSIS 3.0a2 or greater so the ifdef can
; be removed after we require NSIS 3.0a2 or greater.
!ifdef NSIS_PACKEDVERSION
  Unicode true
  ManifestSupportedOS all
  ManifestDPIAware true
!endif

!addplugindir ./

Var TmpVal
Var InstallType
Var AddStartMenuSC
Var AddTaskbarSC
Var AddQuickLaunchSC
Var AddDesktopSC
Var InstallMaintenanceService
Var PageName

; By defining NO_STARTMENU_DIR an installer that doesn't provide an option for
; an application's Start Menu PROGRAMS directory and doesn't define the
; StartMenuDir variable can use the common InstallOnInitCommon macro.
!define NO_STARTMENU_DIR

; On Vista and above attempt to elevate Standard Users in addition to users that
; are a member of the Administrators group.
!define NONADMIN_ELEVATE

; Disabled until a survey url is provided
!define AbortSurveyURL "http://live.mozillamessaging.com/survey/cancel/?page="

; Other included files may depend upon these includes!
; The following includes are provided by NSIS.
!include FileFunc.nsh
!include LogicLib.nsh
!include MUI.nsh
!include WinMessages.nsh
!include WinVer.nsh
!include WordFunc.nsh

!insertmacro GetOptions
!insertmacro GetParameters
!insertmacro GetSize
!insertmacro WordFind

; The following includes are custom.
!include branding.nsi
!include defines.nsi
!include common.nsh
!include locales.nsi

VIAddVersionKey "FileDescription"  "${BrandShortName} Installer"
VIAddVersionKey "OriginalFilename" "setup.exe"

; Must be inserted before other macros that use logging
!insertmacro _LoggingCommon

!insertmacro AddHandlerValues
!insertmacro ChangeMUIHeaderImage
!insertmacro CheckForFilesInUse
!insertmacro CleanUpdatesDir
!insertmacro CopyFilesFromDir
!insertmacro GetPathFromString
!insertmacro GetParent
!insertmacro InitHashAppModelId
!insertmacro IsHandlerForInstallDir
!insertmacro IsPinnedToTaskBar
!insertmacro IsUserAdmin
!insertmacro LogDesktopShortcut
!insertmacro LogQuickLaunchShortcut
!insertmacro LogStartMenuShortcut
!insertmacro ManualCloseAppPrompt
!insertmacro PinnedToStartMenuLnkCount
!insertmacro RegCleanMain
!insertmacro RegCleanUninstall
!insertmacro SetBrandNameVars
!insertmacro UpdateShortcutAppModelIDs
!insertmacro UnloadUAC
!insertmacro WriteRegStr2
!insertmacro WriteRegDWORD2

!include shared.nsh

; Helper macros for ui callbacks. Insert these after shared.nsh
!insertmacro CheckCustomCommon
!insertmacro InstallEndCleanupCommon
!insertmacro InstallOnInitCommon
!insertmacro InstallStartCleanupCommon
!insertmacro LeaveDirectoryCommon
!insertmacro LeaveOptionsCommon
!insertmacro OnEndCommon
!insertmacro PreDirectoryCommon

Name "${BrandFullName}"
OutFile "setup.exe"
!ifdef HAVE_64BIT_BUILD
  InstallDir "$PROGRAMFILES64\${BrandFullName}\"
!else
  InstallDir "$PROGRAMFILES32\${BrandFullName}\"
!endif
ShowInstDetails nevershow

################################################################################
# Modern User Interface - MUI

!define MOZ_MUI_CUSTOM_ABORT
!define MUI_CUSTOMFUNCTION_ABORT "CustomAbort"
!define MUI_ICON setup.ico
!define MUI_UNICON setup.ico
!define MUI_WELCOMEPAGE_TITLE_3LINES
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_RIGHT
!define MUI_WELCOMEFINISHPAGE_BITMAP wizWatermark.bmp

; Use a right to left header image when the language is right to left
!ifdef ${AB_CD}_rtl
!define MUI_HEADERIMAGE_BITMAP_RTL wizHeaderRTL.bmp
!else
!define MUI_HEADERIMAGE_BITMAP wizHeader.bmp
!endif

/**
 * Installation Pages
 */
; Welcome Page
!define MUI_PAGE_CUSTOMFUNCTION_PRE preWelcome
!insertmacro MUI_PAGE_WELCOME

; License Page
!define MUI_PAGE_CUSTOMFUNCTION_SHOW showLicense
!define MUI_LICENSEPAGE_CHECKBOX
!insertmacro MUI_PAGE_LICENSE license.txt

; Custom Options Page
Page custom preOptions leaveOptions

; Select Install Directory Page
!define MUI_PAGE_CUSTOMFUNCTION_PRE preDirectory
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE leaveDirectory
!define MUI_DIRECTORYPAGE_VERIFYONLEAVE
!insertmacro MUI_PAGE_DIRECTORY

; Custom Shortcuts Page
Page custom preShortcuts leaveShortcuts

; Custom Summary Page
Page custom preSummary leaveSummary

; Install Files Page
!insertmacro MUI_PAGE_INSTFILES

; Finish Page
!define MUI_FINISHPAGE_TITLE_3LINES
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_FUNCTION LaunchApp
!define MUI_FINISHPAGE_RUN_TEXT $(LAUNCH_TEXT)
!define MUI_PAGE_CUSTOMFUNCTION_PRE preFinish
!insertmacro MUI_PAGE_FINISH

; Use the default dialog for IDD_VERIFY for a simple Banner
ChangeUI IDD_VERIFY "${NSISDIR}\Contrib\UIs\default.exe"

################################################################################
# Install Sections

; Cleanup operations to perform at the start of the installation.
Section "-InstallStartCleanup"
  SetDetailsPrint both
  DetailPrint $(STATUS_CLEANUP)
  SetDetailsPrint none

  SetOutPath "$INSTDIR"
  ${StartInstallLog} "${BrandFullName}" "${AB_CD}" "${AppVersion}" "${GREVersion}"

  ; Delete the app exe to prevent launching the app while we are installing.
  ClearErrors
  ${DeleteFile} "$INSTDIR\${FileMainEXE}"
  ${If} ${Errors}
    ; If the user closed the application it can take several seconds for it to
    ; shut down completely. If the application is being used by another user we
    ; can rename the file and then delete is when the system is restarted.
    Sleep 5000
    ${DeleteFile} "$INSTDIR\${FileMainEXE}"
    ClearErrors
  ${EndIf}

  ; Delete two files installed by Kaspersky Anti-Spam extension that are only
  ; compatible with Interlink 2 (bug 533692).
  ${If} ${FileExists} "$INSTDIR\components\klthbplg.dll"
    Delete /REBOOTOK "$INSTDIR\components\klthbplg.dll"
  ${EndIf}
  ${If} ${FileExists} "$INSTDIR\components\IKLAntiSpam.xpt"
    Delete /REBOOTOK "$INSTDIR\components\IKLAntiSpam.xpt"
  ${EndIf}

  ; Remove the updates directory for Vista and above
  ${CleanUpdatesDir} "Interlink"

  ${GetParameters} $0
  ${GetOptions} "$0" "/INI=" $1
  ${Unless} ${Errors}
    ; The configuration file must also exist
    ${If} ${FileExists} "$1"
      ReadINIStr $0 $1 "Install" "RemoveDistributionDir"
    ${EndIf}
  ${EndUnless}

  ${If} ${FileExists} "$INSTDIR\distribution"
  ${AndIf} $0 != "false"
    RmDir /r "$INSTDIR\distribution"
  ${EndIf}

  ${InstallStartCleanupCommon}
SectionEnd

Section "-Application" APP_IDX
  ${StartUninstallLog}

  SetDetailsPrint both
  DetailPrint $(STATUS_INSTALL_APP)
  SetDetailsPrint none

  ${LogHeader} "Installing Main Files"
  ${CopyFilesFromDir} "$EXEDIR\core" "$INSTDIR" \
                      "$(ERROR_CREATE_DIRECTORY_PREFIX)" \
                      "$(ERROR_CREATE_DIRECTORY_SUFFIX)"


  ; The MAPI DLL's are copied and the copies are then registered to lessen
  ; file in use errors on application update.
  ClearErrors
  ${DeleteFile} "$INSTDIR\MapiProxy_InUse.dll"
  ${If} ${Errors}
    ; Clear the way for the new file and delete the old file on reboot
    Rename "$INSTDIR\MapiProxy_InUse.dll" "$INSTDIR\MapiProxy_InUse.dll.moz-delete"
    Delete /REBOOTOK "$INSTDIR\MapiProxy_InUse.dll.moz-delete"
  ${EndIf}
  CopyFiles /SILENT "$EXEDIR\core\MapiProxy.dll" "$INSTDIR\MapiProxy_InUse.dll"
  ${LogMsg} "Installed File: $INSTDIR\MapiProxy_InUse.dll"
  ${LogUninstall} "File: \MapiProxy_InUse.dll"

  ClearErrors
  ${DeleteFile} "$INSTDIR\mozMapi32_InUse.dll"
  ${If} ${Errors}
    ; Clear the way for the new file and delete the old file on reboot
    Rename "$INSTDIR\mozMapi32_InUse.dll" "$INSTDIR\mozMapi32_InUse.dll.moz-delete"
    Delete /REBOOTOK "$INSTDIR\mozMapi32_InUse.dll.moz-delete"
  ${EndIf}
  CopyFiles /SILENT "$EXEDIR\core\mozMapi32.dll" "$INSTDIR\mozMapi32_InUse.dll"
  ${LogMsg} "Installed File: $INSTDIR\mozMapi32_InUse.dll"
  ${LogUninstall} "File: \mozMapi32_InUse.dll"

  ; Register DLLs
  ; XXXrstrong - AccessibleMarshal.dll can be used by multiple applications but
  ; is only registered for the last application installed. When the last
  ; application installed is uninstalled AccessibleMarshal.dll will no longer be
  ; registered. bug 338878
  ${LogHeader} "DLL Registration"
  ClearErrors
  ${RegisterDLL} "$INSTDIR\AccessibleMarshal.dll"
  ${If} ${Errors}
    ${LogMsg} "** ERROR Registering: $INSTDIR\AccessibleMarshal.dll **"
  ${Else}
    ${LogUninstall} "DLLReg: \AccessibleMarshal.dll"
    ${LogMsg} "Registered: $INSTDIR\AccessibleMarshal.dll"
  ${EndIf}

  ; Write extra files created by the application to the uninstall log so they
  ; will be removed when the application is uninstalled. To remove an empty
  ; directory write a bogus filename to the deepest directory and all empty
  ; parent directories will be removed.
  ${LogUninstall} "File: \components\compreg.dat"
  ${LogUninstall} "File: \components\xpti.dat"
  ${LogUninstall} "File: \active-update.xml"
  ${LogUninstall} "File: \install.log"
  ${LogUninstall} "File: \install_status.log"
  ${LogUninstall} "File: \install_wizard.log"
  ${LogUninstall} "File: \updates.xml"

  ; Default for creating Start Menu shortcut
  ; (1 = create, 0 = don't create)
  ${If} $AddStartMenuSC == ""
    StrCpy $AddStartMenuSC "1"
  ${EndIf}

  ; Default for creating Quick Launch shortcut (1 = create, 0 = don't create)
  ${If} $AddQuickLaunchSC == ""
    ; Don't install the quick launch shortcut on Windows 7
    ${If} ${AtLeastWin7}
      StrCpy $AddQuickLaunchSC "0"
    ${Else}
      StrCpy $AddQuickLaunchSC "1"
    ${EndIf}
  ${EndIf}

  ; Default for creating Desktop shortcut (1 = create, 0 = don't create)
  ${If} $AddDesktopSC == ""
    StrCpy $AddDesktopSC "1"
  ${EndIf}

  ${LogHeader} "Adding Registry Entries"
  SetShellVarContext current  ; Set SHCTX to HKCU
  ${RegCleanMain} "Software\Binary Outcast"
  ${RegCleanUninstall}
  ${UpdateProtocolHandlers}

  ClearErrors
  WriteRegStr HKLM "Software\Binary Outcast" "${BrandShortName}InstallerTest" "Write Test"
  ${If} ${Errors}
    StrCpy $TmpVal "HKCU" ; used primarily for logging
  ${Else}
    SetShellVarContext all  ; Set SHCTX to HKLM
    DeleteRegValue HKLM "Software\Binary Outcast" "${BrandShortName}InstallerTest"
    StrCpy $TmpVal "HKLM" ; used primarily for logging
    ${RegCleanMain} "Software\Binary Outcast"
    ${RegCleanUninstall}
    ${UpdateProtocolHandlers}
  ${EndIf}

  ; setup the application model id registration value
  ${InitHashAppModelId} "$INSTDIR" "Software\Binary Outcast\${AppName}\TaskBarIDs"

  ${RemoveDeprecatedKeys}

  ; The previous installer adds several regsitry values to both HKLM and HKCU.
  ; We now try to add to HKLM and if that fails to HKCU

  ; The order that reg keys and values are added is important if you use the
  ; uninstall log to remove them on uninstall. When using the uninstall log you
  ; MUST add children first so they will be removed first on uninstall so they
  ; will be empty when the key is deleted. This allows the uninstaller to
  ; specify that only empty keys will be deleted.
  ${SetAppKeys}

  ; Uninstall keys can only exist under HKLM on some versions of windows. Since
  ; it doesn't cause problems always add them.
  ${SetUninstallKeys}

  ; On install always add the InterlinkEML, Interlink.Url.mailto, and
  ; Interlink.Url.news keys.
  ${GetLongPath} "$INSTDIR\${FileMainEXE}" $8
  StrCpy $0 "SOFTWARE\Classes"
  StrCpy $1 "$\"$8$\" $\"%1$\""
  StrCpy $2 "$\"$8$\" -osint -compose $\"%1$\""
  StrCpy $3 "$\"$8$\" -osint -mail $\"%1$\""

  ; An empty string is used for the 5th param because InterlinkEML is not a
  ; protocol handler
  ${AddHandlerValues} "$0\InterlinkEML"  "$1" "$8,0" \
                      "${AppRegNameMail} Document" "" ""
  ${AddHandlerValues} "$0\Interlink.Url.mailto"  "$2" "$8,0" \
                      "${AppRegNameMail} URL" "delete" ""
  ${AddHandlerValues} "$0\Interlink.Url.news" "$3" "$8,0" \
                      "${AppRegNameNews} URL" "delete" ""

  ; The following keys should only be set if we can write to HKLM
  ${If} $TmpVal == "HKLM"
    ; Set the Start Menu Internet and Vista Registered App HKLM registry keys.
    ${SetClientsMail}
    ${SetClientsNews}

    ; If we are writing to HKLM and create either the desktop or start menu
    ; shortcuts set IconsVisible to 1 otherwise to 0.
    ; Taskbar shortcuts imply having a start menu shortcut.
    StrCpy $0 "Software\Clients\Mail\${ClientsRegName}\InstallInfo"
    ${If} $AddDesktopSC == 1
    ${OrIf} $AddStartMenuSC == 1
    ${OrIf} $AddTaskbarSC == 1
      WriteRegDWORD HKLM "$0" "IconsVisible" 1
    ${Else}
      WriteRegDWORD HKLM "$0" "IconsVisible" 0
    ${EndIf}
  ${EndIf}

  ; These need special handling on uninstall since they may be overwritten by
  ; an install into a different location.
  StrCpy $0 "Software\Microsoft\Windows\CurrentVersion\App Paths\${FileMainEXE}"
  ${WriteRegStr2} $TmpVal "$0" "" "$INSTDIR\${FileMainEXE}" 0
  ${WriteRegStr2} $TmpVal "$0" "Path" "$INSTDIR" 0

  ; Create shortcuts
  ${LogHeader} "Adding Shortcuts"

  ; Remove the start menu shortcuts and directory if the SMPROGRAMS section
  ; exists in the shortcuts_log.ini and the SMPROGRAMS. The installer's shortcut
  ; creation code will create the shortcut in the root of the Start Menu
  ; Programs directory.
  ${RemoveStartMenuDir}

  ; Always add the application's shortcuts to the shortcuts log ini file. The
  ; DeleteShortcuts macro will do the right thing on uninstall if the
  ; shortcuts don't exist.
  ${LogStartMenuShortcut} "${BrandFullName}.lnk"
  ${LogQuickLaunchShortcut} "${BrandFullName}.lnk"
  ${LogDesktopShortcut} "${BrandFullName}.lnk"

  ; Best effort to update the Win7 taskbar and start menu shortcut app model
  ; id's. The possible contexts are current user / system and the user that
  ; elevated the installer.
  Call FixShortcutAppModelIDs
  ; If the current context is all also perform Win7 taskbar and start menu link
  ; maintenance for the current user context.
  ${If} $TmpVal == "HKLM"
    SetShellVarContext current  ; Set SHCTX to HKCU
    Call FixShortcutAppModelIDs
    SetShellVarContext all  ; Set SHCTX to HKLM
  ${EndIf}

  ; If running elevated also perform Win7 taskbar and start menu link
  ; maintenance for the unelevated user context in case that is different than
  ; the current user.
  ClearErrors
  ${GetParameters} $0
  ${GetOptions} "$0" "/UAC:" $0
  ${Unless} ${Errors}
    GetFunctionAddress $0 FixShortcutAppModelIDs
    UAC::ExecCodeSegment $0
  ${EndUnless}

  ; UAC only allows elevating to an Admin account so there is no need to add
  ; the Start Menu or Desktop shortcuts from the original unelevated process
  ; since this will either add it for the user if unelevated or All Users if
  ; elevated.
  ${If} $AddStartMenuSC == 1
    CreateShortCut "$SMPROGRAMS\${BrandFullName}.lnk" "$INSTDIR\${FileMainEXE}"
    ${If} ${FileExists} "$SMPROGRAMS\${BrandFullName}.lnk"
      ShellLink::SetShortCutWorkingDirectory "$SMPROGRAMS\${BrandFullName}.lnk" \
                                           "$INSTDIR"
      ${If} ${AtLeastWin7}
      ${AndIf} "$AppUserModelID" != ""
        ApplicationID::Set "$SMPROGRAMS\${BrandFullName}.lnk" "$AppUserModelID" "true"
      ${EndIf}
      ${LogMsg} "Added Shortcut: $SMPROGRAMS\${BrandFullName}.lnk"
    ${Else}
      ${LogMsg} "** ERROR Adding Shortcut: $SMPROGRAMS\${BrandFullName}.lnk"
    ${EndIf}
  ${EndIf}

  ; Update lastwritetime of the Start Menu shortcut to clear the tile cache.
  ${If} ${AtLeastWin8}
  ${AndIf} ${FileExists} "$SMPROGRAMS\${BrandFullName}.lnk"
    FileOpen $0 "$SMPROGRAMS\${BrandFullName}.lnk" a
    FileClose $0
  ${EndIf}

  ${If} $AddDesktopSC == 1
    CreateShortCut "$DESKTOP\${BrandFullName}.lnk" "$INSTDIR\${FileMainEXE}"
    ${If} ${FileExists} "$DESKTOP\${BrandFullName}.lnk"
      ShellLink::SetShortCutWorkingDirectory "$DESKTOP\${BrandFullName}.lnk" \
                                             "$INSTDIR"
      ${If} ${AtLeastWin7}
      ${AndIf} "$AppUserModelID" != ""
        ApplicationID::Set "$DESKTOP\${BrandFullName}.lnk" "$AppUserModelID"  "true"
      ${EndIf}
      ${LogMsg} "Added Shortcut: $DESKTOP\${BrandFullName}.lnk"
    ${Else}
      ${LogMsg} "** ERROR Adding Shortcut: $DESKTOP\${BrandFullName}.lnk"
    ${EndIf}
  ${EndIf}

  ; If elevated the Quick Launch shortcut must be added from the unelevated
  ; original process.
  ${If} $AddQuickLaunchSC == 1
    ${Unless} ${AtLeastWin7}
      ClearErrors
      ${GetParameters} $0
      ${GetOptions} "$0" "/UAC:" $0
      ${If} ${Errors}
        Call AddQuickLaunchShortcut
        ${LogMsg} "Added Shortcut: $QUICKLAUNCH\${BrandFullName}.lnk"
      ${Else}
        ; It is not possible to add a log entry from the unelevated process so
        ; add the log entry without the path since there is no simple way to
        ; know the correct full path.
        ${LogMsg} "Added Quick Launch Shortcut: ${BrandFullName}.lnk"
        GetFunctionAddress $0 AddQuickLaunchShortcut
        UAC::ExecCodeSegment $0
      ${EndIf}
    ${EndUnless}
  ${EndIf}
SectionEnd

; Cleanup operations to perform at the end of the installation.
Section "-InstallEndCleanup"
  SetDetailsPrint both
  DetailPrint "$(STATUS_CLEANUP)"
  SetDetailsPrint none

  ${Unless} ${Silent}
    ${MUI_INSTALLOPTIONS_READ} $0 "options.ini" "Field 6" "State"
    ${If} "$0" == "1"
      ${LogHeader} "Setting as the default mail application"
      ClearErrors
      ${GetParameters} $0
      ${GetOptions} "$0" "/UAC:" $0
      ${If} ${Errors}
        Call SetAsDefaultMailAppUserHKCU
      ${Else}
        GetFunctionAddress $0 SetAsDefaultMailAppUserHKCU
        UAC::ExecCodeSegment $0
      ${EndIf}
    ${EndIf}
  ${EndUnless}

  ; Adds a pinned Task Bar shortcut (see MigrateTaskBarShortcut for details).
  ${MigrateTaskBarShortcut}

  ; Refresh desktop icons
  System::Call "shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)"

  ${InstallEndCleanupCommon}

  ${If} ${RebootFlag}
    ; If we have to reboot give SHChangeNotify time to finish refreshing
    ; the icons so the OS doesn't display the icons from helper.exe
    Sleep 10000
    ${LogHeader} "Reboot Required To Finish Installation"
    ; ${FileMainEXE}.moz-upgrade should never exist but just in case...
    ${Unless} ${FileExists} "$INSTDIR\${FileMainEXE}.moz-upgrade"
      Rename "$INSTDIR\${FileMainEXE}" "$INSTDIR\${FileMainEXE}.moz-upgrade"
    ${EndUnless}

    ${If} ${FileExists} "$INSTDIR\${FileMainEXE}"
      ClearErrors
      Rename "$INSTDIR\${FileMainEXE}" "$INSTDIR\${FileMainEXE}.moz-delete"
      ${Unless} ${Errors}
        Delete /REBOOTOK "$INSTDIR\${FileMainEXE}.moz-delete"
      ${EndUnless}
    ${EndIf}

    ${Unless} ${FileExists} "$INSTDIR\${FileMainEXE}"
      CopyFiles /SILENT "$INSTDIR\uninstall\helper.exe" "$INSTDIR"
      FileOpen $0 "$INSTDIR\${FileMainEXE}" w
      FileWrite $0 "Will be deleted on restart"
      Rename /REBOOTOK "$INSTDIR\${FileMainEXE}.moz-upgrade" "$INSTDIR\${FileMainEXE}"
      FileClose $0
      Delete "$INSTDIR\${FileMainEXE}"
      Rename "$INSTDIR\helper.exe" "$INSTDIR\${FileMainEXE}"
    ${EndUnless}
  ${EndIf}
SectionEnd

################################################################################
# Install Abort Survey Functions

Function CustomAbort
!ifdef AbortSurveyURL
  ${If} "${AB_CD}" == "en-US"
  ${AndIf} "$PageName" != ""
  ${AndIf} ${FileExists} "$EXEDIR\core\distribution\distribution.ini"
    ReadINIStr $0 "$EXEDIR\core\distribution\distribution.ini" "Global" "about"
    ClearErrors
    ${WordFind} "$0" "Funnelcake" "E#" $1
   ${Unless} ${Errors}
      ; Yes = fill out the survey and exit, No = don't fill out survey and exit,
      ; Cancel = don't exit.
      MessageBox MB_YESNO|MB_ICONEXCLAMATION \
                 "Would you like to tell us why you are canceling this installation?" \
                 IDYes +1 IDNO CustomAbort_finish
      ${If} "$PageName" == "Welcome"
          GetFunctionAddress $0 AbortSurveyWelcome
      ${ElseIf} "$PageName" == "Options"
          GetFunctionAddress $0 AbortSurveyOptions
      ${ElseIf} "$PageName" == "Directory"
          GetFunctionAddress $0 AbortSurveyDirectory
      ${ElseIf} "$PageName" == "Shortcuts"
          GetFunctionAddress $0 AbortSurveyShortcuts
      ${ElseIf} "$PageName" == "Summary"
          GetFunctionAddress $0 AbortSurveySummary
      ${EndIf}
      ClearErrors
      ${GetParameters} $1
      ${GetOptions} "$1" "/UAC:" $2
      ${If} ${Errors}
        Call $0
      ${Else}
        UAC::ExecCodeSegment $0
      ${EndIf}

      CustomAbort_finish:
      Return
    ${EndUnless}
  ${EndIf}
!endif

  MessageBox MB_YESNO|MB_ICONEXCLAMATION "$(MOZ_MUI_TEXT_ABORTWARNING)" \
             IDYES +1 IDNO +2
  Return
  Abort
FunctionEnd

!ifdef AbortSurveyURL
Function AbortSurveyWelcome
  ExecShell "open" "${AbortSurveyURL}step1"
FunctionEnd

Function AbortSurveyOptions
  ExecShell "open" "${AbortSurveyURL}step2"
FunctionEnd

Function AbortSurveyDirectory
  ExecShell "open" "${AbortSurveyURL}step3"
FunctionEnd

Function AbortSurveyShortcuts
  ExecShell "open" "${AbortSurveyURL}step4"
FunctionEnd

Function AbortSurveySummary
  ExecShell "open" "${AbortSurveyURL}step5"
FunctionEnd
!endif

################################################################################
# Helper Functions

Function AddQuickLaunchShortcut
  CreateShortCut "$QUICKLAUNCH\${BrandFullName}.lnk" "$INSTDIR\${FileMainEXE}"
  ${If} ${FileExists} "$QUICKLAUNCH\${BrandFullName}.lnk"
    ShellLink::SetShortCutWorkingDirectory "$QUICKLAUNCH\${BrandFullName}.lnk" \
                                           "$INSTDIR"
  ${EndIf}
FunctionEnd

Function CheckExistingInstall
  ; If there is a pending file copy from a previous uninstall don't allow
  ; installing until after the system has rebooted.
  IfFileExists "$INSTDIR\${FileMainEXE}.moz-upgrade" +1 +4
  MessageBox MB_YESNO "$(WARN_RESTART_REQUIRED_UPGRADE)" IDNO +2
  Reboot
  Quit

  ; If there is a pending file deletion from a previous uninstall don't allow
  ; installing until after the system has rebooted.
  IfFileExists "$INSTDIR\${FileMainEXE}.moz-delete" +1 +4
  MessageBox MB_YESNO "$(WARN_RESTART_REQUIRED_UNINSTALL)" IDNO +2
  Reboot
  Quit

  ${If} ${FileExists} "$INSTDIR\${FileMainEXE}"
    Banner::show /NOUNLOAD "$(BANNER_CHECK_EXISTING)"

    ${If} "$TmpVal" == "FoundMessageWindow"
      Sleep 5000
    ${EndIf}

    ${PushFilesToCheck}

    ; Store the return value in $TmpVal so it is less likely to be accidentally
    ; overwritten elsewhere.
    ${CheckForFilesInUse} $TmpVal

    Banner::destroy

    ${If} "$TmpVal" == "true"
      StrCpy $TmpVal "FoundMessageWindow"
      ${ManualCloseAppPrompt} "${WindowClass}" "$(WARN_MANUALLY_CLOSE_APP_INSTALL)"
      StrCpy $TmpVal "true"
    ${EndIf}
  ${EndIf}
FunctionEnd

Function LaunchApp
  ClearErrors
  ${GetParameters} $0
  ${GetOptions} "$0" "/UAC:" $1
  ${If} ${Errors}
    ${ManualCloseAppPrompt} "${WindowClass}" "$(WARN_MANUALLY_CLOSE_APP_LAUNCH)"
    Exec "$\"$INSTDIR\${FileMainEXE}$\""
  ${Else}
    GetFunctionAddress $0 LaunchAppFromElevatedProcess
    UAC::ExecCodeSegment $0
  ${EndIf}
FunctionEnd

Function LaunchAppFromElevatedProcess
  ${ManualCloseAppPrompt} "${WindowClass}" "$(WARN_MANUALLY_CLOSE_APP_LAUNCH)"

  ; Find the installation directory when launching using GetFunctionAddress
  ; from an elevated installer since $INSTDIR will not be set in this installer
  ReadRegStr $0 HKLM "Software\Clients\Mail\${ClientsRegName}\DefaultIcon" ""
  ${GetPathFromString} "$0" $0
  ${GetParent} "$0" $1
  ; Set our current working directory to the application's install directory
  ; otherwise the 7-Zip temp directory will be in use and won't be deleted.
  SetOutPath "$1"
  Exec "$\"$0$\""
FunctionEnd

################################################################################
# Language

!insertmacro MOZ_MUI_LANGUAGE 'baseLocale'
!verbose push
!verbose 3
!include "overrideLocale.nsh"
!include "customLocale.nsh"
!verbose pop

; Set this after the locale files to override it if it is in the locale
; using " " for BrandingText will hide the "Nullsoft Install System..." branding
BrandingText " "

################################################################################
# Page pre, show, and leave functions

Function preWelcome
  StrCpy $PageName "Welcome"
  ${If} ${FileExists} "$EXEDIR\core\distribution\modern-wizard.bmp"
    Delete "$PLUGINSDIR\modern-wizard.bmp"
    CopyFiles /SILENT "$EXEDIR\core\distribution\modern-wizard.bmp" "$PLUGINSDIR\modern-wizard.bmp"
  ${EndIf}
FunctionEnd

Function showLicense
  ${If} ${FileExists} "$EXEDIR\core\distribution\modern-header.bmp"
  ${AndIf} $hHeaderBitmap == ""
    Delete "$PLUGINSDIR\modern-header.bmp"
    CopyFiles /SILENT "$EXEDIR\core\distribution\modern-header.bmp" "$PLUGINSDIR\modern-header.bmp"
    ${ChangeMUIHeaderImage} "$PLUGINSDIR\modern-header.bmp"
  ${EndIf}
FunctionEnd

Function preOptions
  StrCpy $PageName "Options"
  ${If} ${FileExists} "$EXEDIR\core\distribution\modern-header.bmp"
  ${AndIf} $hHeaderBitmap == ""
    Delete "$PLUGINSDIR\modern-header.bmp"
    CopyFiles /SILENT "$EXEDIR\core\distribution\modern-header.bmp" "$PLUGINSDIR\modern-header.bmp"
    ${ChangeMUIHeaderImage} "$PLUGINSDIR\modern-header.bmp"
  ${EndIf}

  !insertmacro MUI_HEADER_TEXT "$(OPTIONS_PAGE_TITLE)" "$(OPTIONS_PAGE_SUBTITLE)"
  !insertmacro MUI_INSTALLOPTIONS_DISPLAY "options.ini"
FunctionEnd

Function leaveOptions
  ${MUI_INSTALLOPTIONS_READ} $0 "options.ini" "Settings" "State"
  ${If} $0 != 0
    Abort
  ${EndIf}
  ${MUI_INSTALLOPTIONS_READ} $R0 "options.ini" "Field 2" "State"
  StrCmp $R0 "1" +1 +2
  StrCpy $InstallType ${INSTALLTYPE_BASIC}
  ${MUI_INSTALLOPTIONS_READ} $R0 "options.ini" "Field 3" "State"
  StrCmp $R0 "1" +1 +2
  StrCpy $InstallType ${INSTALLTYPE_CUSTOM}

  ${LeaveOptionsCommon}

  ${If} $InstallType == ${INSTALLTYPE_BASIC}
    Call CheckExistingInstall
  ${EndIf}
FunctionEnd

Function preDirectory
  StrCpy $PageName "Directory"
  ${PreDirectoryCommon}
FunctionEnd

Function leaveDirectory
  ${If} $InstallType == ${INSTALLTYPE_BASIC}
    Call CheckExistingInstall
  ${EndIf}
  ${LeaveDirectoryCommon} "$(WARN_DISK_SPACE)" "$(WARN_WRITE_ACCESS)"
FunctionEnd

Function preShortcuts
  StrCpy $PageName "Shortcuts"
  ${CheckCustomCommon}
  !insertmacro MUI_HEADER_TEXT "$(SHORTCUTS_PAGE_TITLE)" "$(SHORTCUTS_PAGE_SUBTITLE)"
  !insertmacro MUI_INSTALLOPTIONS_DISPLAY "shortcuts.ini"
FunctionEnd

Function leaveShortcuts
  ${MUI_INSTALLOPTIONS_READ} $0 "shortcuts.ini" "Settings" "State"
  ${If} $0 != 0
    Abort
  ${EndIf}
  ${MUI_INSTALLOPTIONS_READ} $AddDesktopSC "shortcuts.ini" "Field 2" "State"
  ${MUI_INSTALLOPTIONS_READ} $AddStartMenuSC "shortcuts.ini" "Field 3" "State"
  ; Don't install the quick launch shortcut on Windows 7
  ${Unless} ${AtLeastWin7}
    ${MUI_INSTALLOPTIONS_READ} $AddQuickLaunchSC "shortcuts.ini" "Field 4" "State"
  ${EndUnless}

  ${If} $InstallType == ${INSTALLTYPE_CUSTOM}
    Call CheckExistingInstall
  ${EndIf}
FunctionEnd

Function preSummary
  StrCpy $PageName "Summary"
  ; Setup the summary.ini file for the Custom Summary Page
  WriteINIStr "$PLUGINSDIR\summary.ini" "Settings" NumFields "3"

  WriteINIStr "$PLUGINSDIR\summary.ini" "Field 1" Type   "label"
  WriteINIStr "$PLUGINSDIR\summary.ini" "Field 1" Text   "$(SUMMARY_INSTALLED_TO)"
  WriteINIStr "$PLUGINSDIR\summary.ini" "Field 1" Left   "0"
  WriteINIStr "$PLUGINSDIR\summary.ini" "Field 1" Right  "-1"
  WriteINIStr "$PLUGINSDIR\summary.ini" "Field 1" Top    "5"
  WriteINIStr "$PLUGINSDIR\summary.ini" "Field 1" Bottom "15"

  WriteINIStr "$PLUGINSDIR\summary.ini" "Field 2" Type   "text"
  ; The contents of this control must be set as follows in the pre function
  ; ${MUI_INSTALLOPTIONS_READ} $1 "summary.ini" "Field 2" "HWND"
  ; SendMessage $1 ${WM_SETTEXT} 0 "STR:$INSTDIR"
  WriteINIStr "$PLUGINSDIR\summary.ini" "Field 2" state  ""
  WriteINIStr "$PLUGINSDIR\summary.ini" "Field 2" Left   "0"
  WriteINIStr "$PLUGINSDIR\summary.ini" "Field 2" Right  "-1"
  WriteINIStr "$PLUGINSDIR\summary.ini" "Field 2" Top    "17"
  WriteINIStr "$PLUGINSDIR\summary.ini" "Field 2" Bottom "30"
  WriteINIStr "$PLUGINSDIR\summary.ini" "Field 2" flags  "READONLY"

  WriteINIStr "$PLUGINSDIR\summary.ini" "Field 3" Type   "label"
  WriteINIStr "$PLUGINSDIR\summary.ini" "Field 3" Text   "$(SUMMARY_CLICK)"
  WriteINIStr "$PLUGINSDIR\summary.ini" "Field 3" Left   "0"
  WriteINIStr "$PLUGINSDIR\summary.ini" "Field 3" Right  "-1"
  WriteINIStr "$PLUGINSDIR\summary.ini" "Field 3" Top    "130"
  WriteINIStr "$PLUGINSDIR\summary.ini" "Field 3" Bottom "150"

  ${If} "$TmpVal" == "true"
    WriteINIStr "$PLUGINSDIR\summary.ini" "Field 4" Type   "label"
    WriteINIStr "$PLUGINSDIR\summary.ini" "Field 4" Text   "$(SUMMARY_REBOOT_REQUIRED_INSTALL)"
    WriteINIStr "$PLUGINSDIR\summary.ini" "Field 4" Left   "0"
    WriteINIStr "$PLUGINSDIR\summary.ini" "Field 4" Right  "-1"
    WriteINIStr "$PLUGINSDIR\summary.ini" "Field 4" Top    "35"
    WriteINIStr "$PLUGINSDIR\summary.ini" "Field 4" Bottom "45"

    WriteINIStr "$PLUGINSDIR\summary.ini" "Settings" NumFields "4"
  ${EndIf}

  ReadINIStr $0 "$PLUGINSDIR\options.ini" "Field 6" "State"
  ${If} "$0" == "1"
    ${If} "$TmpVal" == "true"
      ; To insert this control reset Top / Bottom for controls below this one
      WriteINIStr "$PLUGINSDIR\summary.ini" "Field 4" Top    "50"
      WriteINIStr "$PLUGINSDIR\summary.ini" "Field 4" Bottom "60"
      StrCpy $0 "5"
    ${Else}
      StrCpy $0 "4"
    ${EndIf}

    WriteINIStr "$PLUGINSDIR\summary.ini" "Field $0" Type   "label"
    WriteINIStr "$PLUGINSDIR\summary.ini" "Field $0" Text   "$(SUMMARY_MAKE_DEFAULT)"
    WriteINIStr "$PLUGINSDIR\summary.ini" "Field $0" Left   "0"
    WriteINIStr "$PLUGINSDIR\summary.ini" "Field $0" Right  "-1"
    WriteINIStr "$PLUGINSDIR\summary.ini" "Field $0" Top    "35"
    WriteINIStr "$PLUGINSDIR\summary.ini" "Field $0" Bottom "45"

    WriteINIStr "$PLUGINSDIR\summary.ini" "Settings" NumFields "$0"
  ${EndIf}

  !insertmacro MUI_HEADER_TEXT "$(SUMMARY_PAGE_TITLE)" "$(SUMMARY_PAGE_SUBTITLE)"

  ; The Summary custom page has a textbox that will automatically receive
  ; focus. This sets the focus to the Install button instead.
  !insertmacro MUI_INSTALLOPTIONS_INITDIALOG "summary.ini"
  GetDlgItem $0 $HWNDPARENT 1
  System::Call "user32::SetFocus(i r0, i 0x0007, i,i)i"
  ${MUI_INSTALLOPTIONS_READ} $1 "summary.ini" "Field 2" "HWND"
  SendMessage $1 ${WM_SETTEXT} 0 "STR:$INSTDIR"
  !insertmacro MUI_INSTALLOPTIONS_SHOW
FunctionEnd

Function leaveSummary
  ; Try to delete the app executable and if we can't delete it try to find the
  ; app's message window and prompt the user to close the app. This allows
  ; running an instance that is located in another directory. If for whatever
  ; reason there is no message window we will just rename the app's files and
  ; then remove them on restart.
  ClearErrors
  ${DeleteFile} "$INSTDIR\${FileMainEXE}"
  ${If} ${Errors}
    ${ManualCloseAppPrompt} "${WindowClass}" "$(WARN_MANUALLY_CLOSE_APP_INSTALL)"
  ${EndIf}
FunctionEnd

; When we add an optional action to the finish page the cancel button is
; enabled. This disables it and leaves the finish button as the only choice.
Function preFinish
  StrCpy $PageName ""
  ${EndInstallLog} "${BrandFullName}"
  !insertmacro MUI_INSTALLOPTIONS_WRITE "ioSpecial.ini" "settings" "cancelenabled" "0"
FunctionEnd

################################################################################
# Initialization Functions

Function .onInit
  ; Remove the current exe directory from the search order.
  ; This only effects LoadLibrary calls and not implicitly loaded DLLs.
  System::Call 'kernel32::SetDllDirectoryW(w "")'

  StrCpy $PageName ""
  StrCpy $LANGUAGE 0
  ${SetBrandNameVars} "$EXEDIR\core\distribution\setup.ini"

  ; Don't install on systems that don't support SSE2. The parameter value of
  ; 10 is for PF_XMMI64_INSTRUCTIONS_AVAILABLE which will check whether the
  ; SSE2 instruction set is available.
  System::Call "kernel32::IsProcessorFeaturePresent(i 10)i .R7"

!ifdef HAVE_64BIT_BUILD
  ; Restrict x64 builds from being installed on x86 and pre Win7
  ${Unless} ${RunningX64}
  ${OrUnless} ${AtLeastWin7}
    ${If} "$R7" == "0"
      strCpy $R7 "$(WARN_MIN_SUPPORTED_OSVER_CPU_MSG)"
    ${Else}
      strCpy $R7 "$(WARN_MIN_SUPPORTED_OSVER_MSG)"
    ${EndIf}
    MessageBox MB_OKCANCEL|MB_ICONSTOP "$R7" IDCANCEL +2
    ExecShell "open" "${URLSystemRequirements}"
    Quit
  ${EndUnless}

  SetRegView 64
!else
  StrCpy $R8 "0"
  ${If} ${AtMostWin2000}
    StrCpy $R8 "1"
  ${EndIf}

  ${If} ${IsWinXP}
  ${AndIf} ${AtMostServicePack} 1
    StrCpy $R8 "1"
  ${EndIf}

  ${If} $R8 == "1"
    ; XXX-rstrong - some systems failed the AtLeastWin2000 test that we
    ; used to use for an unknown reason and likely fail the AtMostWin2000
    ; and possibly the IsWinXP test as well. To work around this also
    ; check if the Windows NT registry Key exists and if it does if the
    ; first char in CurrentVersion is equal to 3 (Windows NT 3.5 and
    ; 3.5.1), 4 (Windows NT 4), or 5 (Windows 2000 and Windows XP).
    StrCpy $R8 ""
    ClearErrors
    ReadRegStr $R8 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion" "CurrentVersion"
    StrCpy $R8 "$R8" 1
    ${If} ${Errors}
    ${OrIf} "$R8" == "3"
    ${OrIf} "$R8" == "4"
    ${OrIf} "$R8" == "5"
      ${If} "$R7" == "0"
        strCpy $R7 "$(WARN_MIN_SUPPORTED_OSVER_CPU_MSG)"
      ${Else}
        strCpy $R7 "$(WARN_MIN_SUPPORTED_OSVER_MSG)"
      ${EndIf}
      MessageBox MB_OKCANCEL|MB_ICONSTOP "$R7" IDCANCEL +2
      ExecShell "open" "${URLSystemRequirements}"
      Quit
    ${EndIf}
  ${EndUnless}
!endif

  ${If} "$R7" == "0"
    MessageBox MB_OKCANCEL|MB_ICONSTOP "$(WARN_MIN_SUPPORTED_CPU_MSG)" IDCANCEL +2
    ExecShell "open" "${URLSystemRequirements}"
    Quit
  ${EndIf}

  ${InstallOnInitCommon} "$(WARN_MIN_SUPPORTED_OSVER_CPU_MSG)"

  !insertmacro InitInstallOptionsFile "options.ini"
  !insertmacro InitInstallOptionsFile "shortcuts.ini"
  !insertmacro InitInstallOptionsFile "components.ini"
  !insertmacro InitInstallOptionsFile "summary.ini"

  ClearErrors
  ${If} ${AtLeastWinVista}
    WriteRegStr HKLM "Software\Binary Outcast" "${BrandShortName}InstallerTest" "Write Test"
  ${EndIf}
  ${If} ${Errors}
    ; Setup the options.ini file for the Custom Options Page without the option
    ; to set as default for Vista and above since the installer is unable to
    ; write to HKLM.
    WriteINIStr "$PLUGINSDIR\options.ini" "Settings" NumFields "5"
  ${Else}
    DeleteRegValue HKLM "Software\Binary Outcast" "${BrandShortName}InstallerTest"
    ; Setup the options.ini file for the Custom Options Page with the option
    ; to set as default
    WriteINIStr "$PLUGINSDIR\options.ini" "Settings" NumFields "6"

    WriteINIStr "$PLUGINSDIR\options.ini" "Field 6" Type   "checkbox"
    WriteINIStr "$PLUGINSDIR\options.ini" "Field 6" Text   "$(OPTIONS_MAKE_DEFAULT)"
    WriteINIStr "$PLUGINSDIR\options.ini" "Field 6" Left   "0"
    WriteINIStr "$PLUGINSDIR\options.ini" "Field 6" Right  "-1"
    WriteINIStr "$PLUGINSDIR\options.ini" "Field 6" Top    "124"
    WriteINIStr "$PLUGINSDIR\options.ini" "Field 6" Bottom "145"
    WriteINIStr "$PLUGINSDIR\options.ini" "Field 6" State  "1"
  ${EndIf}

  WriteINIStr "$PLUGINSDIR\options.ini" "Field 1" Type   "label"
  WriteINIStr "$PLUGINSDIR\options.ini" "Field 1" Text   "$(OPTIONS_SUMMARY)"
  WriteINIStr "$PLUGINSDIR\options.ini" "Field 1" Left   "0"
  WriteINIStr "$PLUGINSDIR\options.ini" "Field 1" Right  "-1"
  WriteINIStr "$PLUGINSDIR\options.ini" "Field 1" Top    "0"
  WriteINIStr "$PLUGINSDIR\options.ini" "Field 1" Bottom "10"

  WriteINIStr "$PLUGINSDIR\options.ini" "Field 2" Type   "RadioButton"
  WriteINIStr "$PLUGINSDIR\options.ini" "Field 2" Text   "$(OPTION_STANDARD_RADIO)"
  WriteINIStr "$PLUGINSDIR\options.ini" "Field 2" Left   "0"
  WriteINIStr "$PLUGINSDIR\options.ini" "Field 2" Right  "-1"
  WriteINIStr "$PLUGINSDIR\options.ini" "Field 2" Top    "25"
  WriteINIStr "$PLUGINSDIR\options.ini" "Field 2" Bottom "35"
  WriteINIStr "$PLUGINSDIR\options.ini" "Field 2" State  "1"
  WriteINIStr "$PLUGINSDIR\options.ini" "Field 2" Flags  "GROUP"

  WriteINIStr "$PLUGINSDIR\options.ini" "Field 3" Type   "RadioButton"
  WriteINIStr "$PLUGINSDIR\options.ini" "Field 3" Text   "$(OPTION_CUSTOM_RADIO)"
  WriteINIStr "$PLUGINSDIR\options.ini" "Field 3" Left   "0"
  WriteINIStr "$PLUGINSDIR\options.ini" "Field 3" Right  "-1"
  WriteINIStr "$PLUGINSDIR\options.ini" "Field 3" Top    "55"
  WriteINIStr "$PLUGINSDIR\options.ini" "Field 3" Bottom "65"
  WriteINIStr "$PLUGINSDIR\options.ini" "Field 3" State  "0"

  WriteINIStr "$PLUGINSDIR\options.ini" "Field 4" Type   "label"
  WriteINIStr "$PLUGINSDIR\options.ini" "Field 4" Text   "$(OPTION_STANDARD_DESC)"
  WriteINIStr "$PLUGINSDIR\options.ini" "Field 4" Left   "15"
  WriteINIStr "$PLUGINSDIR\options.ini" "Field 4" Right  "-1"
  WriteINIStr "$PLUGINSDIR\options.ini" "Field 4" Top    "37"
  WriteINIStr "$PLUGINSDIR\options.ini" "Field 4" Bottom "57"

  WriteINIStr "$PLUGINSDIR\options.ini" "Field 5" Type   "label"
  WriteINIStr "$PLUGINSDIR\options.ini" "Field 5" Text   "$(OPTION_CUSTOM_DESC)"
  WriteINIStr "$PLUGINSDIR\options.ini" "Field 5" Left   "15"
  WriteINIStr "$PLUGINSDIR\options.ini" "Field 5" Right  "-1"
  WriteINIStr "$PLUGINSDIR\options.ini" "Field 5" Top    "67"
  WriteINIStr "$PLUGINSDIR\options.ini" "Field 5" Bottom "87"

  ; Setup the shortcuts.ini file for the Custom Shortcuts Page
  ; Don't offer to install the quick launch shortcut on Windows 7
  ${If} ${AtLeastWin7}
    WriteINIStr "$PLUGINSDIR\shortcuts.ini" "Settings" NumFields "3"
  ${Else}
    WriteINIStr "$PLUGINSDIR\shortcuts.ini" "Settings" NumFields "4"
  ${EndIf}

  WriteINIStr "$PLUGINSDIR\shortcuts.ini" "Field 1" Type   "label"
  WriteINIStr "$PLUGINSDIR\shortcuts.ini" "Field 1" Text   "$(CREATE_ICONS_DESC)"
  WriteINIStr "$PLUGINSDIR\shortcuts.ini" "Field 1" Left   "0"
  WriteINIStr "$PLUGINSDIR\shortcuts.ini" "Field 1" Right  "-1"
  WriteINIStr "$PLUGINSDIR\shortcuts.ini" "Field 1" Top    "5"
  WriteINIStr "$PLUGINSDIR\shortcuts.ini" "Field 1" Bottom "15"

  WriteINIStr "$PLUGINSDIR\shortcuts.ini" "Field 2" Type   "checkbox"
  WriteINIStr "$PLUGINSDIR\shortcuts.ini" "Field 2" Text   "$(ICONS_DESKTOP)"
  WriteINIStr "$PLUGINSDIR\shortcuts.ini" "Field 2" Left   "0"
  WriteINIStr "$PLUGINSDIR\shortcuts.ini" "Field 2" Right  "-1"
  WriteINIStr "$PLUGINSDIR\shortcuts.ini" "Field 2" Top    "20"
  WriteINIStr "$PLUGINSDIR\shortcuts.ini" "Field 2" Bottom "30"
  WriteINIStr "$PLUGINSDIR\shortcuts.ini" "Field 2" State  "1"
  WriteINIStr "$PLUGINSDIR\shortcuts.ini" "Field 2" Flags  "GROUP"

  WriteINIStr "$PLUGINSDIR\shortcuts.ini" "Field 3" Type   "checkbox"
  WriteINIStr "$PLUGINSDIR\shortcuts.ini" "Field 3" Text   "$(ICONS_STARTMENU)"
  WriteINIStr "$PLUGINSDIR\shortcuts.ini" "Field 3" Left   "0"
  WriteINIStr "$PLUGINSDIR\shortcuts.ini" "Field 3" Right  "-1"
  WriteINIStr "$PLUGINSDIR\shortcuts.ini" "Field 3" Top    "40"
  WriteINIStr "$PLUGINSDIR\shortcuts.ini" "Field 3" Bottom "50"
  WriteINIStr "$PLUGINSDIR\shortcuts.ini" "Field 3" State  "1"

  ; Don't offer to install the quick launch shortcut on Windows 7
  ${Unless} ${AtLeastWin7}
    WriteINIStr "$PLUGINSDIR\shortcuts.ini" "Field 4" Type   "checkbox"
    WriteINIStr "$PLUGINSDIR\shortcuts.ini" "Field 4" Text   "$(ICONS_QUICKLAUNCH)"
    WriteINIStr "$PLUGINSDIR\shortcuts.ini" "Field 4" Left   "0"
    WriteINIStr "$PLUGINSDIR\shortcuts.ini" "Field 4" Right  "-1"
    WriteINIStr "$PLUGINSDIR\shortcuts.ini" "Field 4" Top    "60"
    WriteINIStr "$PLUGINSDIR\shortcuts.ini" "Field 4" Bottom "70"
    WriteINIStr "$PLUGINSDIR\shortcuts.ini" "Field 4" State  "1"
  ${EndUnless}

  ; Setup the components.ini file for the Components Page
  WriteINIStr "$PLUGINSDIR\components.ini" "Settings" NumFields "2"

  WriteINIStr "$PLUGINSDIR\components.ini" "Field 1" Type   "label"
  WriteINIStr "$PLUGINSDIR\components.ini" "Field 1" Text   "$(OPTIONAL_COMPONENTS_DESC)"
  WriteINIStr "$PLUGINSDIR\components.ini" "Field 1" Left   "0"
  WriteINIStr "$PLUGINSDIR\components.ini" "Field 1" Right  "-1"
  WriteINIStr "$PLUGINSDIR\components.ini" "Field 1" Top    "5"
  WriteINIStr "$PLUGINSDIR\components.ini" "Field 1" Bottom "25"

  WriteINIStr "$PLUGINSDIR\components.ini" "Field 2" Type   "checkbox"
  WriteINIStr "$PLUGINSDIR\components.ini" "Field 2" Text   "$(MAINTENANCE_SERVICE_CHECKBOX_DESC)"
  WriteINIStr "$PLUGINSDIR\components.ini" "Field 2" Left   "0"
  WriteINIStr "$PLUGINSDIR\components.ini" "Field 2" Right  "-1"
  WriteINIStr "$PLUGINSDIR\components.ini" "Field 2" Top    "27"
  WriteINIStr "$PLUGINSDIR\components.ini" "Field 2" Bottom "37"
  WriteINIStr "$PLUGINSDIR\components.ini" "Field 2" State  "1"
  WriteINIStr "$PLUGINSDIR\components.ini" "Field 2" Flags  "GROUP"

  ; There must always be a core directory.
  ${GetSize} "$EXEDIR\core\" "/S=0K" $R5 $R7 $R8
  ; Add 1024 Kb to the diskspace requirement since the installer makes a copy
  ; of the MAPI dll's (around 20 Kb)... also, see Bug 434338.
  IntOp $R5 $R5 + 1024
  SectionSetSize ${APP_IDX} $R5

  ; Initialize $hHeaderBitmap to prevent redundant changing of the bitmap if
  ; the user clicks the back button
  StrCpy $hHeaderBitmap ""
FunctionEnd

Function .onGUIEnd
  ${OnEndCommon}
FunctionEnd
