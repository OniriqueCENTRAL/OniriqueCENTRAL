# Génère index.html : page complète et autonome (logos intégrés en base64), prête à héberger.
# Source à éditer : onirique.html (+ assets/). Lancer : powershell -File build.ps1
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$html = [IO.File]::ReadAllText("$here\onirique.html", [Text.Encoding]::UTF8)
foreach ($name in "logo.png", "logo-small.png") {
    $b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes("$here\assets\$name"))
    $html = $html.Replace("assets/$name", "data:image/png;base64,$b64")
}
$head = "<!doctype html>`n<html lang=`"fr`">`n<meta charset=`"utf-8`">`n<meta name=`"viewport`" content=`"width=device-width, initial-scale=1, viewport-fit=cover`">`n"
[IO.File]::WriteAllText("$here\index.html", $head + $html + "`n</html>`n", (New-Object Text.UTF8Encoding $false))
"index.html : {0:N0} Ko" -f ((Get-Item "$here\index.html").Length / 1KB)
