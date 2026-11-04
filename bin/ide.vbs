' Starts the launcher with no console window at all and without tying the editor to one (the Start menu entry runs this).
' Keep this file plain ASCII.
Set sh = CreateObject("WScript.Shell")
here = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
args = ""
For Each a In WScript.Arguments
  args = args & " """ & a & """"
Next
sh.Run "powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & here & "\ide.ps1""" & args, 0, False
