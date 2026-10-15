Option Explicit
Dim shell, files, root, command, result, nodePath
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
root = files.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = root
nodePath = shell.Environment("PROCESS")("JACO_NODE_EXECUTABLE")
If nodePath = "" Then
  If files.FileExists(root & "\tools\node\node.exe") Then
    nodePath = root & "\tools\node\node.exe"
  Else
    nodePath = "node"
  End If
End If
command = Chr(34) & nodePath & Chr(34) & " " & Chr(34) & root & "\agents\lib\local-stack.mjs" & Chr(34) & " --open"
On Error Resume Next
result = shell.Run(command, 0, True)
If Err.Number <> 0 Then
  MsgBox "JACO kunde inte starta Node.js. Installera Node.js 24 eller senare, eller ange JACO_NODE_EXECUTABLE.", vbExclamation, "JACO start"
ElseIf result <> 0 Then
  MsgBox "JACO kunde inte starta. Se logs\startup\launcher.err.log och loggarna i " & root, vbExclamation, "JACO start"
End If
