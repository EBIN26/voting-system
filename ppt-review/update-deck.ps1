$ErrorActionPreference = "Stop"
$target = "D:\claude\test-voting\ppt-review\Mini Project - Updated.pptx"
$renderDir = "D:\claude\test-voting\ppt-review\render-after"
New-Item -ItemType Directory -Force -Path $renderDir | Out-Null

# ---------- palette and helpers (ASCII only in this file; special characters via [char]) ----------
function Rgb([int]$r, [int]$g, [int]$b) { return $r + ($g * 256) + ($b * 65536) }
$BLUE   = Rgb 21 96 130     # the template's title colour
$GREEN  = Rgb 46 125 50
$ORANGE = Rgb 176 84 14
$INK    = Rgb 31 31 31
$GREY   = Rgb 85 85 85
$PALE   = Rgb 238 244 248
$LQ = [string][char]0x201C; $RQ = [string][char]0x201D; $EN = [string][char]0x2013; $BUL = [string][char]0x2022
$FONT_UI = "Calibri"

function Set-Rich($tr, [string]$text) {
  # **bold** markers switch bold on and off; `n becomes a paragraph break
  $tr.Text = ""
  $parts = $text -split '\*\*'
  for ($i = 0; $i -lt $parts.Count; $i++) {
    if ($parts[$i].Length -eq 0) { continue }
    $r = $tr.InsertAfter(($parts[$i] -replace "`n", "`r"))
    if ($i % 2 -eq 1) { $r.Font.Bold = -1 } else { $r.Font.Bold = 0 }
  }
}

function Add-Text($slide, [double]$x, [double]$y, [double]$w, [double]$h, [string]$text, [double]$size, [int]$color, [bool]$bold, [int]$align) {
  $tb = $slide.Shapes.AddTextbox(1, $x, $y, $w, $h)
  $tb.TextFrame.WordWrap = -1
  $tr = $tb.TextFrame.TextRange
  $tr.Text = $text
  $tr.Font.Name = $FONT_UI; $tr.Font.Size = $size; $tr.Font.Color.RGB = $color
  if ($bold) { $tr.Font.Bold = -1 } else { $tr.Font.Bold = 0 }
  $tr.ParagraphFormat.Alignment = $align
  return $tb
}

function Add-Box($slide, [double]$x, [double]$y, [double]$w, [double]$h, [string]$heading, [string[]]$lines, [int]$color, [double]$size, [bool]$bullets) {
  $b = $slide.Shapes.AddShape(1, $x, $y, $w, $h)    # rectangle
  $b.Fill.ForeColor.RGB = (Rgb 255 255 255)
  $b.Line.ForeColor.RGB = $color
  $b.Line.Weight = 2
  $b.Shadow.Visible = 0
  $tf = $b.TextFrame
  $tf.WordWrap = -1
  $tf.AutoSize = 0
  $tf.VerticalAnchor = 1       # top
  $tf.MarginLeft = 8; $tf.MarginRight = 8; $tf.MarginTop = 6; $tf.MarginBottom = 4
  $tr = $tf.TextRange
  $tr.Text = ($heading + "`r" + ($lines -join "`r"))
  $tr.Font.Name = $FONT_UI
  $tr.Font.Size = $size
  $tr.Font.Color.RGB = $INK
  $tr.Font.Bold = 0
  $tr.ParagraphFormat.Alignment = 1
  $tr.ParagraphFormat.SpaceAfter = 2
  $hp = $tr.Paragraphs(1)
  $hp.Font.Bold = -1; $hp.Font.Size = $size + 1.5; $hp.Font.Color.RGB = $color
  $hp.ParagraphFormat.SpaceAfter = 4
  if ($bullets) {
    $t2 = $b.TextFrame2.TextRange
    for ($i = 2; $i -le $t2.Paragraphs().Count; $i++) {
      $p = $t2.Paragraphs($i)
      $p.ParagraphFormat.Bullet.Visible = -1
      $p.ParagraphFormat.Bullet.Character = 8226
      $p.ParagraphFormat.LeftIndent = 11
      $p.ParagraphFormat.FirstLineIndent = -11
    }
  }
  return $b
}

