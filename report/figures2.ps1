$ErrorActionPreference = "Stop"
$out = "D:\claude\test-voting\report\img"
function Rgb([int]$r, [int]$g, [int]$b) { return $r + ($g * 256) + ($b * 65536) }
$BLUE = Rgb 21 96 130; $GREEN = Rgb 46 125 50; $ORANGE = Rgb 176 84 14; $RED = Rgb 160 40 40
$INK = Rgb 31 31 31; $WHITE = Rgb 255 255 255; $PALE = Rgb 238 244 248; $GREY = Rgb 85 85 85; $CLOUD = Rgb 245 248 252
$FONT = "Calibri"

function Add-Box($slide, [double]$x, [double]$y, [double]$w, [double]$h, [string]$heading, [string[]]$lines, [int]$color, [double]$size, [int]$fill) {
  $b = $slide.Shapes.AddShape(1, $x, $y, $w, $h)
  $b.Fill.ForeColor.RGB = $fill; $b.Line.ForeColor.RGB = $color; $b.Line.Weight = 2; $b.Shadow.Visible = 0
  $tf = $b.TextFrame
  $tf.WordWrap = -1; $tf.AutoSize = 0; $tf.VerticalAnchor = 1
  $tf.MarginLeft = 7; $tf.MarginRight = 6; $tf.MarginTop = 5; $tf.MarginBottom = 3
  $tr = $tf.TextRange
  $tr.Text = ($heading + "`r" + ($lines -join "`r"))
  $tr.Font.Name = $FONT; $tr.Font.Size = $size; $tr.Font.Color.RGB = $INK; $tr.Font.Bold = 0
  $tr.ParagraphFormat.Alignment = 1; $tr.ParagraphFormat.SpaceAfter = 2
  $hp = $tr.Paragraphs(1); $hp.Font.Bold = -1; $hp.Font.Size = $size + 1.5; $hp.Font.Color.RGB = $color; $hp.ParagraphFormat.SpaceAfter = 4
  return $b
}
function Add-Arrow($slide, [double]$x1, [double]$y1, [double]$x2, [double]$y2, [bool]$both, [bool]$head) {
  $c = $slide.Shapes.AddConnector(1, $x1, $y1, $x2, $y2)
  $c.Line.ForeColor.RGB = $INK; $c.Line.Weight = 2.25
  if ($head) { $c.Line.EndArrowheadStyle = 2 }
  if ($both) { $c.Line.BeginArrowheadStyle = 2 }
  return $c
}
function Add-Label($slide, [double]$x, [double]$y, [double]$w, [string]$text, [double]$size, [int]$color, [bool]$bold, [int]$align) {
  $t = $slide.Shapes.AddTextbox(1, $x, $y, $w, 22)
  $t.TextFrame.WordWrap = -1
  $t.TextFrame.TextRange.Text = $text
  $t.TextFrame.TextRange.Font.Name = $FONT; $t.TextFrame.TextRange.Font.Size = $size
  $t.TextFrame.TextRange.Font.Color.RGB = $color
  $t.TextFrame.TextRange.ParagraphFormat.Alignment = $align
  if ($bold) { $t.TextFrame.TextRange.Font.Bold = -1 }
  return $t
}

