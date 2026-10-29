param([string]$Path = "D:\claude\test-voting\report\Mini Project Report.docx", [string]$Prefix = "D:\claude\test-voting\report\qa\p")
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force -Path (Split-Path $Prefix) | Out-Null
$w = New-Object -ComObject Word.Application
$w.Visible = $false; $w.DisplayAlerts = 0
try {
  $doc = $w.Documents.Open($Path, $false, $true, $false)
  $n = $doc.ComputeStatistics(2)
  $pane = $doc.ActiveWindow.ActivePane
  for ($k = 1; $k -le $n; $k++) {
    $bytes = $pane.Pages.Item($k).EnhMetaFileBits
    $ms = New-Object System.IO.MemoryStream(, $bytes)
    $img = [System.Drawing.Image]::FromStream($ms)
    $bmp = New-Object System.Drawing.Bitmap(700, [int](700 * $img.Height / $img.Width))
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.Clear([System.Drawing.Color]::White)
    $g.DrawImage($img, 0, 0, $bmp.Width, $bmp.Height)
    $bmp.Save(("{0}{1:00}.png" -f $Prefix, $k), [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose(); $img.Dispose(); $ms.Dispose()
  }
  "Rendered $n pages"
  $doc.Close($false)
} finally { $w.Quit() }
