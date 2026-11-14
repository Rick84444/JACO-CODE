Option Explicit
' Interactive launch opens the GUI and reports failures. "--background" (sign-in autostart) starts
' Aura silently: no browser window and no dialog; failures are written to launcher.log.
Dim shell, fso, root, command, code, background
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
background = False
If WScript.Arguments.Count > 0 Then
  If WScript.Arguments(0) = "--background" Then background = True
End If
command = "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File " & Chr(34) & root & "\Start-JACO.ps1" & Chr(34)
If background Then command = command & " -NoBrowser"
code = shell.Run(command, 0, True)
If code <> 0 And Not background Then
  MsgBox "JACO could not start. See %LOCALAPPDATA%\JACO\logs\startup\launcher.log for the reason.", vbExclamation, "JACO CODE"
End If