function Add-Arrow($slide, [double]$x1, [double]$y1, [double]$x2, [double]$y2, [bool]$both) {
  $c = $slide.Shapes.AddConnector(1, $x1, $y1, $x2, $y2)
  $c.Line.ForeColor.RGB = $INK
  $c.Line.Weight = 2.25
  $c.Line.EndArrowheadStyle = 2
  if ($both) { $c.Line.BeginArrowheadStyle = 2 }
  return $c
}

function Set-Notes($slide, [string]$text) {
  $slide.NotesPage.Shapes.Placeholders(2).TextFrame.TextRange.Text = $text
}

$app = New-Object -ComObject PowerPoint.Application
try {
  $pres = $app.Presentations.Open($target, 0, 0, 0)   # read/write, untitled=false, no window
  $s6  = $pres.Slides(6);  $s7 = $pres.Slides(7);  $s8 = $pres.Slides(8);  $s9 = $pres.Slides(9)
  $s12 = $pres.Slides(12); $s13 = $pres.Slides(13)

  # ================= Slide 6: Objectives =================
  Set-Rich $s6.Shapes(2).TextFrame.TextRange (
    "To develop a secure and reliable voting platform using **blockchain technology** and cryptographic techniques.`n" +
    "To prevent duplicate voting using a unique **Keccak-256 voter hash** and a **one-time voting token**.`n" +
    "To keep votes confidential by encrypting them with **RSA-3072 and AES-256-GCM** before they are stored on the blockchain.`n" +
    "To implement a **Solidity smart contract** that enforces the election rules: one vote per token, a fixed voting window and a voter limit.`n" +
    "To make sure no single person can read the votes by splitting the decryption key among **trustees (2 of 3)**.`n" +
    "To give administrators **election management** and to make the result **publicly verifiable** by anyone who recounts the blockchain.`n" +
    "To host the backend on a **cloud platform** and deploy the contract on a **Proof of Stake network** (planned next stage).`n" +
    "To build a tested working prototype that demonstrates **blockchain, smart contracts, hashing, encryption and key splitting**.")

  # ================= Slide 7: Block diagram (replace the picture with editable shapes) =================
  $s7.Shapes("Picture 2").Delete()
  $t = Add-Text $s7 0 8 960 38 "Proposed block diagram" 28 $BLUE $true 2
  $t.TextFrame.TextRange.Font.Name = "Times New Roman"
  $null = Add-Text $s7 0 46 960 26 "Secure blockchain-based voting system" 16 $GREY $false 2

  $y1 = 92; $h1 = 160; $y2 = 305; $h2 = 135
  $null = Add-Box $s7 24  $y1 150 $h1 "VOTER" @("Opens the web page", "Receives an OTP on the linked phone (simulated)", "Presses Vote") $BLUE 12 $true
  $null = Add-Box $s7 214 $y1 230 $h1 "BACKEND SERVER" @("OTP login (simulated Aadhaar)", "Keccak-256 voter hash checked against the electoral roll", "One-time voting token issued") $BLUE 12 $true
  $null = Add-Box $s7 484 $y1 190 $h1 "ENCRYPTION" @("RSA-3072 locks a random AES-256 key", "AES-256-GCM locks the vote", "Fixed 430-byte ballot") $ORANGE 12 $true
  $null = Add-Box $s7 714 $y1 222 $h1 "BLOCKCHAIN + SMART CONTRACT" @("Solidity contract checks: only the backend submits, voting window, one vote per token, voter limit", "Stores the encrypted ballot permanently") $GREEN 12 $true

  $null = Add-Box $s7 24  $y2 150 $h2 "ADMIN" @("Opens the election with their own wallet", "Monitors turnout") $BLUE 12 $true
  $null = Add-Box $s7 214 $y2 230 $h2 "DATABASE" @("Hashed voter IDs only", "Token hashes with no link to voters", "No Aadhaar number or phone stored") $BLUE 12 $true
  $null = Add-Box $s7 484 $y2 190 $h2 "FINAL RESULTS" @("Final only when 2 trustees submit the same count", "Anyone can recount the ballots") $GREEN 12 $true
  $null = Add-Box $s7 714 $y2 222 $h2 "TRUSTEES (2 OF 3)" @("Key split with Shamir sharing", "Decrypt after voting closes", "Submit the count to the contract") $ORANGE 12 $true

  $null = Add-Arrow $s7 174 172 214 172 $false
  $null = Add-Arrow $s7 444 172 484 172 $false
  $null = Add-Arrow $s7 674 172 714 172 $false
  $null = Add-Arrow $s7 329 252 329 305 $true
  $null = Add-Arrow $s7 825 252 825 305 $true
  $null = Add-Arrow $s7 714 372 674 372 $false
  $null = Add-Arrow $s7 174 372 214 372 $false
  $null = Add-Text $s7 24 452 912 40 "Arrows show the flow of data. Every ballot is encrypted before it is stored, and the private key exists only as three trustee shares that cannot be used alone." 13 $GREY $false 2

  # ================= Slide 8: Methodology (replace the picture with editable shapes) =================
  $s8.Shapes("Picture 4").Delete()
  $s8.Shapes("Text Placeholder 2").Delete()
  $s8.Shapes("Title 1").TextFrame.TextRange.Text = "Methodology"
  $steps = @(
    @("1  Registration and login", "The voter enters an Aadhaar number. A one-time password (OTP) goes to the linked phone (simulated here). A correct OTP starts a short login session."),
    @("2  Voter verification", "A Keccak-256 voter hash is checked against the electoral roll. The voter gets a one-time voting token and is marked as voted, so a second attempt is refused."),
    @("3  Vote selection", "The voter chooses a candidate on the web page and confirms the choice. The vote is encrypted before it is stored anywhere."),
    @("4  Vote encryption", "The vote is locked with AES-256-GCM, and that key is locked with the election's RSA-3072 public key. Every ballot is 430 bytes and is bound to this election."),
    @("5  Blockchain transaction", "The backend sends the encrypted ballot and the token hash to the Solidity smart contract, which checks the rules and stores the ballot permanently."),
    @("6  Election management", "The administrator opens the election from their own wallet. The voting window and voter limit are fixed. Nobody can close early; anyone can close after the end time."),
    @("7  Counting and results", "Two of three trustees rebuild the key, decrypt and count. The result is final when two trustees submit the same totals. Anyone can recount from the blockchain.")
  )
  $bw = 210; $bh = 172; $gap = 20; $x0 = 30
  for ($i = 0; $i -lt 7; $i++) {
    if ($i -lt 4) { $x = $x0 + $i * ($bw + $gap); $y = 112 } else { $x = $x0 + (3 - ($i - 4)) * ($bw + $gap); $y = 312 }
    $col = $BLUE; if ($i -eq 3) { $col = $ORANGE }; if ($i -eq 4 -or $i -eq 6) { $col = $GREEN }
    $null = Add-Box $s8 $x $y $bw $bh $steps[$i][0] @($steps[$i][1]) $col 12.5 $false
  }
  for ($i = 0; $i -lt 3; $i++) { $x = $x0 + ($i + 1) * ($bw + $gap) - $gap; $null = Add-Arrow $s8 $x 198 ($x + $gap) 198 $false }
  $null = Add-Arrow $s8 825 284 825 312 $false
  $null = Add-Arrow $s8 720 398 700 398 $false
  $null = Add-Arrow $s8 490 398 470 398 $false

  # ================= Slide 9 (Results and discussion) =================
  Set-Rich $s9.Shapes(2).TextFrame.TextRange (
    "The prototype was built and tested end to end on a local Ethereum-compatible test network. **95 automated tests** pass: 20 for the smart contract and 75 for the backend and cryptography.`n" +
    "In a full demonstration, four voters produced **four encrypted ballots** on the blockchain. A repeated vote and a voter who is not on the electoral roll were both **refused**, and the trustees' count matched the votes cast.`n" +
    "Every ballot is exactly **430 bytes** and looks random, so its size reveals nothing. One vote takes about **0.23 seconds** end to end (168 ms of it for the blockchain step) and uses about **417,000 gas**.`n" +
    "The result is final only when **2 of 3 trustees** submit the same count, and anyone can recount the ballots from the blockchain with the published key.`n" +
    "Compared with a centralized system, votes cannot be altered or deleted, no single person can read them, and the count can be verified. These figures come from a local test network; live-network performance is still to be measured.")

  # ================= Slide 12 (Current status) =================
  Set-Rich $s12.Shapes(2).TextFrame.TextRange (
    "The **prototype is built and working** on a local Ethereum-compatible test network. It includes the Solidity smart contract, the backend server, hybrid encryption (RSA-3072 + AES-256-GCM), key splitting among three trustees, a voter web page, a one-click voting demo page and an admin page.`n" +
    "The workflow runs end to end: voter verification with a Keccak-256 voter hash, a one-time voting token, an encrypted ballot recorded on the blockchain, closing of the election, trustee counting and a public recount.`n" +
    "Aadhaar OTP login is **simulated** by a mock service that has the same interface a real service would use.`n" +
    "**Next stage:** deploy the contract on a Proof of Stake test network and the backend on a cloud host, integrate the other group's modules, and carry out security testing and an independent audit.")

  # ================= Slide 13 (References): add the sources the final design relies on =================
  $ref = $s13.Shapes(2).TextFrame.TextRange
  $null = $ref.InsertAfter("`r[11] A. Shamir, " + $LQ + "How to share a secret," + $RQ + " Communications of the ACM, vol. 22, no. 11, pp. 612" + $EN + "613, 1979.")
  $null = $ref.InsertAfter("`r[12] M. Dworkin, " + $LQ + "Recommendation for Block Cipher Modes of Operation: Galois/Counter Mode (GCM) and GMAC," + $RQ + " NIST SP 800-38D, 2007.")
  $null = $ref.InsertAfter("`r[13] K. Moriarty, B. Kaliski, J. Jonsson and A. Rusch, " + $LQ + "PKCS #1: RSA Cryptography Specifications Version 2.2," + $RQ + " RFC 8017, IETF, 2016.")

  # ================= New slide: Security analysis (after Methodology) =================
  $sec = $s6.Duplicate().Item(1)
  $sec.MoveTo($s8.SlideIndex)
  $sec.Shapes(2).Delete()
  $sec.Shapes(1).TextFrame.TextRange.Text = "Security analysis"
  $rows = @(
    @("Threat", "How the system defends against it"),
    @("Voting twice", "One-time token per voter, enforced by the database and again by the smart contract"),
    @("Reading the votes", "Hybrid encryption; the private key is split 2-of-3 among trustees"),
    @("The administrator reading or changing votes", "The administrator never holds the key, and the contract gives the role no access to ballots"),
    @("Fake ballots", "Only the backend can submit, and the ballot count is capped at the voter limit"),
    @("Replaying a ballot in another election", "The election identity is bound into the encryption, so the copy fails to decrypt"),
    @("Changing a stored ballot", "AES-GCM detects any change, and the blockchain is append-only"),
    @("A stolen database", "Only keyed hashes are stored: no Aadhaar number, phone number or vote"),
    @("A wrong count", "Two trustees must submit identical totals, and anyone can recount the public ballots"),
    @("Flooding and guessing", "Rate limits, OTP attempt limits and a strict content security policy")
  )
  $tbl = $sec.Shapes.AddTable($rows.Count, 2, 66, 118, 800, 330)
  $tbl.Name = "Security table"
  $tbl.Table.Columns(1).Width = 270
  $tbl.Table.Columns(2).Width = 530
  for ($r = 1; $r -le $rows.Count; $r++) {
    for ($c = 1; $c -le 2; $c++) {
      $cell = $tbl.Table.Cell($r, $c)
      $tr = $cell.Shape.TextFrame.TextRange
      $tr.Text = $rows[$r - 1][$c - 1]
      $tr.Font.Name = $FONT_UI; $tr.Font.Size = 13.5
      $cell.Shape.TextFrame.MarginTop = 3; $cell.Shape.TextFrame.MarginBottom = 3
      $cell.Shape.TextFrame.VerticalAnchor = 3
      if ($r -eq 1) {
        $cell.Shape.Fill.ForeColor.RGB = $BLUE; $tr.Font.Color.RGB = (Rgb 255 255 255); $tr.Font.Bold = -1
      } else {
        if ($r % 2 -eq 0) { $cell.Shape.Fill.ForeColor.RGB = $PALE } else { $cell.Shape.Fill.ForeColor.RGB = (Rgb 255 255 255) }
        $tr.Font.Color.RGB = $INK
        if ($c -eq 1) { $tr.Font.Bold = -1 } else { $tr.Font.Bold = 0 }
      }
    }
  }

  # ================= New slide: Limitations and future work (after Results) =================
  $lim = $s6.Duplicate().Item(1)
  $lim.MoveTo($s9.SlideIndex)
  $lim.Shapes(2).Delete()
  $lim.Shapes(1).TextFrame.TextRange.Text = "Limitations and future work"
  $null = Add-Box $lim 66 128 400 322 "LIMITATIONS" @(
    "Aadhaar and the SMS are simulated; real access needs government approval.",
    "The server is trusted not to link a voter to their token, and a lost token cannot be re-issued.",
    "Trustees briefly rebuild the full key on one computer.",
    "An online vote cannot stop a voter from being forced to vote a certain way.",
    "Results so far come from a local test network, not a live one.") $ORANGE 15 $true
  $null = Add-Box $lim 494 128 400 322 "FUTURE WORK" @(
    "Deploy on a Proof of Stake network and a cloud host, and use a private government blockchain.",
    "Connect to real Aadhaar authentication through a licensed agency.",
    "Use zero-knowledge proofs or blind signatures so even the server cannot link voters to votes.",
    "Use threshold decryption so the key is never assembled in one place.",
    "Commission an independent security audit.") $GREEN 15 $true

  # ================= Speaker notes =================
  Set-Notes $s6 "Eight objectives. Point out the three that changed from the first plan: the one-time token, the trustee key split, and public verification."
  Set-Notes $s7 "Walk left to right: voter, backend, encryption, blockchain. Then the bottom row: admin, database, trustees, results. Stress that the database never holds an Aadhaar number, and that no single person can read the votes."
  Set-Notes $s8 "Seven steps from login to result. The key idea: verification and voting are separate, so the stored ballot carries no identity."
  Set-Notes $sec "Read the left column as the attack and the right column as the defence. Every defence listed here is covered by an automated test."
  Set-Notes $s9 "These are measured numbers from the prototype on a local test network: 95 tests, 430-byte ballots, about 0.23 s per vote, about 417,000 gas. Say clearly that live-network figures are still to be measured."
  Set-Notes $lim "Say the limitations yourself before anyone asks. The future-work column answers each one."
  Set-Notes $s12 "The prototype is finished; what remains is deployment, real Aadhaar integration and an audit."

  $pres.Save()
  foreach ($s in $pres.Slides) { $s.Export("$renderDir\slide$($s.SlideIndex).png", "PNG", 1280, 720) }
  "Saved. Slides: $($pres.Slides.Count)"
  $pres.Close()
} finally { $app.Quit() }