$app = New-Object -ComObject PowerPoint.Application
try {
  # ======== Figure: system architecture with the cloud server ========
  $pres = $app.Presentations.Add(0)
  $pres.PageSetup.SlideWidth = 960; $pres.PageSetup.SlideHeight = 540
  $s = $pres.Slides.AddSlide(1, $pres.SlideMaster.CustomLayouts(7))
  $s.FollowMasterBackground = 0; $s.Background.Fill.ForeColor.RGB = $WHITE

  $null = Add-Box $s 20 52 185 150 "VOTER'S BROWSER" @("One-page voting site", "Pick a voter ID", "Press the candidate's Vote button", "Sees a receipt and each step") $BLUE 12 $WHITE

  # cloud container
  $cl = $s.Shapes.AddShape(1, 228, 18, 478, 334)
  $cl.Fill.ForeColor.RGB = $CLOUD; $cl.Line.ForeColor.RGB = $BLUE; $cl.Line.Weight = 2; $cl.Line.DashStyle = 4; $cl.Shadow.Visible = 0
  $null = Add-Label $s 236 20 460 "CLOUD SERVER  (Oracle Cloud free VM: Ubuntu + Docker)" 12.5 $BLUE $true 1
  $null = Add-Box $s 240 52 112 150 "CADDY" @("Public web address (DuckDNS)", "Free HTTPS certificate", "Passes requests to the backend") $BLUE 11.5 $WHITE
  $null = Add-Box $s 368 52 326 186 "BACKEND (Node.js container)" @("1  Check the request and the election", "2  Verify the voter (Keccak-256 hash)", "3  Issue a one-time token", "4  Encrypt the ballot (RSA-3072 + AES-256-GCM)", "5  Send it to the smart contract") $ORANGE 11.5 $WHITE
  $null = Add-Box $s 240 250 454 88 "DATABASE (SQLite, on the server's disk)" @("Hashed voter IDs only, token hashes with no link to voters", "No names, no vote choices, no keys") $BLUE 11.5 $WHITE

  $null = Add-Box $s 735 52 205 186 "BLOCKCHAIN" @("Ethereum test network (Sepolia)", "GovElection smart contract", "Stores each 430-byte encrypted ballot", "Enforces the rules and the phases", "Public and permanent") $GREEN 12 $WHITE

  $null = Add-Arrow $s 205 127 240 127 $false $true
  $null = Add-Arrow $s 352 127 368 127 $false $true
  $null = Add-Arrow $s 694 145 735 145 $false $true
  $null = Add-Arrow $s 531 238 531 250 $true $true

  # bottom row
  $null = Add-Box $s 20 385 190 118 "BEFORE THE ELECTION" @("Key ceremony makes an RSA-3072 key", "Private key split into 3 trustee shares", "Only the public key goes to the server") $ORANGE 11.5 $WHITE
  $null = Add-Box $s 228 385 200 118 "ADMINISTRATOR" @("Own wallet, not on the server", "Opens the election", "Watches turnout") $BLUE 11.5 $WHITE
  $null = Add-Box $s 446 385 270 118 "TRUSTEES (any 2 of 3)" @("Each keeps one encrypted share", "After closing: rebuild key, decrypt, count", "Submit identical totals to the contract") $ORANGE 11.5 $WHITE
  $null = Add-Box $s 735 385 205 118 "ANYONE (PUBLIC)" @("Reads the ballots from the chain", "Recounts with the published key", "Checks the result") $GREEN 11.5 $WHITE
  # bus line up to the blockchain
  $null = Add-Arrow $s 328 372 837 372 $false $false
  $null = Add-Arrow $s 328 385 328 372 $false $false
  $null = Add-Arrow $s 581 385 581 372 $false $false
  $null = Add-Arrow $s 837 385 837 238 $true $true
  $null = Add-Label $s 20 508 920 "Arrows show the flow of data. The server holds only the public election key: wallet keys and trustee shares never leave their owners." 11.5 $GREY $false 2
  $pres.Slides(1).Export("$out\fig31_architecture_cloud.png", "PNG", 1920, 1080)
  $pres.Saved = -1; $pres.Close()

  # ======== Figure: the five backend steps of one vote ========
  $pres = $app.Presentations.Add(0)
  $pres.PageSetup.SlideWidth = 960; $pres.PageSetup.SlideHeight = 345
  $s = $pres.Slides.AddSlide(1, $pres.SlideMaster.CustomLayouts(7))
  $s.FollowMasterBackground = 0; $s.Background.Fill.ForeColor.RGB = $WHITE
  $null = Add-Label $s 20 6 920 "What the backend does after the voter presses Vote" 15 $INK $true 1
  $steps = @(
    @("1  CHECK", @("Voter ID format and candidate number are valid", "The chain says voting is open"), "Refused if voting is not open", $BLUE, "29 ms"),
    @("2  VERIFY VOTER", @("Voter ID goes through HMAC-SHA-256, then Keccak-256", "The hash is looked up on the electoral roll"), "Refused if not on the roll", $BLUE, "14 ms"),
    @("3  ISSUE TOKEN", @("32 random bytes; only the hash is stored", "No voter column in the token table", "Voter marked as voted"), "Refused if already voted", $BLUE, "11 ms"),
    @("4  ENCRYPT", @("Candidate + 16 random bytes sealed with AES-256-GCM", "AES key wrapped with RSA-OAEP-3072", "Result: 430 bytes"), "Always 430 bytes", $ORANGE, "3 ms"),
    @("5  BLOCKCHAIN", @("castBallot(token hash, ballot)", "The contract checks its rules and stores the ballot", "Receipt: transaction and block"), "Rule broken: token released", $GREEN, "168 ms")
  )
  $bw = 170; $gap = 16.5
  for ($i = 0; $i -lt 5; $i++) {
    $x = 20 + $i * ($bw + $gap)
    $b = Add-Box $s $x 36 $bw 205 $steps[$i][0] $steps[$i][1] $steps[$i][3] 11.5 $WHITE
    $r = Add-Label $s ($x + 2) 207 ($bw - 4) $steps[$i][2] 11 $RED $true 1
    $t = Add-Label $s $x 252 $bw $steps[$i][4] 20 $steps[$i][3] $true 2
    if ($i -lt 4) { $null = Add-Arrow $s ($x + $bw) 138 ($x + $bw + $gap) 138 $false $true }
  }
  $null = Add-Label $s 20 300 920 "Time per step on a local test chain. Total about 225 ms, of which the blockchain step is three quarters." 12.5 $GREY $false 2
  $pres.Slides(1).Export("$out\fig32b_pipeline.png", "PNG", 1920, 690)
  $pres.Saved = -1; $pres.Close()
  "figures2 done"
} finally { $app.Quit() }
