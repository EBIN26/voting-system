Add-Type -AssemblyName System.Drawing
function Crop($src, $dst, $x, $y, $w, $h) {
  $img = [System.Drawing.Image]::FromFile($src)
  $bmp = New-Object System.Drawing.Bitmap($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.DrawImage($img, (New-Object System.Drawing.Rectangle(0, 0, $w, $h)), (New-Object System.Drawing.Rectangle($x, $y, $w, $h)), [System.Drawing.GraphicsUnit]::Pixel)
  $bmp.Save($dst, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose(); $img.Dispose()
}
$d = "D:\claude\test-voting\report\img"
Crop "D:\claude\test-voting\ppt-review\render-after\slide7.png" "$d\fig31_architecture.png" 10 110 1260 530
Crop "$d\flowchart_raw.png" "$d\fig32_flowchart.png" 300 0 1470 2480
Crop "$d\lifecycle_raw.png" "$d\fig33_lifecycle.png" 0 0 1920 430
Crop "$d\ballot_raw.png" "$d\fig34_ballot.png" 0 0 1920 640
"cropped"
