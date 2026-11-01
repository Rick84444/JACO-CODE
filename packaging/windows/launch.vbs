Option Explicit
Dim files, shell, root, pointer, text, expression, matches, buildId, versionRoot, command, mode
Set files = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
root = files.GetParentFolderName(WScript.ScriptFullName)
pointer = files.BuildPath(root, "current.json")
If Not files.FileExists(pointer) Then
  MsgBox "JACO is not fully installed. Run Setup again to repair the installation.", vbExclamation, "JACO"
  WScript.Quit 1
End If
Set text = files.OpenTextFile(pointer, 1, False)
Set expression = New RegExp
expression.Pattern = """buildId""\s*:\s*""([a-z0-9][a-z0-9._-]{1,160})"""
Set matches = expression.Execute(text.ReadAll)
text.Close
If matches.Count <> 1 Then
  MsgBox "JACO's installation record is invalid. Run Setup again to repair it.", vbExclamation, "JACO"
  WScript.Quit 1
End If
buildId = matches(0).SubMatches(0)
versionRoot = files.BuildPath(files.BuildPath(root, "versions"), buildId)
If Not files.FileExists(files.BuildPath(versionRoot, "node\node.exe")) Then
  MsgBox "JACO's runtime is missing. Run Setup again to repair it.", vbExclamation, "JACO"
  WScript.Quit 1
End If
mode = ""
If WScript.Arguments.Count > 0 Then
  If WScript.Arguments(0) = "--stop" Then mode = " --stop"
End If
command = """" & files.BuildPath(versionRoot, "node\node.exe") & """ """ & files.BuildPath(versionRoot, "installed-launch.mjs") & """" & mode
shell.Run command, 0, False
