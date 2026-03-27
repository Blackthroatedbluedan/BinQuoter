# Parse key totals from 2025 Man Hour Data.xlsx (no Excel COM)
Add-Type -AssemblyName System.IO.Compression.FileSystem
$path = if ($args[0]) { $args[0] } else { 'c:\Users\Roy\Documents\ManhourData\2025 Man Hour Data.xlsx' }
$zip = [System.IO.Compression.ZipFile]::OpenRead($path)

# --- Shared strings ---
$ssXml = [xml]([System.IO.StreamReader]::new($zip.GetEntry('xl/sharedStrings.xml').Open()).ReadToEnd())
$strings = [System.Collections.Generic.List[string]]::new()
$silist = @($ssXml.sst.si)
foreach ($si in $silist) {
    if ($si.t) {
        $tx = if ($si.t -is [string]) { $si.t } else { $si.t.InnerText }
        [void]$strings.Add($tx)
    } elseif ($si.r) {
        $sb = [System.Text.StringBuilder]::new()
        foreach ($r in @($si.r)) {
            $tx = if ($r.t -is [string]) { $r.t } else { $r.t.InnerText }
            [void]$sb.Append($tx)
        }
        [void]$strings.Add($sb.ToString())
    } else { [void]$strings.Add('') }
}
$strings = $strings.ToArray()

function Get-CellRef {
    param([string]$ref)
    if ($ref -match '^([A-Z]+)(\d+)$') {
        return @{ Col = $Matches[1]; Row = [int]$Matches[2] }
    }
    return $null
}
function ColToNum([string]$col) {
    $n = 0
    foreach ($ch in $col.ToCharArray()) { $n = $n * 26 + ([int][char]$ch - 64) }
    return $n
}
function Read-SheetGrid {
    param([string]$sheetPath)
    $sheetXml = [xml]([System.IO.StreamReader]::new($zip.GetEntry($sheetPath).Open()).ReadToEnd())
    $rows = $sheetXml.SelectNodes('//*[local-name()="sheetData"]/*[local-name()="row"]')
    $grid = @{}
    foreach ($row in $rows) {
        $rn = [int]$row.r
        $cells = @($row.c)
        foreach ($c in $cells) {
            $ref = Get-CellRef $c.r
            if (-not $ref) { continue }
            $colNum = ColToNum $ref.Col
            $key = "$rn,$colNum"
            $val = $null
            if ($null -ne $c.v -and "$($c.v)" -ne '') {
                $raw = if ($c.v -is [System.Xml.XmlElement]) { $c.v.InnerText } else { [string]$c.v }
                if ($c.t -eq 's') {
                    $idx = [int]$raw
                    $val = @{ text = $strings[$idx]; num = $null }
                } else {
                    $d = 0.0
                    if ([double]::TryParse($raw, [ref]$d)) {
                        $val = @{ text = $null; num = $d }
                    } else {
                        $val = @{ text = $raw; num = $null }
                    }
                }
            }
            $grid[$key] = $val
        }
    }
    return $grid
}

# --- 2025 Bin Hours (sheet1) ---
$g1 = Read-SheetGrid 'xl/worksheets/sheet1.xml'
$binHours2025 = 0.0
$binRows = @()
$maxR1 = ($g1.Keys | ForEach-Object { [int]($_ -split ',')[0] } | Measure-Object -Maximum).Maximum
for ($r = 2; $r -le $maxR1; $r++) {
    $yearCell = $g1["$r,15"]
    $hoursCell = $g1["$r,8"]
    $y = $null
    if ($yearCell -and $null -ne $yearCell.num) { $y = [int]$yearCell.num }
    elseif ($yearCell -and $yearCell.text) { [int]::TryParse($yearCell.text, [ref]$y) | Out-Null }
    if ($y -ne 2025) { continue }
    $h = $null
    if ($hoursCell -and $null -ne $hoursCell.num) { $h = [double]$hoursCell.num }
    if ($null -eq $h) { continue }
    $binHours2025 += $h
    $cust = $g1["$r,1"]
    $nm = if ($cust -and $cust.text) { $cust.text } else { '' }
    $binRows += [pscustomobject]@{ Row = $r; Customer = $nm; Hours = $h }
}

# --- Millwright (sheet3): column C = hours; Excel uses SUM(C2:C105) ---
$g3 = Read-SheetGrid 'xl/worksheets/sheet3.xml'
$mwSum = 0.0
for ($r = 2; $r -le 105; $r++) {
    $c = $g3["$r,3"]
    if ($c -and $null -ne $c.num) { $mwSum += [double]$c.num }
}
$mwFromExcel = $null
if ($g3['107,3'] -and $null -ne $g3['107,3'].num) {
    $mwFromExcel = [double]$g3['107,3'].num
}

# --- Concrete (sheet4): sum column E only where column D = "Concrete" (excludes duplicate total row D=2025) ---
$g4 = Read-SheetGrid 'xl/worksheets/sheet4.xml'
$conSum = 0.0
$conMaxR = ($g4.Keys | ForEach-Object { [int]($_ -split ',')[0] } | Measure-Object -Maximum).Maximum
for ($r = 2; $r -le $conMaxR; $r++) {
    $d = $g4["$r,4"]
    $e = $g4["$r,5"]
    if (-not $d -or $d.text -ne 'Concrete') { continue }
    if (-not $e -or $null -eq $e.num) { continue }
    $conSum += [double]$e.num
}

# --- 2025 crew sheet (sheet6): count distinct names in col A (data rows) ---
$g6 = Read-SheetGrid 'xl/worksheets/sheet6.xml'
$names = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$maxR6 = ($g6.Keys | ForEach-Object { [int]($_ -split ',')[0] } | Measure-Object -Maximum).Maximum
for ($r = 2; $r -le $maxR6; $r++) {
    $a = $g6["$r,1"]
    if ($a -and $a.text -and $a.text.Trim().Length -gt 0) {
        [void]$names.Add($a.text.Trim())
    }
}

$zip.Dispose()

Write-Host '=== 2025 Bin Hours (sheet1, year=2025) ==='
Write-Host "Sum of Hours column: $binHours2025"
Write-Host "Job rows: $($binRows.Count)"

Write-Host ''
Write-Host '=== Millwright Hours (sheet3) ==='
Write-Host "Sum of column C (rows with numeric C): $mwSum"
if ($null -ne $mwFromExcel) {
    Write-Host "Excel C107 (cached SUM): $mwFromExcel"
}

Write-Host ''
Write-Host '=== Concrete Hours (sheet4) ==='
Write-Host "Sum of column E: $conSum"

Write-Host ''
Write-Host '=== Crew names (sheet6, col A, distinct) ==='
Write-Host "Count: $($names.Count)"
if ($names.Count -le 40) {
    $names | Sort-Object | ForEach-Object { Write-Host "  $_" }
}
